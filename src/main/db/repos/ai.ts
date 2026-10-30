import type { AiProviderId, CircuitState } from '../../../shared/types'
import type { Db } from '../database'

export interface AiCallInput {
  provider: string
  model: string
  purpose: string
  status: 'success' | 'error' | 'timeout' | 'skipped'
  latencyMs?: number | null
  inputTokens?: number | null
  outputTokens?: number | null
  error?: string | null
}

export function logAiCall(db: Db, input: AiCallInput): void {
  db.run(
    `INSERT INTO ai_calls (provider, model, purpose, status, latency_ms, input_tokens, output_tokens, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.provider,
    input.model,
    input.purpose,
    input.status,
    input.latencyMs ?? null,
    input.inputTokens ?? null,
    input.outputTokens ?? null,
    input.error ? input.error.slice(0, 1000) : null,
    Date.now()
  )
}

export function countAiCallsSince(db: Db, from: number): number {
  return db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_calls WHERE created_at >= ?', from)?.n ?? 0
}

export function countAiErrorsSince(db: Db, from: number): number {
  return (
    db.get<{ n: number }>("SELECT COUNT(*) AS n FROM ai_calls WHERE created_at >= ? AND status != 'success'", from)?.n ?? 0
  )
}

export interface AiProviderStateRecord {
  provider: AiProviderId
  circuitState: CircuitState
  consecutiveFailures: number
  openedAt: number | null
  lastSuccessAt: number | null
  lastError: string | null
  updatedAt: number
}

export function listAiProviderStates(db: Db): AiProviderStateRecord[] {
  return db
    .all<{
      provider: AiProviderId
      circuit_state: CircuitState
      consecutive_failures: number
      opened_at: number | null
      last_success_at: number | null
      last_error: string | null
      updated_at: number
    }>('SELECT * FROM ai_provider_state ORDER BY provider')
    .map((row) => ({
      provider: row.provider,
      circuitState: row.circuit_state,
      consecutiveFailures: row.consecutive_failures,
      openedAt: row.opened_at,
      lastSuccessAt: row.last_success_at,
      lastError: row.last_error,
      updatedAt: row.updated_at
    }))
}

export function getAiProviderState(db: Db, provider: AiProviderId): AiProviderStateRecord | undefined {
  return listAiProviderStates(db).find((state) => state.provider === provider)
}

export function upsertAiProviderState(
  db: Db,
  input: {
    provider: AiProviderId
    circuitState: CircuitState
    consecutiveFailures: number
    openedAt: number | null
    lastSuccessAt: number | null
    lastError: string | null
  }
): void {
  db.run(
    `INSERT INTO ai_provider_state (provider, circuit_state, consecutive_failures, opened_at, last_success_at, last_error, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET circuit_state = excluded.circuit_state,
       consecutive_failures = excluded.consecutive_failures, opened_at = excluded.opened_at,
       last_success_at = excluded.last_success_at, last_error = excluded.last_error, updated_at = excluded.updated_at`,
    input.provider,
    input.circuitState,
    input.consecutiveFailures,
    input.openedAt,
    input.lastSuccessAt,
    input.lastError,
    Date.now()
  )
}

export function recordAiSuccess(db: Db, provider: AiProviderId): void {
  upsertAiProviderState(db, {
    provider,
    circuitState: 'closed',
    consecutiveFailures: 0,
    openedAt: null,
    lastSuccessAt: Date.now(),
    lastError: null
  })
}

export function recordAiFailure(db: Db, provider: AiProviderId, error: string, failureThreshold = 3, cooldownMs = 120_000): AiProviderStateRecord {
  const current = getAiProviderState(db, provider)
  const failures = (current?.consecutiveFailures ?? 0) + 1
  const shouldOpen = failures >= failureThreshold
  upsertAiProviderState(db, {
    provider,
    circuitState: shouldOpen ? 'open' : (current?.circuitState ?? 'closed'),
    consecutiveFailures: failures,
    openedAt: shouldOpen ? Date.now() : (current?.openedAt ?? null),
    lastSuccessAt: current?.lastSuccessAt ?? null,
    lastError: error.slice(0, 1000)
  })
  return getAiProviderState(db, provider)!
}

export function isCircuitAvailable(state: AiProviderStateRecord | undefined, now: number, cooldownMs = 120_000): boolean {
  if (!state) return true
  if (state.circuitState === 'closed') return true
  if (state.circuitState === 'open') {
    return state.openedAt !== null && now - state.openedAt >= cooldownMs
  }
  return true
}

export function resetAiProviderState(db: Db, provider: AiProviderId): void {
  db.run('DELETE FROM ai_provider_state WHERE provider = ?', provider)
}

export function pruneAiCalls(db: Db, olderThan: number): number {
  return db.run('DELETE FROM ai_calls WHERE created_at < ?', olderThan).changes
}
