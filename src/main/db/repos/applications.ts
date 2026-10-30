import type { ApplicationChannel, ApplicationStatus, EligibilityVerdict } from '../../../shared/types'
import type { Db } from '../database'
import { parseJson, parseJsonObject, toJson } from '../../core/json'
import { logEvent } from './events'

export const APPLICATION_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  draft: ['awaiting_approval', 'approved', 'queued', 'needs_human', 'rejected'],
  awaiting_approval: ['approved', 'rejected', 'queued', 'needs_human'],
  approved: ['queued', 'rejected', 'needs_human'],
  queued: ['sending', 'failed', 'needs_human'],
  sending: ['submitted', 'failed', 'uncertain'],
  submitted: [],
  failed: ['queued', 'needs_human', 'withdrawn'],
  uncertain: ['submitted', 'queued', 'failed'],
  needs_human: ['queued', 'rejected', 'withdrawn', 'submitted'],
  rejected: [],
  withdrawn: []
}

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return APPLICATION_TRANSITIONS[from].includes(to)
}

export interface ApplicationRecord {
  id: number
  jobId: number
  channel: ApplicationChannel
  channelReason: string
  decisionEvidence: Record<string, unknown>
  status: ApplicationStatus
  active: boolean
  attempt: number
  resumeId: number | null
  templateId: number | null
  subject: string | null
  body: string | null
  recipient: string | null
  applyUrl: string | null
  lastError: string | null
  confirmation: Record<string, unknown> | null
  approvedAt: number | null
  submittedAt: number | null
  createdAt: number
  updatedAt: number
}

interface ApplicationRow {
  id: number
  job_id: number
  channel: ApplicationChannel
  channel_reason: string
  decision_evidence: string
  status: ApplicationStatus
  active: number
  attempt: number
  resume_id: number | null
  template_id: number | null
  subject: string | null
  body: string | null
  recipient: string | null
  apply_url: string | null
  last_error: string | null
  confirmation: string | null
  approved_at: number | null
  submitted_at: number | null
  created_at: number
  updated_at: number
}

function mapApplication(row: ApplicationRow): ApplicationRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    channel: row.channel,
    channelReason: row.channel_reason,
    decisionEvidence: parseJsonObject(row.decision_evidence, {}),
    status: row.status,
    active: row.active === 1,
    attempt: row.attempt,
    resumeId: row.resume_id,
    templateId: row.template_id,
    subject: row.subject,
    body: row.body,
    recipient: row.recipient,
    applyUrl: row.apply_url,
    lastError: row.last_error,
    confirmation: parseJson<Record<string, unknown> | null>(row.confirmation, null),
    approvedAt: row.approved_at,
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function getApplication(db: Db, id: number): ApplicationRecord | undefined {
  const row = db.get<ApplicationRow>('SELECT * FROM applications WHERE id = ?', id)
  return row ? mapApplication(row) : undefined
}

export function getActiveApplicationForJob(db: Db, jobId: number): ApplicationRecord | undefined {
  const row = db.get<ApplicationRow>('SELECT * FROM applications WHERE job_id = ? AND active = 1', jobId)
  return row ? mapApplication(row) : undefined
}

export interface CreateApplicationInput {
  jobId: number
  channel: ApplicationChannel
  channelReason: string
  decisionEvidence: Record<string, unknown>
  status: ApplicationStatus
  subject?: string | null
  body?: string | null
  recipient?: string | null
  applyUrl?: string | null
  resumeId?: number | null
  templateId?: number | null
}

