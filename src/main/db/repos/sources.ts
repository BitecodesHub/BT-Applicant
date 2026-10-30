import type { Db } from '../database'
import { parseJson, parseJsonObject, toJson } from '../../core/json'

export interface SourceRecord {
  id: string
  connector: string
  label: string
  config: Record<string, unknown>
  enabled: boolean
  countries: string[]
  rateLimitPerMinute: number
  lastSuccessAt: number | null
  lastErrorAt: number | null
  lastError: string | null
  consecutiveFailures: number
  lastItemCount: number | null
  verifiedAt: number | null
  createdAt: number
  updatedAt: number
}

interface SourceRow {
  id: string
  connector: string
  label: string
  config: string
  enabled: number
  countries: string
  rate_limit_per_minute: number
  last_success_at: number | null
  last_error_at: number | null
  last_error: string | null
  consecutive_failures: number
  last_item_count: number | null
  verified_at: number | null
  created_at: number
  updated_at: number
}

function mapSource(row: SourceRow): SourceRecord {
  return {
    id: row.id,
    connector: row.connector,
    label: row.label,
    config: parseJsonObject(row.config, {}),
    enabled: row.enabled === 1,
    countries: parseJson<string[]>(row.countries, []),
    rateLimitPerMinute: row.rate_limit_per_minute,
    lastSuccessAt: row.last_success_at,
    lastErrorAt: row.last_error_at,
    lastError: row.last_error,
    consecutiveFailures: row.consecutive_failures,
    lastItemCount: row.last_item_count,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listSources(db: Db): SourceRecord[] {
  return db.all<SourceRow>('SELECT * FROM sources ORDER BY label').map(mapSource)
}

export function getSource(db: Db, id: string): SourceRecord | undefined {
  const row = db.get<SourceRow>('SELECT * FROM sources WHERE id = ?', id)
  return row ? mapSource(row) : undefined
}

export interface SourceInput {
  id: string
  connector: string
  label: string
  config: Record<string, unknown>
  enabled: boolean
  countries: string[]
  rateLimitPerMinute: number
}

export function upsertSource(db: Db, input: SourceInput): SourceRecord {
  const now = Date.now()
  db.run(
    `INSERT INTO sources (id, connector, label, config, enabled, countries, rate_limit_per_minute, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET connector = excluded.connector, label = excluded.label,
       config = excluded.config, enabled = excluded.enabled, countries = excluded.countries,
       rate_limit_per_minute = excluded.rate_limit_per_minute, updated_at = excluded.updated_at`,
    input.id,
    input.connector,
    input.label,
    toJson(input.config),
    input.enabled ? 1 : 0,
    toJson(input.countries),
    input.rateLimitPerMinute,
    now,
    now
  )
  return getSource(db, input.id)!
}

export function setSourceEnabled(db: Db, id: string, enabled: boolean): void {
  db.run('UPDATE sources SET enabled = ?, updated_at = ? WHERE id = ?', enabled ? 1 : 0, Date.now(), id)
}

export function deleteSource(db: Db, id: string): void {
  db.run('DELETE FROM sources WHERE id = ?', id)
}

export function recordSourceSuccess(db: Db, id: string, itemCount: number): void {
  const now = Date.now()
  db.run(
    `UPDATE sources SET last_success_at = ?, last_error = NULL, last_error_at = NULL,
       consecutive_failures = 0, last_item_count = ?, updated_at = ? WHERE id = ?`,
    now,
    itemCount,
    now,
    id
  )
}

export function recordSourceFailure(db: Db, id: string, error: string): void {
  const now = Date.now()
  db.run(
    `UPDATE sources SET last_error_at = ?, last_error = ?, consecutive_failures = consecutive_failures + 1,
       updated_at = ? WHERE id = ?`,
    now,
    error.slice(0, 2000),
    now,
    id
  )
}

export function markSourceVerified(db: Db, id: string, itemCount: number): void {
  const now = Date.now()
  db.run(
    `UPDATE sources SET verified_at = ?, last_success_at = ?, last_item_count = ?,
       consecutive_failures = 0, last_error = NULL, updated_at = ? WHERE id = ?`,
    now,
    now,
    itemCount,
    now,
    id
  )
}

export function logSourceFetch(
  db: Db,
  input: {
    sourceId: string
    startedAt: number
    finishedAt: number
    status: 'ok' | 'error' | 'rate_limited'
    items: number
    newItems: number
    error?: string | null
  }
): void {
  db.run(
    `INSERT INTO source_fetches (source_id, started_at, finished_at, status, items, new_items, error, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    input.sourceId,
    input.startedAt,
    input.finishedAt,
    input.status,
    input.items,
    input.newItems,
    input.error ?? null,
    input.finishedAt - input.startedAt
  )
}

export interface SourceFetchRecord {
  id: number
  sourceId: string
  startedAt: number
  finishedAt: number | null
  status: string
  items: number
  newItems: number
  error: string | null
  durationMs: number | null
}

export function listSourceFetches(db: Db, sourceId: string, limit = 20): SourceFetchRecord[] {
  return db
    .all<{
      id: number
      source_id: string
      started_at: number
      finished_at: number | null
      status: string
      items: number
      new_items: number
      error: string | null
      duration_ms: number | null
    }>('SELECT * FROM source_fetches WHERE source_id = ? ORDER BY started_at DESC LIMIT ?', sourceId, limit)
    .map((row) => ({
      id: row.id,
      sourceId: row.source_id,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      status: row.status,
      items: row.items,
      newItems: row.new_items,
      error: row.error,
      durationMs: row.duration_ms
    }))
}
