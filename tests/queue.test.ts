import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '@main/db/database'
import {
  backoffDelay,
  claimTasks,
  completeTask,
  enqueue,
  failTask,
  getQueueStats,
  getTask,
  isCancelRequested,
  reapExpiredLeases,
  recoverInterruptedTasks,
  requestCancel,
  retryTask
} from '@main/db/repos/tasks'
import { createTestContext, type TestContext } from './helpers'

let ctx: TestContext
let db: Db

beforeEach(() => {
  ctx = createTestContext()
  db = ctx.db
})

afterEach(() => {
  ctx.close()
})

describe('durable queue', () => {
  it('deduplicates enqueue by idempotency key', () => {
    const first = enqueue(db, { type: 'source.poll', idempotencyKey: 'discover:2026-10-29' })
    const second = enqueue(db, { type: 'source.poll', idempotencyKey: 'discover:2026-10-29' })
    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.id).toBe(first.id)
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tasks')?.n).toBe(1)
  })

  it('claims by priority, then run time, and leases the task', () => {
    const now = 1_000_000
    const later = enqueue(db, { type: 'source.poll', runAt: now, priority: 1 })
    const urgent = enqueue(db, { type: 'application.dispatch', runAt: now, priority: 9 })
    const future = enqueue(db, { type: 'maintenance.reaper', runAt: now + 60_000, priority: 100 })

    const claimed = claimTasks(db, 'worker-a', 2, now, 30_000)
    expect(claimed.map((task) => task.id)).toEqual([urgent.id, later.id])
    expect(claimed[0]?.status).toBe('running')
    expect(claimed[0]?.attempts).toBe(1)
    expect(claimed[0]?.leaseOwner).toBe('worker-a')
    expect(claimed[0]?.leaseExpiresAt).toBe(now + 30_000)

    expect(claimTasks(db, 'worker-b', 5, now, 30_000)).toHaveLength(0)
    expect(getTask(db, future.id)?.status).toBe('pending')

    const afterRunAt = claimTasks(db, 'worker-b', 5, now + 60_000, 30_000)
    expect(afterRunAt.map((task) => task.id)).toEqual([future.id])
  })

  it('honours the claim limit and never claims cancelled tasks', () => {
    const now = Date.now()
    const first = enqueue(db, { type: 'source.poll', runAt: now })
    const second = enqueue(db, { type: 'source.poll', runAt: now })
    requestCancel(db, second.id)
    expect(claimTasks(db, 'worker-a', 5, now, 10_000).map((task) => task.id)).toEqual([first.id])
    expect(getTask(db, second.id)?.status).toBe('cancelled')
  })

  it('completes only for the owning lease', () => {
    const now = Date.now()
    const { id } = enqueue(db, { type: 'source.poll', runAt: now })
    claimTasks(db, 'worker-a', 1, now, 10_000)

    expect(completeTask(db, id, 'worker-b', { jobs: 3 })).toBe(false)
    expect(getTask(db, id)?.status).toBe('running')

    expect(completeTask(db, id, 'worker-a', { jobs: 3 })).toBe(true)
    const task = getTask(db, id)
    expect(task?.status).toBe('done')
    expect(task?.result).toEqual({ jobs: 3 })
    expect(task?.completedAt).not.toBeNull()
    expect(task?.leaseOwner).toBeNull()
  })

  it('retries with deterministic backoff and dead-letters exhausted tasks', () => {
    const now = Date.now()
    const retryable = enqueue(db, { type: 'source.poll', runAt: now, maxAttempts: 3 })
    claimTasks(db, 'worker-a', 1, now, 10_000)
    const before = Date.now()
    const retried = failTask(db, retryable.id, 'worker-a', 'network down', {
      retryable: true,
      backoffBaseMs: 1_000,
      rng: () => 0.5
    })
    expect(retried?.status).toBe('pending')
    expect(retried?.lastError).toBe('network down')
    expect(retried?.attempts).toBe(1)
    expect(retried?.runAt).toBeGreaterThanOrEqual(before + 1_000)

    claimTasks(db, 'worker-b', 1, retried!.runAt, 10_000)
    failTask(db, retryable.id, 'worker-b', 'network down', { retryable: true, rng: () => 0.5 })
    claimTasks(db, 'worker-c', 1, Date.now() + 10_000, 10_000)
    const dead = failTask(db, retryable.id, 'worker-c', 'final failure', { retryable: true })
    expect(dead?.status).toBe('dead')
    expect(dead?.attempts).toBe(3)
    expect(dead?.completedAt).not.toBeNull()
  })

  it('dead-letters non-retryable failures immediately', () => {
    const now = Date.now()
    const { id } = enqueue(db, { type: 'source.poll', runAt: now, maxAttempts: 5 })
    claimTasks(db, 'worker-a', 1, now, 10_000)
    const task = failTask(db, id, 'worker-a', 'invalid configuration', { retryable: false })
    expect(task?.status).toBe('dead')
    expect(task?.attempts).toBe(1)
  })

  it('tracks cancel requests for pending and running tasks', () => {
    const now = Date.now()
    const running = enqueue(db, { type: 'source.poll', runAt: now })
    const pending = enqueue(db, { type: 'source.poll', runAt: now })
    const [claimed] = claimTasks(db, 'worker-a', 1, now, 10_000)
    expect(claimed?.id).toBe(running.id)

    requestCancel(db, pending.id)
    requestCancel(db, running.id)

    expect(getTask(db, pending.id)?.status).toBe('cancelled')
    expect(getTask(db, running.id)?.status).toBe('running')
    expect(isCancelRequested(db, running.id)).toBe(true)
  })

  it('requeues or dead-letters expired leases based on attempt budget', () => {
    const now = Date.now()
    const short = enqueue(db, { type: 'source.poll', runAt: now, maxAttempts: 5 })
    const exhausted = enqueue(db, { type: 'source.poll', runAt: now, maxAttempts: 1 })
    claimTasks(db, 'worker-a', 2, now, 100)

    const reaped = reapExpiredLeases(db, now + 10_000)
    expect(reaped.requeued).toBe(1)
    expect(reaped.dead).toBe(1)
    expect(getTask(db, short.id)?.status).toBe('pending')
    expect(getTask(db, short.id)?.lastError).toContain('lease expired')
    expect(getTask(db, exhausted.id)?.status).toBe('dead')
  })

  it('recovers tasks interrupted by a restart', () => {
    const now = Date.now()
    const recoverable = enqueue(db, { type: 'source.poll', runAt: now, maxAttempts: 3 })
    const spent = enqueue(db, { type: 'source.poll', runAt: now, maxAttempts: 1 })
    claimTasks(db, 'old-worker', 2, now, 60_000)

    const result = recoverInterruptedTasks(db)
    expect(result).toEqual({ requeued: 1, dead: 1 })
    expect(getTask(db, recoverable.id)?.status).toBe('pending')
    expect(getTask(db, recoverable.id)?.leaseOwner).toBeNull()
    expect(getTask(db, spent.id)?.status).toBe('dead')
  })

  it('revives dead tasks on retry and clears cancel state', () => {
    const now = Date.now()
    const { id } = enqueue(db, { type: 'source.poll', runAt: now, maxAttempts: 1 })
    claimTasks(db, 'worker-a', 1, now, 10_000)
    failTask(db, id, 'worker-a', 'boom', { retryable: false })
    expect(getTask(db, id)?.status).toBe('dead')

    retryTask(db, id)
    const revived = getTask(db, id)
    expect(revived?.status).toBe('pending')
    expect(revived?.cancelRequested).toBe(false)
    expect(revived?.leaseOwner).toBeNull()
  })

  it('computes jittered backoff inside the expected window', () => {
    expect(backoffDelay(1, 2_000, 600_000, () => 0.5)).toBe(2_000)
    expect(backoffDelay(2, 2_000, 600_000, () => 0.5)).toBe(4_000)
    expect(backoffDelay(20, 2_000, 600_000, () => 0.5)).toBe(600_000)
    expect(backoffDelay(1, 2_000, 600_000, () => 0)).toBe(1_500)
    expect(backoffDelay(1, 2_000, 600_000, () => 1)).toBe(2_500)
  })

  it('reports queue statistics', () => {
    const now = Date.now()
    const running = enqueue(db, { type: 'source.poll', runAt: now })
    enqueue(db, { type: 'source.poll', runAt: now })
    const [claimed] = claimTasks(db, 'worker-a', 1, now, 10_000)
    expect(claimed?.id).toBe(running.id)
    const stats = getQueueStats(db, new Date().setHours(0, 0, 0, 0))
    expect(stats.pending).toBe(1)
    expect(stats.running).toBe(1)
    expect(getTask(db, running.id)?.status).toBe('running')
  })
})
