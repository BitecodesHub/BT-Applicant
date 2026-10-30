import type { Db } from '../db/database'
import type { DigestSummary, TaskType } from '../../shared/types'
import type { TaskRecord } from '../db/repos/tasks'
import { claimTasks, completeTask, failTask, getQueueStats, isCancelRequested, reapExpiredLeases, upsertHeartbeat } from '../db/repos/tasks'
import { expireJobs } from '../db/repos/jobs'
import { pruneEvents } from '../db/repos/events'
import { pruneMetrics } from '../db/repos/metrics'
import { pruneChatActions, pruneChatMessages } from '../db/repos/chat'
import { logEvent } from '../db/repos/events'
import { getSection } from '../core/settings'
import { dateKey, systemTimeZone } from '../core/time'
import { plural } from '../core/text'
import type { PipelineService } from './pipeline'
import type { ApplicationService } from './applications'
import { generateDailyDigest } from './reporting'

export interface WorkerOptions {
  version: string
  concurrency: number
  pollIntervalMs: number
  leaseMs: number
  onChange?: () => void
  onDigest?: (summary: DigestSummary) => void
}

const HEARTBEAT_INTERVAL_MS = 10_000

interface ActiveTask {
  task: TaskRecord
  controller: AbortController
  promise: Promise<void>
}

/**
 * Leased, multi-slot task runner. A task is claimed atomically in SQLite before
 * it runs, so a crash can only leave a lease that the reaper or startup
 * recovery will requeue. Handlers are small adapters over the domain services.
 */
export class WorkerService {
  private timer: NodeJS.Timeout | null = null
  private heartbeat: NodeJS.Timeout | null = null
  private active = new Map<number, ActiveTask>()
  private running = false
  private readonly workerId: string
  private readonly startedAt = Date.now()

  constructor(
    private readonly db: Db,
    private readonly pipeline: PipelineService,
    private readonly applications: ApplicationService,
    private readonly options: WorkerOptions
  ) {
    this.workerId = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  }

  get id(): string {
    return this.workerId
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.beat('running')
    this.heartbeat = setInterval(() => this.beat('running'), HEARTBEAT_INTERVAL_MS)
    this.timer = setInterval(() => this.tick(), this.options.pollIntervalMs)
    this.tick()
    logEvent(this.db, {
      category: 'worker.started',
      message: `Worker ${this.workerId} started with ${plural(this.options.concurrency, 'slot')}`,
      actor: 'system'
    })
  }

  async stop(): Promise<void> {
    if (!this.running) return
    this.running = false
    if (this.timer) clearInterval(this.timer)
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.timer = null
    this.heartbeat = null
    for (const active of this.active.values()) active.controller.abort()
    await Promise.allSettled([...this.active.values()].map((active) => active.promise))
    this.beat('stopped')
    logEvent(this.db, { category: 'worker.stopped', message: `Worker ${this.workerId} stopped`, actor: 'system' })
  }

  isRunning(): boolean {
    return this.running
  }

  inFlight(): number {
    return this.active.size
  }