export function createApplication(db: Db, input: CreateApplicationInput): { application: ApplicationRecord; created: boolean } {
  const existing = getActiveApplicationForJob(db, input.jobId)
  if (existing) return { application: existing, created: false }

  const now = Date.now()
  const previous = db.get<{ attempt: number }>(
    'SELECT MAX(attempt) AS attempt FROM applications WHERE job_id = ?',
    input.jobId
  )
  const attempt = (previous?.attempt ?? 0) + 1
  const result = db.run(
    `INSERT INTO applications (job_id, channel, channel_reason, decision_evidence, status, active, attempt,
       resume_id, template_id, subject, body, recipient, apply_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.jobId,
    input.channel,
    input.channelReason,
    toJson(input.decisionEvidence),
    input.status,
    attempt,
    input.resumeId ?? null,
    input.templateId ?? null,
    input.subject ?? null,
    input.body ?? null,
    input.recipient ?? null,
    input.applyUrl ?? null,
    now,
    now
  )
  return { application: getApplication(db, result.lastInsertRowid)!, created: true }
}

export interface ApplicationPatch {
  subject?: string | null
  body?: string | null
  recipient?: string | null
  applyUrl?: string | null
  resumeId?: number | null
  templateId?: number | null
  lastError?: string | null
  confirmation?: Record<string, unknown> | null
  approvedAt?: number | null
  submittedAt?: number | null
}

export function patchApplication(db: Db, id: number, patch: ApplicationPatch): ApplicationRecord {
  const current = getApplication(db, id)
  if (!current) throw new Error(`Application ${id} not found`)
  const merged = { ...current, ...patch }
  const deactivating = merged.status === 'rejected' || merged.status === 'withdrawn'
  db.run(
    `UPDATE applications SET subject = ?, body = ?, recipient = ?, apply_url = ?, resume_id = ?, template_id = ?,
       last_error = ?, confirmation = ?, approved_at = ?, submitted_at = ?, active = ?, updated_at = ?
     WHERE id = ?`,
    merged.subject ?? null,
    merged.body ?? null,
    merged.recipient ?? null,
    merged.applyUrl ?? null,
    merged.resumeId ?? null,
    merged.templateId ?? null,
    merged.lastError ?? null,
    merged.confirmation ? toJson(merged.confirmation) : null,
    merged.approvedAt ?? null,
    merged.submittedAt ?? null,
    deactivating ? 0 : current.active ? 1 : 0,
    Date.now(),
    id
  )
  return getApplication(db, id)!
}

export function setApplicationStatus(db: Db, id: number, next: ApplicationStatus, options: { error?: string | null; confirmation?: Record<string, unknown> | null } = {}): ApplicationRecord {
  const current = getApplication(db, id)
  if (!current) throw new Error(`Application ${id} not found`)
  if (current.status === next) return current
  if (!canTransition(current.status, next)) {
    throw new Error(`Invalid application transition: ${current.status} -> ${next}`)
  }
  const now = Date.now()
  const terminal = next === 'rejected' || next === 'withdrawn'
  db.run(
    `UPDATE applications SET status = ?, active = ?, last_error = ?, confirmation = COALESCE(?, confirmation),
       approved_at = CASE WHEN ? = 'approved' THEN ? ELSE approved_at END,
       submitted_at = CASE WHEN ? = 'submitted' THEN ? ELSE submitted_at END,
       updated_at = ? WHERE id = ?`,
    next,
    terminal ? 0 : 1,
    options.error ?? null,
    options.confirmation ? toJson(options.confirmation) : null,
    next,
    now,
    next,
    now,
    now,
    id
  )
  logEvent(db, {
    category: 'application.status',
    level: next === 'failed' || next === 'uncertain' ? 'warn' : 'info',
    message: `Application #${id} moved ${current.status} → ${next}`,
    applicationId: id,
    jobId: current.jobId,
    detail: { from: current.status, to: next, error: options.error ?? null }
  })
  return getApplication(db, id)!
}

export interface ApplicationListItem {
  id: number
  jobId: number
  jobTitle: string
  company: string
  countryCode: string | null
  channel: ApplicationChannel
  status: ApplicationStatus
  score: number | null
  verdict: EligibilityVerdict | null
  subject: string | null
  recipient: string | null
  applyUrl: string | null
  attempt: number
  createdAt: number
  updatedAt: number
  submittedAt: number | null
  lastError: string | null
}

export interface ApplicationFilters {
  search?: string
  status?: ApplicationStatus | 'all'
  channel?: ApplicationChannel | 'all'
  limit?: number
  offset?: number
}

