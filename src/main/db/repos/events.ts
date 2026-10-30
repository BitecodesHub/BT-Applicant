import type { Severity } from '../../../shared/types'
import type { Db } from '../database'
import { parseJson, toJson } from '../../core/json'

export interface EventInput {
  level?: Severity
  category: string
  message: string
  jobId?: number | null
  applicationId?: number | null
  sourceId?: string | null
  taskId?: number | null
  detail?: Record<string, unknown> | null
  actor?: string
}

export function logEvent(db: Db, input: EventInput): number {
  const result = db.run(
    `INSERT INTO events (ts, level, category, job_id, application_id, source_id, task_id, message, detail, actor)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    Date.now(),
    input.level ?? 'info',
    input.category,
    input.jobId ?? null,
    input.applicationId ?? null,
    input.sourceId ?? null,
    input.taskId ?? null,
    input.message.slice(0, 2000),
    input.detail ? toJson(input.detail) : null,
    input.actor ?? 'system'
  )
  return result.lastInsertRowid
}

export interface EventRecord {
  id: number
  ts: number
  level: Severity
  category: string
  jobId: number | null
  applicationId: number | null
  sourceId: string | null
  taskId: number | null
  message: string
  detail: Record<string, unknown> | null
  actor: string
}

interface EventRow {
  id: number
  ts: number
  level: Severity
  category: string
  job_id: number | null
  application_id: number | null
  source_id: string | null
  task_id: number | null
  message: string
  detail: string | null
  actor: string
}

function mapEvent(row: EventRow): EventRecord {
  return {
    id: row.id,
    ts: row.ts,
    level: row.level,
    category: row.category,
    jobId: row.job_id,
    applicationId: row.application_id,
    sourceId: row.source_id,
    taskId: row.task_id,
    message: row.message,
    detail: parseJson<Record<string, unknown> | null>(row.detail, null),
    actor: row.actor
  }
}

export interface EventFilters {
  search?: string
  level?: Severity | 'all'
  category?: string
  jobId?: number
  applicationId?: number
  from?: number
  to?: number
  limit?: number
  offset?: number
}

export function listEvents(db: Db, filters: EventFilters = {}): { items: EventRecord[]; total: number } {
  const where: string[] = []
  const params: (string | number)[] = []

  if (filters.search) {
    where.push('(message LIKE ? OR category LIKE ?)')
    const needle = `%${filters.search}%`
    params.push(needle, needle)
  }
  if (filters.level && filters.level !== 'all') {
    where.push('level = ?')
    params.push(filters.level)
  }
  if (filters.category) {
    where.push('category = ?')
    params.push(filters.category)
  }
  if (filters.jobId) {
    where.push('job_id = ?')
    params.push(filters.jobId)
  }
  if (filters.applicationId) {
    where.push('application_id = ?')
    params.push(filters.applicationId)
  }
  if (filters.from) {
    where.push('ts >= ?')
    params.push(filters.from)
  }
  if (filters.to) {
    where.push('ts <= ?')
    params.push(filters.to)
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500)
  const offset = Math.max(filters.offset ?? 0, 0)

  const items = db
    .all<EventRow>(`SELECT * FROM events ${whereSql} ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?`, ...params, limit, offset)
    .map(mapEvent)
  const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM events ${whereSql}`, ...params)?.n ?? 0
  return { items, total }
}

export function countEventsByCategory(db: Db, from: number, to: number): Record<string, number> {
  const rows = db.all<{ category: string; n: number }>(
    'SELECT category, COUNT(*) AS n FROM events WHERE ts >= ? AND ts < ? GROUP BY category',
    from,
    to
  )
  return Object.fromEntries(rows.map((row) => [row.category, row.n]))
}

export function countDistinctEvents(
  db: Db,
  category: string,
  column: 'job_id' | 'application_id' | 'source_id',
  from: number,
  to: number
): number {
  return (
    db.get<{ n: number }>(
      `SELECT COUNT(DISTINCT ${column}) AS n FROM events WHERE category = ? AND ts >= ? AND ts < ? AND ${column} IS NOT NULL`,
      category,
      from,
      to
    )?.n ?? 0
  )
}

export function listEventsAfter(db: Db, afterId: number, limit = 100): EventRecord[] {
  return db
    .all<EventRow>('SELECT * FROM events WHERE id > ? ORDER BY id ASC LIMIT ?', Math.max(afterId, 0), Math.min(Math.max(limit, 1), 500))
    .map(mapEvent)
}

export function latestEvent(db: Db, category: string): EventRecord | undefined {
  const row = db.get<EventRow>('SELECT * FROM events WHERE category = ? ORDER BY ts DESC LIMIT 1', category)
  return row ? mapEvent(row) : undefined
}

export function recentErrors(db: Db, limit = 20): EventRecord[] {
  return db
    .all<EventRow>("SELECT * FROM events WHERE level = 'error' ORDER BY ts DESC LIMIT ?", limit)
    .map(mapEvent)
}

export function pruneEvents(db: Db, olderThan: number): number {
  return db.run('DELETE FROM events WHERE ts < ?', olderThan).changes
}
