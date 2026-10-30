import type { Db } from '../database'

export type ChatProvider = 'telegram' | 'whatsapp'
export type ChatChannel = ChatProvider | 'local'
export type ChatMessageStatus = 'received' | 'sent' | 'failed' | 'ignored' | 'rejected'

export interface ChatStateRecord {
  provider: ChatProvider
  lastUpdateId: number | null
  lastEventId: number
  lastActivityAt: number | null
  lastSuccessAt: number | null
  lastError: string | null
  lastErrorAt: number | null
  webhookVerifiedAt: number | null
  updatedAt: number
}

interface ChatStateRow {
  provider: ChatProvider
  last_update_id: number | null
  last_event_id: number
  last_activity_at: number | null
  last_success_at: number | null
  last_error: string | null
  last_error_at: number | null
  webhook_verified_at: number | null
  updated_at: number
}

function mapState(row: ChatStateRow): ChatStateRecord {
  return {
    provider: row.provider,
    lastUpdateId: row.last_update_id,
    lastEventId: row.last_event_id,
    lastActivityAt: row.last_activity_at,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error,
    lastErrorAt: row.last_error_at,
    webhookVerifiedAt: row.webhook_verified_at,
    updatedAt: row.updated_at
  }
}

export function ensureChatState(db: Db, provider: ChatProvider, now = Date.now()): ChatStateRecord {
  const maxEvent = db.get<{ id: number | null }>('SELECT MAX(id) AS id FROM events')?.id ?? 0
  db.run(
    `INSERT OR IGNORE INTO chat_state (provider, last_event_id, updated_at) VALUES (?, ?, ?)`,
    provider,
    maxEvent,
    now
  )
  return getChatState(db, provider)!
}

export function getChatState(db: Db, provider: ChatProvider): ChatStateRecord | undefined {
  const row = db.get<ChatStateRow>('SELECT * FROM chat_state WHERE provider = ?', provider)
  return row ? mapState(row) : undefined
}

export interface ChatStatePatch {
  lastUpdateId?: number | null
  lastEventId?: number
  lastActivityAt?: number | null
  lastSuccessAt?: number | null
  lastError?: string | null
  lastErrorAt?: number | null
  webhookVerifiedAt?: number | null
}

const STATE_COLUMNS: Record<keyof ChatStatePatch, string> = {
  lastUpdateId: 'last_update_id',
  lastEventId: 'last_event_id',
  lastActivityAt: 'last_activity_at',
  lastSuccessAt: 'last_success_at',
  lastError: 'last_error',
  lastErrorAt: 'last_error_at',
  webhookVerifiedAt: 'webhook_verified_at'
}

export function patchChatState(db: Db, provider: ChatProvider, patch: ChatStatePatch, now = Date.now()): void {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined)
  if (entries.length === 0) return
  ensureChatState(db, provider, now)
  const assignments = entries.map(([key]) => `${STATE_COLUMNS[key as keyof ChatStatePatch]} = ?`)
  const values = entries.map(([, value]) => (value === null ? null : value)) as (string | number | null)[]
  db.run(
    `UPDATE chat_state SET ${assignments.join(', ')}, updated_at = ? WHERE provider = ?`,
    ...values,
    now,
    provider
  )
}

export interface ChatMessageRecord {
  id: number
  provider: ChatChannel
  direction: 'inbound' | 'outbound'
  externalId: string | null
  chatRef: string
  summary: string
  command: string | null
  status: ChatMessageStatus
  error: string | null
  createdAt: number
}

interface ChatMessageRow {
  id: number
  provider: ChatChannel
  direction: 'inbound' | 'outbound'
  external_id: string | null
  chat_ref: string
  summary: string
  command: string | null
  status: ChatMessageStatus
  error: string | null
  created_at: number
}

