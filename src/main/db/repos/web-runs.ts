import type { Db } from '../database'
import { parseJson, parseJsonObject, toJson } from '../../core/json'

export type WebRunStatus = 'prepared' | 'awaiting_human' | 'submitted' | 'failed' | 'cancelled'

export interface WebRunStep {
  label: string
  status: 'pending' | 'done' | 'blocked' | 'failed'
  detail?: string
}

export interface WebRunRecord {
  id: number
  applicationId: number
  url: string
  status: WebRunStatus
  steps: WebRunStep[]
  prefilled: Record<string, unknown>
  lastError: string | null
  confirmation: Record<string, unknown> | null
  createdAt: number
  updatedAt: number
}

interface WebRunRow {
  id: number
  application_id: number
  url: string
  status: WebRunStatus
  steps: string
  prefilled: string
  last_error: string | null
  confirmation: string | null
  created_at: number
  updated_at: number
}

function mapRow(row: WebRunRow): WebRunRecord {
  return {
    id: row.id,
    applicationId: row.application_id,
    url: row.url,
    status: row.status,
    steps: parseJson<WebRunStep[]>(row.steps, []),
    prefilled: parseJsonObject(row.prefilled, {}),
    lastError: row.last_error,
    confirmation: parseJson<Record<string, unknown> | null>(row.confirmation, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function getWebRunForApplication(db: Db, applicationId: number): WebRunRecord | undefined {
  const row = db.get<WebRunRow>('SELECT * FROM web_runs WHERE application_id = ? ORDER BY id DESC LIMIT 1', applicationId)
  return row ? mapRow(row) : undefined
}

export function getWebRun(db: Db, id: number): WebRunRecord | undefined {
  const row = db.get<WebRunRow>('SELECT * FROM web_runs WHERE id = ?', id)
  return row ? mapRow(row) : undefined
}

export function listWebRuns(db: Db, limit = 50): WebRunRecord[] {
  return db.all<WebRunRow>('SELECT * FROM web_runs ORDER BY updated_at DESC LIMIT ?', limit).map(mapRow)
}

export function createWebRun(
  db: Db,
  input: { applicationId: number; url: string; steps: WebRunStep[]; prefilled: Record<string, unknown>; status?: WebRunStatus }
): WebRunRecord {
  const now = Date.now()
  const result = db.run(
    `INSERT INTO web_runs (application_id, url, status, steps, prefilled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    input.applicationId,
    input.url,
    input.status ?? 'prepared',
    toJson(input.steps),
    toJson(input.prefilled),
    now,
    now
  )
  return getWebRun(db, result.lastInsertRowid)!
}

export function updateWebRun(
  db: Db,
  id: number,
  patch: {
    status?: WebRunStatus
    steps?: WebRunStep[]
    prefilled?: Record<string, unknown>
    lastError?: string | null
    confirmation?: Record<string, unknown> | null
  }
): WebRunRecord {
  const current = getWebRun(db, id)
  if (!current) throw new Error(`Web run ${id} not found`)
  db.run(
    `UPDATE web_runs SET status = ?, steps = ?, prefilled = ?, last_error = ?, confirmation = ?, updated_at = ? WHERE id = ?`,
    patch.status ?? current.status,
    toJson(patch.steps ?? current.steps),
    toJson(patch.prefilled ?? current.prefilled),
    patch.lastError ?? current.lastError,
    patch.confirmation !== undefined ? (patch.confirmation ? toJson(patch.confirmation) : null) : current.confirmation ? toJson(current.confirmation) : null,
    Date.now(),
    id
  )
  return getWebRun(db, id)!
}