export function listApplications(db: Db, filters: ApplicationFilters = {}): { items: ApplicationListItem[]; total: number } {
  const where: string[] = []
  const params: (string | number)[] = []
  if (filters.search) {
    where.push('(j.title LIKE ? OR j.company LIKE ?)')
    const needle = `%${filters.search}%`
    params.push(needle, needle)
  }
  if (filters.status && filters.status !== 'all') {
    where.push('a.status = ?')
    params.push(filters.status)
  }
  if (filters.channel && filters.channel !== 'all') {
    where.push('a.channel = ?')
    params.push(filters.channel)
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500)
  const offset = Math.max(filters.offset ?? 0, 0)

  const rows = db.all<{
    id: number
    job_id: number
    title: string
    company: string
    country_code: string | null
    channel: ApplicationChannel
    status: ApplicationStatus
    score: number | null
    verdict: EligibilityVerdict | null
    subject: string | null
    recipient: string | null
    apply_url: string | null
    attempt: number
    created_at: number
    updated_at: number
    submitted_at: number | null
    last_error: string | null
  }>(
    `SELECT a.id, a.job_id, j.title, j.company, j.country_code, a.channel, a.status, e.score, e.verdict,
       a.subject, a.recipient, a.apply_url, a.attempt, a.created_at, a.updated_at, a.submitted_at, a.last_error
     FROM applications a
     JOIN jobs j ON j.id = a.job_id
     LEFT JOIN job_evaluations e ON e.job_id = a.job_id
     ${whereSql} ORDER BY a.updated_at DESC LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset
  )
  const total =
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM applications a JOIN jobs j ON j.id = a.job_id ${whereSql}`,
      ...params
    )?.n ?? 0

  return {
    items: rows.map((row) => ({
      id: row.id,
      jobId: row.job_id,
      jobTitle: row.title,
      company: row.company,
      countryCode: row.country_code,
      channel: row.channel,
      status: row.status,
      score: row.score,
      verdict: row.verdict,
      subject: row.subject,
      recipient: row.recipient,
      applyUrl: row.apply_url,
      attempt: row.attempt,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      submittedAt: row.submitted_at,
      lastError: row.last_error
    })),
    total
  }
}

export interface ApplicationStats {
  total: number
  awaitingApproval: number
  needsHuman: number
  queued: number
  submitted: number
  emailSubmitted: number
  webSubmitted: number
  failed: number
  uncertain: number
  rejected: number
}

