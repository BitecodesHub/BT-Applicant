import type { TaskStatus, TaskType } from '../../../shared/types'
import type { Db } from '../database'
import { parseJson, parseJsonObject, toJson } from '../../core/json'

export interface TaskRecord {
  id: number
  type: TaskType
  payload: Record<string, unknown>
  status: TaskStatus
  priority: number
  runAt: number
  attempts: number
  maxAttempts: number
  leaseOwner: string | null
  leaseExpiresAt: number | null
  cancelRequested: boolean
  idempotencyKey: string | null
  lastError: string | null
  result: Record<string, unknown> | null
  createdAt: number
  updatedAt: number
  completedAt: number | null
}

interface TaskRow {
  id: number
  type: TaskType
  payload: string
  status: TaskStatus
  priority: number
  run_at: number
  attempts: number
  max_attempts: number
  lease_owner: string | null
  lease_expires_at: number | null
  cancel_requested: number
  idempotency_key: string | null
  last_error: string | null
  result: string | null
  created_at: number
  updated_at: number
  completed_at: number | null
}

function mapTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    type: row.type,
    payload: parseJsonObject(row.payload, {}),
    status: row.status,
    priority: row.priority,
    runAt: row.run_at,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    cancelRequested: row.cancel_requested === 1,
    idempotencyKey: row.idempotency_key,
    lastError: row.last_error,
    result: parseJson<Record<string, unknown> | null>(row.result, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at
  }
}

export interface EnqueueInput {
  type: TaskType
  payload?: Record<string, unknown>
  runAt?: number
  priority?: number
  maxAttempts?: number
  idempotencyKey?: string | null
}

export function enqueue(db: Db, input: EnqueueInput): { id: number; created: boolean } {
  const now = Date.now()
  if (input.idempotencyKey) {
    const existing = db.get<{ id: number }>('SELECT id FROM tasks WHERE idempotency_key = ?', input.idempotencyKey)
    if (existing) return { id: existing.id, created: false }
  }
  try {
    const result = db.run(
      `INSERT INTO tasks (type, payload, status, priority, run_at, attempts, max_attempts, idempotency_key, created_at, updated_at)
       VALUES (?, ?, 'pending', ?, ?, 0, ?, ?, ?, ?)`,
      input.type,
      toJson(input.payload ?? {}),
      input.priority ?? 0,
      input.runAt ?? now,
      input.maxAttempts ?? 5,
      input.idempotencyKey ?? null,
      now,
      now
    )
    return { id: result.lastInsertRowid, created: true }
  } catch (error) {
    if (input.idempotencyKey && String(error).includes('UNIQUE')) {
      const existing = db.get<{ id: number }>('SELECT id FROM tasks WHERE idempotency_key = ?', input.idempotencyKey)
      if (existing) return { id: existing.id, created: false }
    }
    throw error
  }
}

export function getTask(db: Db, id: number): TaskRecord | undefined {
  const row = db.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', id)
  return row ? mapTask(row) : undefined
}

export function claimTasks(db: Db, owner: string, limit: number, now: number, leaseMs: number): TaskRecord[] {
  if (limit <= 0) return []
  return db.tx(() => {
    const rows = db.all<TaskRow>(
      `UPDATE tasks SET status = 'running', attempts = attempts + 1, lease_owner = ?, lease_expires_at = ?,
         updated_at = ?
       WHERE id IN (
         SELECT id FROM tasks WHERE status = 'pending' AND run_at <= ?
         ORDER BY priority DESC, run_at ASC, id ASC LIMIT ?
       )
       AND status = 'pending'
       RETURNING *`,
      owner,
      now + leaseMs,
      now,
      now,
      limit
    )
    // RETURNING order is unspecified; restore the priority order the worker relies on.
    return rows
      .sort((a, b) => b.priority - a.priority || a.run_at - b.run_at || a.id - b.id)
      .map(mapTask)
  })
}

export function completeTask(
  db: Db,
  id: number,
  owner: string,
  result: Record<string, unknown> | null = null
): boolean {
  const changes = db.run(
    `UPDATE tasks SET status = 'done', result = ?, lease_owner = NULL, lease_expires_at = NULL,
       last_error = NULL, updated_at = ?, completed_at = ?
     WHERE id = ? AND status = 'running' AND lease_owner = ?`,
    result ? toJson(result) : null,
    Date.now(),
    Date.now(),
    id,
    owner
  ).changes
  return changes === 1
}

export function backoffDelay(attempts: number, baseMs = 2000, maxMs = 600_000, rng: () => number = Math.random): number {
  const exponent = Math.min(maxMs, baseMs * 2 ** Math.max(attempts - 1, 0))
  const jitter = exponent * 0.25 * (rng() * 2 - 1)
  return Math.max(0, Math.round(exponent + jitter))
}

export interface FailOptions {
  retryable?: boolean
  backoffBaseMs?: number
  rng?: () => number
}