function mapMessage(row: ChatMessageRow): ChatMessageRecord {
  return {
    id: row.id,
    provider: row.provider,
    direction: row.direction,
    externalId: row.external_id,
    chatRef: row.chat_ref,
    summary: row.summary,
    command: row.command,
    status: row.status,
    error: row.error,
    createdAt: row.created_at
  }
}

export function recordChatMessage(
  db: Db,
  input: {
    provider: ChatChannel
    direction: 'inbound' | 'outbound'
    externalId?: string | null
    chatRef: string
    summary: string
    command?: string | null
    status: ChatMessageStatus
    error?: string | null
  },
  now = Date.now()
): { inserted: boolean; id: number | null } {
  if (input.externalId) {
    const existing = db.get<{ id: number }>(
      'SELECT id FROM chat_messages WHERE provider = ? AND external_id = ?',
      input.provider,
      input.externalId
    )
    if (existing) return { inserted: false, id: existing.id }
  }
  const result = db.run(
    `INSERT INTO chat_messages (provider, direction, external_id, chat_ref, summary, command, status, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.provider,
    input.direction,
    input.externalId ?? null,
    input.chatRef,
    input.summary.slice(0, 500),
    input.command ?? null,
    input.status,
    input.error ? input.error.slice(0, 500) : null,
    now
  )
  return { inserted: true, id: result.lastInsertRowid }
}

export function listChatMessages(db: Db, limit = 40): ChatMessageRecord[] {
  return db.all<ChatMessageRow>('SELECT * FROM chat_messages ORDER BY id DESC LIMIT ?', Math.min(Math.max(limit, 1), 200)).map(mapMessage)
}

export function pruneChatMessages(db: Db, before: number): number {
  return db.run('DELETE FROM chat_messages WHERE created_at < ?', before).changes
}

export interface ChatActionRecord {
  id: number
  kind: string
  provider: ChatChannel
  providerRef: string
  applicationId: number
  reason: string | null
  expiresAt: number
  usedAt: number | null
  createdAt: number
}

interface ChatActionRow {
  id: number
  kind: string
  provider: ChatChannel
  provider_ref: string
  application_id: number
  reason: string | null
  token_hash: string
  expires_at: number
  used_at: number | null
  created_at: number
}

function mapAction(row: ChatActionRow): ChatActionRecord {
  return {
    id: row.id,
    kind: row.kind,
    provider: row.provider,
    providerRef: row.provider_ref,
    applicationId: row.application_id,
    reason: row.reason,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    createdAt: row.created_at
  }
}

export function createChatAction(
  db: Db,
  input: { kind: string; provider: ChatChannel; providerRef: string; applicationId: number; reason?: string | null; tokenHash: string; expiresAt: number },
  now = Date.now()
): number {
  const result = db.run(
    `INSERT INTO chat_actions (kind, provider, provider_ref, application_id, reason, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    input.kind,
    input.provider,
    input.providerRef,
    input.applicationId,
    input.reason ?? null,
    input.tokenHash,
    input.expiresAt,
    now
  )
  return result.lastInsertRowid
}

export function consumeChatAction(
  db: Db,
  tokenHash: string,
  provider: ChatChannel,
  providerRef: string,
  now = Date.now()
): ChatActionRecord | undefined {
  return db.tx(() => {
    const row = db.get<ChatActionRow>(
      `SELECT * FROM chat_actions WHERE token_hash = ? AND provider = ? AND provider_ref = ? AND used_at IS NULL AND expires_at > ?`,
      tokenHash,
      provider,
      providerRef,
      now
    )
    if (!row) return undefined
    const update = db.run('UPDATE chat_actions SET used_at = ? WHERE id = ? AND used_at IS NULL', now, row.id)
    if (update.changes === 0) return undefined
    return mapAction({ ...row, used_at: now })
  })
}

export function pruneChatActions(db: Db, now = Date.now()): number {
  return db.run(
    'DELETE FROM chat_actions WHERE expires_at < ? OR (used_at IS NOT NULL AND used_at < ?)',
    now - 7 * 86_400_000,
    now - 86_400_000
  ).changes
}