export function getApplicationStats(db: Db): ApplicationStats {
  const count = (where: string, ...params: (string | number)[]): number =>
    db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM applications WHERE ${where}`, ...params)?.n ?? 0
  return {
    total: count('active = 1'),
    awaitingApproval: count("status = 'awaiting_approval' AND active = 1"),
    needsHuman: count("status = 'needs_human' AND active = 1"),
    queued: count("status IN ('queued','approved') AND active = 1"),
    submitted: count("status = 'submitted'", ),
    emailSubmitted: count("status = 'submitted' AND channel = 'email'"),
    webSubmitted: count("status = 'submitted' AND channel = 'web'"),
    failed: count("status = 'failed' AND active = 1"),
    uncertain: count("status = 'uncertain' AND active = 1"),
    rejected: count("status = 'rejected'")
  }
}

export interface OutboxAttachment {
  resumeId: number
  fileName: string
  storedPath: string
  sizeBytes: number
  mimeType: string
  sha256: string
}

export interface OutboxRecord {
  id: number
  applicationId: number
  adapter: 'mock' | 'smtp'
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'uncertain' | 'cancelled'
  toAddress: string
  fromAddress: string | null
  subject: string
  bodyText: string
  attachments: OutboxAttachment[]
  attempt: number
  idempotencyKey: string
  providerMessageId: string | null
  error: string | null
  queuedAt: number
  sentAt: number | null
  updatedAt: number
}

interface OutboxRow {
  id: number
  application_id: number
  adapter: 'mock' | 'smtp'
  status: OutboxRecord['status']
  to_address: string
  from_address: string | null
  subject: string
  body_text: string
  attachments: string
  attempt: number
  idempotency_key: string
  provider_message_id: string | null
  error: string | null
  queued_at: number
  sent_at: number | null
  updated_at: number
}

function mapOutbox(row: OutboxRow): OutboxRecord {
  return {
    id: row.id,
    applicationId: row.application_id,
    adapter: row.adapter,
    status: row.status,
    toAddress: row.to_address,
    fromAddress: row.from_address,
    subject: row.subject,
    bodyText: row.body_text,
    attachments: parseJson<OutboxAttachment[]>(row.attachments, []),
    attempt: row.attempt,
    idempotencyKey: row.idempotency_key,
    providerMessageId: row.provider_message_id,
    error: row.error,
    queuedAt: row.queued_at,
    sentAt: row.sent_at,
    updatedAt: row.updated_at
  }
}

export function createOutboxMessage(
  db: Db,
  input: {
    applicationId: number
    adapter: 'mock' | 'smtp'
    toAddress: string
    fromAddress: string | null
    subject: string
    bodyText: string
    attachments: OutboxAttachment[]
    attempt: number
  }
): { message: OutboxRecord; created: boolean } {
  const idempotencyKey = `app:${input.applicationId}:attempt:${input.attempt}`
  const existing = db.get<OutboxRow>('SELECT * FROM outbox_messages WHERE idempotency_key = ?', idempotencyKey)
  if (existing) return { message: mapOutbox(existing), created: false }

  const now = Date.now()
  const result = db.run(
    `INSERT INTO outbox_messages (application_id, adapter, status, to_address, from_address, subject, body_text,
       attachments, attempt, idempotency_key, queued_at, updated_at)
     VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.applicationId,
    input.adapter,
    input.toAddress,
    input.fromAddress,
    input.subject,
    input.bodyText,
    toJson(input.attachments),
    input.attempt,
    idempotencyKey,
    now,
    now
  )
  const row = db.get<OutboxRow>('SELECT * FROM outbox_messages WHERE id = ?', result.lastInsertRowid)!
  return { message: mapOutbox(row), created: true }
}

export function getOutbox(db: Db, id: number): OutboxRecord | undefined {
  const row = db.get<OutboxRow>('SELECT * FROM outbox_messages WHERE id = ?', id)
  return row ? mapOutbox(row) : undefined
}

export function claimOutboxMessage(db: Db, id: number): OutboxRecord | undefined {
  const now = Date.now()
  db.run(
    `UPDATE outbox_messages SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'queued'`,
    now,
    id
  )
  return getOutbox(db, id)
}

export function markOutboxSent(db: Db, id: number, providerMessageId: string | null): void {
  const now = Date.now()
  db.run(
    `UPDATE outbox_messages SET status = 'sent', provider_message_id = ?, sent_at = ?, updated_at = ?, error = NULL
     WHERE id = ?`,
    providerMessageId,
    now,
    now,
    id
  )
}

export function markOutboxFailed(db: Db, id: number, error: string, status: 'failed' | 'uncertain' = 'failed'): void {
  db.run('UPDATE outbox_messages SET status = ?, error = ?, updated_at = ? WHERE id = ?', status, error.slice(0, 2000), Date.now(), id)
}