export function failTask(db: Db, id: number, owner: string, error: string, options: FailOptions = {}): TaskRecord | undefined {
  const task = getTask(db, id)
  if (!task) return undefined
  const now = Date.now()
  const retryable = options.retryable ?? true
  const shouldRetry = retryable && task.attempts < task.maxAttempts

  if (shouldRetry) {
    const delay = backoffDelay(task.attempts, options.backoffBaseMs ?? 2000, 600_000, options.rng)
    db.run(
      `UPDATE tasks SET status = 'pending', run_at = ?, lease_owner = NULL, lease_expires_at = NULL,
         last_error = ?, updated_at = ?
       WHERE id = ? AND status = 'running' AND lease_owner = ?`,
      now + delay,
      error.slice(0, 4000),
      now,
      id,
      owner
    )
  } else {
    db.run(
      `UPDATE tasks SET status = 'dead', lease_owner = NULL, lease_expires_at = NULL, last_error = ?,
         updated_at = ?, completed_at = ?
       WHERE id = ? AND status = 'running' AND lease_owner = ?`,
      error.slice(0, 4000),
      now,
      now,
      id,
      owner
    )
  }
  return getTask(db, id)
}

export function requestCancel(db: Db, id: number): void {
  const task = getTask(db, id)
  if (!task) return
  if (task.status === 'pending') {
    db.run("UPDATE tasks SET status = 'cancelled', updated_at = ?, completed_at = ? WHERE id = ?", Date.now(), Date.now(), id)
  } else if (task.status === 'running') {
    db.run('UPDATE tasks SET cancel_requested = 1, updated_at = ? WHERE id = ?', Date.now(), id)
  }
}

export function isCancelRequested(db: Db, id: number): boolean {
  return db.get<{ cancel_requested: number }>('SELECT cancel_requested FROM tasks WHERE id = ?', id)?.cancel_requested === 1
}

export function retryTask(db: Db, id: number): void {
  db.run(
    `UPDATE tasks SET status = 'pending', run_at = ?, lease_owner = NULL, lease_expires_at = NULL,
       cancel_requested = 0, updated_at = ?
     WHERE id = ? AND status IN ('dead','failed','cancelled')`,
    Date.now(),
    Date.now(),
    id
  )
}

export interface ReapResult {
  requeued: number
  dead: number
}

export function reapExpiredLeases(db: Db, now: number): ReapResult {
  return db.tx(() => {
    const dead = db.run(
      `UPDATE tasks SET status = 'dead', lease_owner = NULL, lease_expires_at = NULL,
         last_error = COALESCE(last_error, 'lease expired'), updated_at = ?, completed_at = ?
       WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ? AND attempts >= max_attempts`,
      now,
      now,
      now
    ).changes
    const requeued = db.run(
      `UPDATE tasks SET status = 'pending', lease_owner = NULL, lease_expires_at = NULL,
         last_error = 'lease expired; requeued', run_at = ?, updated_at = ?
       WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ? AND attempts < max_attempts`,
      now,
      now,
      now
    ).changes
    return { requeued, dead }
  })
}

/** Called once at startup: no other worker can own a running task in this process. */
export function recoverInterruptedTasks(db: Db): ReapResult {
  const now = Date.now()
  return db.tx(() => {
    const dead = db.run(
      `UPDATE tasks SET status = 'dead', lease_owner = NULL, lease_expires_at = NULL,
         last_error = COALESCE(last_error, 'interrupted by restart'), updated_at = ?, completed_at = ?
       WHERE status = 'running' AND attempts >= max_attempts`,
      now,
      now
    ).changes
    const requeued = db.run(
      `UPDATE tasks SET status = 'pending', lease_owner = NULL, lease_expires_at = NULL,
         last_error = 'interrupted by restart; requeued', run_at = ?, updated_at = ?
       WHERE status = 'running' AND attempts < max_attempts`,
      now,
      now
    ).changes
    return { requeued, dead }
  })
}

export interface QueueStats {
  pending: number
  running: number
  dead: number
  cancelled: number
  oldestPendingAt: number | null
  nextRunAt: number | null
  doneToday: number
}

export function getQueueStats(db: Db, todayStart: number): QueueStats {
  const count = (status: string): number =>
    db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tasks WHERE status = ?', status)?.n ?? 0
  const oldest = db.get<{ run_at: number | null }>(
    "SELECT MIN(run_at) AS run_at FROM tasks WHERE status = 'pending'"
  )?.run_at
  const next = db.get<{ run_at: number | null }>(
    "SELECT MIN(run_at) AS run_at FROM tasks WHERE status = 'pending' AND run_at > ?",
    Date.now()
  )?.run_at
  return {
    pending: count('pending'),
    running: count('running'),
    dead: count('dead'),
    cancelled: count('cancelled'),
    oldestPendingAt: oldest ?? null,
    nextRunAt: next ?? null,
    doneToday:
      db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM tasks WHERE status = 'done' AND completed_at >= ?",
        todayStart
      )?.n ?? 0
  }
}