  configure(settings: { concurrency: number; pollIntervalMs: number; leaseMs: number }): void {
    this.options.concurrency = Math.max(1, settings.concurrency)
    this.options.pollIntervalMs = Math.max(250, settings.pollIntervalMs)
    this.options.leaseMs = Math.max(30_000, settings.leaseMs)
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = setInterval(() => this.tick(), this.options.pollIntervalMs)
    }
  }

  private beat(status: string): void {
    try {
      upsertHeartbeat(this.db, {
        id: this.workerId,
        startedAt: this.startedAt,
        status,
        currentTaskId: this.active.values().next().value?.task.id ?? null,
        appVersion: this.options.version
      })
    } catch {
      // A heartbeat failure must never stop task processing.
    }
  }

  private tick(): void {
    if (!this.running) return
    const free = this.options.concurrency - this.active.size
    if (free <= 0) return
    let claimed: TaskRecord[]
    try {
      claimed = claimTasks(this.db, this.workerId, free, Date.now(), this.options.leaseMs)
    } catch (error) {
      logEvent(this.db, {
        category: 'worker.claim_failed',
        level: 'error',
        message: error instanceof Error ? error.message : String(error),
        actor: 'system'
      })
      return
    }
    for (const task of claimed) this.launch(task)
  }

  private launch(task: TaskRecord): void {
    const controller = new AbortController()
    const promise = (async () => {
      try {
        if (isCancelRequested(this.db, task.id)) {
          this.cancel(task.id)
          return
        }
        const result = await this.execute(task, controller.signal)
        if (isCancelRequested(this.db, task.id)) {
          this.cancel(task.id)
        } else {
          completeTask(this.db, task.id, this.workerId, result)
        }
      } catch (error) {
        if (controller.signal.aborted) {
          this.requeueAborted(task)
        } else {
          const message = error instanceof Error ? error.message : String(error)
          failTask(this.db, task.id, this.workerId, message)
          logEvent(this.db, {
            category: 'task.failed',
            level: 'error',
            message: `Task ${task.type} #${task.id} failed: ${message}`,
            taskId: task.id
          })
        }
      } finally {
        this.active.delete(task.id)
        this.beat('running')
        this.options.onChange?.()
      }
    })()
    this.active.set(task.id, { task, controller, promise })
  }

  private cancel(taskId: number): void {
    this.db.run(
      "UPDATE tasks SET status = 'cancelled', lease_owner = NULL, lease_expires_at = NULL, updated_at = ?, completed_at = ? WHERE id = ?",
      Date.now(),
      Date.now(),
      taskId
    )
  }

  private requeueAborted(task: TaskRecord): void {
    this.db.run(
      `UPDATE tasks SET status = 'pending', lease_owner = NULL, lease_expires_at = NULL,
         last_error = 'interrupted by shutdown; requeued', run_at = ?, updated_at = ?
       WHERE id = ? AND status = 'running'`,
      Date.now() + 2000,
      Date.now(),
      task.id
    )
  }

  private async execute(task: TaskRecord, signal: AbortSignal): Promise<Record<string, unknown> | null> {
    const payload = task.payload
    switch (task.type as TaskType) {
      case 'source.poll': {
        const targetCountryId = Number(payload.targetCountryId)
        if (!Number.isFinite(targetCountryId)) throw new Error('source.poll requires targetCountryId')
        const sourceId = typeof payload.sourceId === 'string' ? payload.sourceId : null
        if (sourceId) {
          const result = await this.pipeline.pollSource(sourceId, targetCountryId, signal, task.id)
          return { ...result }
        }
        const results = await this.pipeline.pollTarget(targetCountryId, signal, task.id)
        return { sources: results.length, inserted: results.reduce((sum, item) => sum + item.inserted, 0) }
      }
      case 'job.evaluate': {
        const jobId = Number(payload.jobId)
        if (!Number.isFinite(jobId)) throw new Error('job.evaluate requires jobId')
        return { ...this.pipeline.evaluateJob(jobId) }
      }
      case 'application.draft': {
        const applicationId = Number(payload.applicationId)
        if (!Number.isFinite(applicationId)) throw new Error('application.draft requires applicationId')
        const result = await this.applications.draft(applicationId, signal)
        return { ...result }
      }
      case 'application.dispatch':
      case 'web.submit': {
        const applicationId = Number(payload.applicationId)
        if (!Number.isFinite(applicationId)) throw new Error(`${task.type} requires applicationId`)
        const result = await this.applications.dispatch(applicationId, signal)
        return { ...result }
      }
      case 'application.reconcile': {
        return { ...(await this.applications.reconcile()) }
      }
      case 'metrics.rollup': {
        const timeZone = systemTimeZone()
        const date = typeof payload.date === 'string' ? payload.date : dateKey(Date.now(), timeZone)
        const digest = generateDailyDigest(this.db, date, timeZone)
        return { date, submitted: digest.metrics.submitted, discovered: digest.metrics.jobsDiscovered }
      }
      case 'digest.generate': {
        const timeZone = systemTimeZone()
        const date = typeof payload.date === 'string' ? payload.date : dateKey(Date.now(), timeZone)
        const summary = generateDailyDigest(this.db, date, timeZone)
        const digestSettings = getSection(this.db, 'digest')
        if (digestSettings.notify) this.options.onDigest?.(summary)
        logEvent(this.db, {
          category: 'digest.generated',
          message: summary.headline,
          detail: { date, submitted: summary.metrics.submitted, awaitingApproval: summary.backlog.awaitingApproval }
        })
        return { date, headline: summary.headline }
      }
      case 'maintenance.retention': {
        return this.retention()
      }
      case 'maintenance.reaper': {
        const reaped = reapExpiredLeases(this.db, Date.now())
        const expired = expireJobs(this.db, Date.now())
        const reconciled = await this.applications.reconcile()
        if (reaped.requeued > 0 || reaped.dead > 0 || expired > 0) {
          logEvent(this.db, {
            category: 'maintenance.reaper',
            message: `Reaper requeued ${plural(reaped.requeued, 'task')}, dead-lettered ${reaped.dead}, expired ${plural(expired, 'job')}`,
            detail: { ...reaped, expired, ...reconciled }
          })
        }
        return { ...reaped, expired, ...reconciled }
      }
      default: {
        throw new Error(`Unsupported task type: ${task.type}`)
      }
    }
  }

  private retention(): Record<string, unknown> {
    const retention = getSection(this.db, 'retention')
    const now = Date.now()
    const events = pruneEvents(this.db, now - retention.eventsDays * 86_400_000)
    const aiCalls = this.db.run('DELETE FROM ai_calls WHERE created_at < ?', now - retention.aiCallsDays * 86_400_000).changes
    const metricsCutoff = dateKey(now - retention.eventsDays * 86_400_000, systemTimeZone())
    const metrics = pruneMetrics(this.db, metricsCutoff)
    const jobsCutoff = now - retention.jobsDays * 86_400_000
    const jobs = this.db.run(
      `DELETE FROM jobs WHERE last_verified_at < ? AND status != 'active'
         AND NOT EXISTS (SELECT 1 FROM applications WHERE applications.job_id = jobs.id)`,
      jobsCutoff
    ).changes
    this.db.run('DELETE FROM source_fetches WHERE started_at < ?', jobsCutoff)
    this.db.run('DELETE FROM tasks WHERE status IN (\'done\',\'cancelled\') AND updated_at < ?', jobsCutoff)
    const chatMessages = pruneChatMessages(this.db, now - retention.eventsDays * 86_400_000)
    const chatActions = pruneChatActions(this.db, now)
    this.db.checkpoint()
    logEvent(this.db, {
      category: 'maintenance.retention',
      message: `Retention pass removed ${plural(events, 'event')}, ${plural(aiCalls, 'AI call')}, ${plural(metrics, 'metric day')}, ${plural(jobs, 'job')}, ${plural(chatMessages, 'chat message')}`,
      detail: { events, aiCalls, metrics, jobs, chatMessages, chatActions }
    })
    return { events, aiCalls, metrics, jobs, chatMessages, chatActions }
  }

  stats(todayStart: number) {
    return getQueueStats(this.db, todayStart)
  }
}