export function logOutboxAttempt(
  db: Db,
  input: { outboxId: number; attempt: number; startedAt: number; result: string; error?: string | null; providerResponse?: unknown }
): void {
  db.run(
    `INSERT INTO outbox_attempts (outbox_id, attempt, started_at, finished_at, result, error, provider_response)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    input.outboxId,
    input.attempt,
    input.startedAt,
    Date.now(),
    input.result,
    input.error ?? null,
    input.providerResponse ? toJson(input.providerResponse) : null
  )
}

export interface OutboxListItem extends OutboxRecord {
  jobTitle: string
  company: string
}

export function listOutbox(db: Db, filters: { status?: OutboxRecord['status'] | 'all'; limit?: number } = {}): OutboxListItem[] {
  const where = filters.status && filters.status !== 'all' ? 'WHERE o.status = ?' : ''
  const params: (string | number)[] = filters.status && filters.status !== 'all' ? [filters.status] : []
  const rows = db.all<OutboxRow & { title: string; company: string }>(
    `SELECT o.*, j.title, j.company FROM outbox_messages o
     JOIN applications a ON a.id = o.application_id
     JOIN jobs j ON j.id = a.job_id
     ${where} ORDER BY o.updated_at DESC LIMIT ?`,
    ...params,
    filters.limit ?? 100
  )
  return rows.map((row) => ({ ...mapOutbox(row), jobTitle: row.title, company: row.company }))
}

export function listOutboxForApplication(db: Db, applicationId: number): OutboxRecord[] {
  return db
    .all<OutboxRow>('SELECT * FROM outbox_messages WHERE application_id = ? ORDER BY attempt ASC', applicationId)
    .map(mapOutbox)
}

/** Finds messages stuck in `sending`, which indicates a crash between send and record. */
export function listStaleSending(db: Db, olderThan: number): OutboxRecord[] {
  return db
    .all<OutboxRow>("SELECT * FROM outbox_messages WHERE status = 'sending' AND updated_at < ?", olderThan)
    .map(mapOutbox)
}

export function markStaleAsUncertain(db: Db, olderThan: number): number {
  return db.run(
    `UPDATE outbox_messages SET status = 'uncertain', error = 'interrupted while sending; outcome requires reconciliation',
       updated_at = ? WHERE status = 'sending' AND updated_at < ?`,
    Date.now(),
    olderThan
  ).changes
}

export interface ResponseRecord {
  id: number
  applicationId: number
  receivedAt: number
  channel: string
  kind: string
  notes: string | null
  createdAt: number
}

export function addResponse(
  db: Db,
  input: { applicationId: number; receivedAt?: number; channel?: string; kind: string; notes?: string | null }
): ResponseRecord {
  const now = Date.now()
  const result = db.run(
    'INSERT INTO responses (application_id, received_at, channel, kind, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    input.applicationId,
    input.receivedAt ?? now,
    input.channel ?? 'email',
    input.kind,
    input.notes ?? null,
    now
  )
  return db
    .all<{
      id: number
      application_id: number
      received_at: number
      channel: string
      kind: string
      notes: string | null
      created_at: number
    }>('SELECT * FROM responses WHERE id = ?', result.lastInsertRowid)
    .map((row) => ({
      id: row.id,
      applicationId: row.application_id,
      receivedAt: row.received_at,
      channel: row.channel,
      kind: row.kind,
      notes: row.notes,
      createdAt: row.created_at
    }))[0]!
}

export function listResponses(db: Db, applicationId: number): ResponseRecord[] {
  return db
    .all<{
      id: number
      application_id: number
      received_at: number
      channel: string
      kind: string
      notes: string | null
      created_at: number
    }>('SELECT * FROM responses WHERE application_id = ? ORDER BY received_at DESC', applicationId)
    .map((row) => ({
      id: row.id,
      applicationId: row.application_id,
      receivedAt: row.received_at,
      channel: row.channel,
      kind: row.kind,
      notes: row.notes,
      createdAt: row.created_at
    }))
}

export function countResponsesSince(db: Db, from: number): number {
  return db.get<{ n: number }>('SELECT COUNT(*) AS n FROM responses WHERE received_at >= ?', from)?.n ?? 0
}

export function countSubmittedSince(db: Db, from: number, channel?: ApplicationChannel): number {
  if (channel) {
    return (
      db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM applications WHERE status = 'submitted' AND channel = ? AND submitted_at >= ?",
        channel,
        from
      )?.n ?? 0
    )
  }
  return (
    db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM applications WHERE status = 'submitted' AND submitted_at >= ?",
      from
    )?.n ?? 0
  )
}

export function countApplicationsForCompanySince(db: Db, company: string, from: number, excludeApplicationId?: number): number {
  return (
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM applications a JOIN jobs j ON j.id = a.job_id
       WHERE LOWER(j.company) = LOWER(?) AND a.created_at >= ? AND a.active = 1
       ${excludeApplicationId ? 'AND a.id != ?' : ''}`,
      ...(excludeApplicationId ? [company, from, excludeApplicationId] : [company, from])
    )?.n ?? 0
  )
}
