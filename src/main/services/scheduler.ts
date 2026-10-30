import type { Db } from '../db/database'
import type { ScheduleRecord } from '../db/repos/tasks'
import {
  deleteSchedule,
  dueSchedules,
  listSchedules,
  markScheduleRun,
  upsertSchedule
} from '../db/repos/tasks'
import { listTargetCountries } from '../db/repos/profile'
import { getSection } from '../core/settings'
import { cronForDailyTime, nextCronTime } from '../core/cron'
import { systemTimeZone } from '../core/time'
import { logEvent } from '../db/repos/events'

const GLOBAL_SCHEDULES = [
  { key: 'metrics.rollup', taskType: 'metrics.rollup' as const, cron: '7 * * * *' },
  { key: 'application.reconcile', taskType: 'application.reconcile' as const, cron: '*/10 * * * *' },
  { key: 'maintenance.reaper', taskType: 'maintenance.reaper' as const, cron: '*/5 * * * *' },
  { key: 'maintenance.retention', taskType: 'maintenance.retention' as const, cron: '20 3 * * *' }
]

/**
 * Materialises schedules for enabled target countries and the fixed
 * maintenance jobs, then converts due schedules into idempotent queue tasks.
 * A schedule fires at most once per next_run_at, even across restarts.
 */
export class SchedulerService {
  private timer: NodeJS.Timeout | null = null
  private running = false
  private ticking = false
  private readonly onTask: (type: string, payload: Record<string, unknown>, idempotencyKey: string) => void

  constructor(
    private readonly db: Db,
    onTask: (type: string, payload: Record<string, unknown>, idempotencyKey: string) => void
  ) {
    this.onTask = onTask
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.sync()
    this.timer = setInterval(() => this.tick(), 10_000)
    this.tick()
  }

  stop(): void {
    this.running = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  sync(): void {
    const timeZone = systemTimeZone()
    const now = Date.now()
    const existing = new Map(listSchedules(this.db).map((schedule) => [schedule.key, schedule]))

    const ensure = (
      key: string,
      taskType: (typeof GLOBAL_SCHEDULES)[number]['taskType'] | 'source.poll' | 'digest.generate',
      cron: string,
      zone: string,
      payload: Record<string, unknown>,
      enabled: boolean
    ): void => {
      const current = existing.get(key)
      const nextRunAt = current?.nextRunAt ?? now + 1500
      upsertSchedule(this.db, { key, taskType, payload, cron, timezone: zone, enabled, nextRunAt: enabled ? nextRunAt : null })
      if (!enabled) {
        this.db.run('UPDATE schedules SET enabled = 0, next_run_at = NULL WHERE key = ?', key)
      }
    }

    for (const schedule of GLOBAL_SCHEDULES) {
      ensure(schedule.key, schedule.taskType, schedule.cron, timeZone, {}, true)
    }

    const digest = getSection(this.db, 'digest')
    ensure(
      'digest.generate',
      'digest.generate',
      cronForDailyTime(digest.time),
      timeZone,
      {},
      digest.enabled
    )

    const targets = listTargetCountries(this.db)
    const activeKeys = new Set<string>()
    for (const target of targets) {
      if (!target.enabled) continue
      const key = `target:${target.id}:poll`
      activeKeys.add(key)
      ensure(
        key,
        'source.poll',
        target.scheduleCron,
        target.timezone || timeZone,
        { targetCountryId: target.id },
        true
      )
    }
    for (const key of existing.keys()) {
      if (key.startsWith('target:') && !activeKeys.has(key)) deleteSchedule(this.db, key)
    }
  }

  private tick(): void {
    if (!this.running || this.ticking) return
    this.ticking = true
    try {
      const now = Date.now()
      for (const schedule of dueSchedules(this.db, now)) {
        this.fire(schedule, now)
      }
    } finally {
      this.ticking = false
    }
  }

  private fire(schedule: ScheduleRecord, now: number): void {
    let nextRunAt: number
    try {
      nextRunAt = nextCronTime(schedule.cron, schedule.timezone, now)
    } catch (error) {
      this.db.run('UPDATE schedules SET enabled = 0, next_run_at = NULL, last_result = ? WHERE id = ?', `invalid cron: ${String(error)}`.slice(0, 500), schedule.id)
      logEvent(this.db, {
        category: 'schedule.invalid',
        level: 'error',
        message: `Schedule ${schedule.key} has an invalid cron expression and was disabled.`
      })
      return
    }
    const runAt = schedule.nextRunAt ?? now
    const idempotencyKey = `schedule:${schedule.id}:${runAt}`
    try {
      this.onTask(schedule.taskType, schedule.payload, idempotencyKey)
      markScheduleRun(this.db, schedule.id, nextRunAt, 'queued')
    } catch (error) {
      markScheduleRun(this.db, schedule.id, nextRunAt, `enqueue failed: ${error instanceof Error ? error.message : String(error)}`)
      logEvent(this.db, {
        category: 'schedule.failed',
        level: 'error',
        message: `Schedule ${schedule.key} could not enqueue its task: ${error instanceof Error ? error.message : String(error)}`,
        taskId: null
      })
    }
  }
}