export function listTasks(db: Db, filters: { status?: TaskStatus | 'all'; type?: TaskType; limit?: number } = {}): TaskRecord[] {
  const where: string[] = []
  const params: (string | number)[] = []
  if (filters.status && filters.status !== 'all') {
    where.push('status = ?')
    params.push(filters.status)
  }
  if (filters.type) {
    where.push('type = ?')
    params.push(filters.type)
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  return db
    .all<TaskRow>(`SELECT * FROM tasks ${whereSql} ORDER BY created_at DESC LIMIT ?`, ...params, filters.limit ?? 100)
    .map(mapTask)
}

export interface ScheduleRecord {
  id: number
  key: string
  taskType: TaskType
  payload: Record<string, unknown>
  cron: string
  timezone: string
  enabled: boolean
  nextRunAt: number | null
  lastRunAt: number | null
  lastResult: string | null
  createdAt: number
  updatedAt: number
}

interface ScheduleRow {
  id: number
  key: string
  task_type: TaskType
  payload: string
  cron: string
  timezone: string
  enabled: number
  next_run_at: number | null
  last_run_at: number | null
  last_result: string | null
  created_at: number
  updated_at: number
}

function mapSchedule(row: ScheduleRow): ScheduleRecord {
  return {
    id: row.id,
    key: row.key,
    taskType: row.task_type,
    payload: parseJsonObject(row.payload, {}),
    cron: row.cron,
    timezone: row.timezone,
    enabled: row.enabled === 1,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastResult: row.last_result,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function upsertSchedule(
  db: Db,
  input: { key: string; taskType: TaskType; payload?: Record<string, unknown>; cron: string; timezone: string; enabled?: boolean; nextRunAt?: number | null }
): ScheduleRecord {
  const now = Date.now()
  db.run(
    `INSERT INTO schedules (key, task_type, payload, cron, timezone, enabled, next_run_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET task_type = excluded.task_type, payload = excluded.payload,
       cron = excluded.cron, timezone = excluded.timezone, enabled = excluded.enabled,
       next_run_at = COALESCE(schedules.next_run_at, excluded.next_run_at), updated_at = excluded.updated_at`,
    input.key,
    input.taskType,
    toJson(input.payload ?? {}),
    input.cron,
    input.timezone,
    input.enabled === false ? 0 : 1,
    input.nextRunAt ?? now,
    now,
    now
  )
  return db.all<ScheduleRow>('SELECT * FROM schedules WHERE key = ?', input.key).map(mapSchedule)[0]!
}

export function listSchedules(db: Db): ScheduleRecord[] {
  return db.all<ScheduleRow>('SELECT * FROM schedules ORDER BY key').map(mapSchedule)
}

export function dueSchedules(db: Db, now: number): ScheduleRecord[] {
  return db
    .all<ScheduleRow>('SELECT * FROM schedules WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?', now)
    .map(mapSchedule)
}

export function markScheduleRun(db: Db, id: number, nextRunAt: number, result: string): void {
  const now = Date.now()
  db.run(
    'UPDATE schedules SET next_run_at = ?, last_run_at = ?, last_result = ?, updated_at = ? WHERE id = ?',
    nextRunAt,
    now,
    result.slice(0, 500),
    now,
    id
  )
}

export function setScheduleEnabled(db: Db, id: number, enabled: boolean): void {
  db.run('UPDATE schedules SET enabled = ?, updated_at = ? WHERE id = ?', enabled ? 1 : 0, Date.now(), id)
}

export function deleteSchedule(db: Db, key: string): void {
  db.run('DELETE FROM schedules WHERE key = ?', key)
}

export interface HeartbeatRecord {
  id: string
  startedAt: number
  lastSeenAt: number
  status: string
  currentTaskId: number | null
  appVersion: string | null
}

export function upsertHeartbeat(
  db: Db,
  input: { id: string; startedAt: number; status: string; currentTaskId: number | null; appVersion: string }
): void {
  db.run(
    `INSERT INTO worker_heartbeats (id, started_at, last_seen_at, status, current_task_id, app_version)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at, status = excluded.status,
       current_task_id = excluded.current_task_id, app_version = excluded.app_version`,
    input.id,
    input.startedAt,
    Date.now(),
    input.status,
    input.currentTaskId,
    input.appVersion
  )
}

export function listHeartbeats(db: Db): HeartbeatRecord[] {
  return db
    .all<{
      id: string
      started_at: number
      last_seen_at: number
      status: string
      current_task_id: number | null
      app_version: string | null
    }>('SELECT * FROM worker_heartbeats ORDER BY last_seen_at DESC')
    .map((row) => ({
      id: row.id,
      startedAt: row.started_at,
      lastSeenAt: row.last_seen_at,
      status: row.status,
      currentTaskId: row.current_task_id,
      appVersion: row.app_version
    }))
}

export function removeHeartbeat(db: Db, id: string): void {
  db.run('DELETE FROM worker_heartbeats WHERE id = ?', id)
}
