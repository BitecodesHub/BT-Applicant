import type { AiProviderId } from '../../shared/types'
import type { Db } from '../db/database'
import { getSection, type AppSettings } from '../core/settings'
import type { SecretStore } from '../core/secrets'
import {
  countAiCallsSince,
  getAiProviderState,
  isCircuitAvailable,
  logAiCall,
  recordAiFailure,
  recordAiSuccess,
  listAiProviderStates
} from '../db/repos/ai'

export interface AiTextRequest {
  purpose: string
  system: string
  prompt: string
  maxTokens?: number
}

export type AiFailureReason = 'disabled' | 'simulated_outage' | 'quota' | 'no_provider' | 'error'

export interface AiTextResult {
  ok: boolean
  text: string | null
  provider: AiProviderId | null
  model: string | null
  latencyMs: number
  error: string | null
  reason: AiFailureReason | null
}

export interface AiProviderHealth {
  id: AiProviderId
  label: string
  model: string
  configured: boolean
  circuitState: 'closed' | 'open' | 'half_open'
  consecutiveFailures: number
  lastSuccessAt: number | null
  lastError: string | null
}

const LABELS: Record<AiProviderId, string> = {
  ollama: 'Ollama (local)',
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  openai_compatible: 'OpenAI-compatible endpoint'
}

const KEY_NAMES: Record<Exclude<AiProviderId, 'ollama'>, string> = {
  anthropic: 'ai.anthropic',
  openai: 'ai.openai',
  gemini: 'ai.gemini',
  openai_compatible: 'ai.openai_compatible'
}

interface ProviderResponse {
  text: string
  inputTokens: number | null
  outputTokens: number | null
}

/**
 * Optional AI overlay. Every method fails closed: when no provider is usable,
 * callers get `ok: false` and the deterministic pipeline continues. No business
 * rule, verdict, or send decision depends on this service succeeding.
 */
export class AiService {
  constructor(
    private readonly db: Db,
    private readonly secrets: SecretStore
  ) {}

  mode(): 'enhanced' | 'off' | 'simulated_outage' {
    return getSection(this.db, 'ai').mode
  }

  isEnabled(): boolean {
    const settings = getSection(this.db, 'ai')
    if (settings.mode !== 'enhanced') return false
    return settings.chain.some((provider) => this.isConfigured(provider))
  }

  isConfigured(provider: AiProviderId): boolean {
    const settings = getSection(this.db, 'ai')
    if (provider === 'ollama') return settings.ollamaBaseUrl.trim().length > 0
    if (provider === 'openai_compatible') {
      return settings.compatibleBaseUrl.trim().length > 0 && Boolean(this.secrets.get(KEY_NAMES.openai_compatible))
    }
    return Boolean(this.secrets.get(KEY_NAMES[provider]))
  }

  health(): AiProviderHealth[] {
    const settings = getSection(this.db, 'ai')
    const states = new Map(listAiProviderStates(this.db).map((state) => [state.provider, state]))
    return settings.chain.map((id) => {
      const state = states.get(id)
      return {
        id,
        label: LABELS[id],
        model: settings.models[id] ?? '',
        configured: this.isConfigured(id),
        circuitState: state?.circuitState ?? 'closed',
        consecutiveFailures: state?.consecutiveFailures ?? 0,
        lastSuccessAt: state?.lastSuccessAt ?? null,
        lastError: state?.lastError ?? null
      }
    })
  }

  async complete(request: AiTextRequest, externalSignal?: AbortSignal): Promise<AiTextResult> {
    const started = Date.now()
    const settings = getSection(this.db, 'ai')

    if (settings.mode === 'off') {
      return this.failure('AI is turned off (deterministic mode).', 'disabled', started)
    }
    if (settings.mode === 'simulated_outage') {
      return this.failure('Simulated AI outage is active.', 'simulated_outage', started)
    }
    if (!this.isEnabled()) {
      return this.failure('No AI provider is configured.', 'no_provider', started)
    }

    const callsToday = countAiCallsSince(this.db, localMidnight())
    if (callsToday >= settings.maxCallsPerDay) {
      return this.failure(`Daily AI call limit reached (${settings.maxCallsPerDay}).`, 'quota', started)
    }

    const errors: string[] = []
    for (const provider of settings.chain) {
      if (!this.isConfigured(provider)) continue
      const state = getAiProviderState(this.db, provider)
      if (!isCircuitAvailable(state, Date.now())) {
        errors.push(`${provider}: circuit open`)
        continue
      }

      const providerStarted = Date.now()
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), settings.timeoutMs)
        const signals = externalSignal ? [externalSignal, controller.signal] : [controller.signal]
        let response: ProviderResponse
        try {
          response = await callProvider(provider, settings, this.secrets, request, AbortSignal.any(signals))
        } finally {
          clearTimeout(timeout)
        }

        const text = response.text.trim()
        if (text.length === 0) throw new Error('Provider returned an empty response')

        logAiCall(this.db, {
          provider,
          model: settings.models[provider] ?? 'unknown',
          purpose: request.purpose,
          status: 'success',
          latencyMs: Date.now() - providerStarted,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          error: null
        })
        recordAiSuccess(this.db, provider)
        return {
          ok: true,
          text,
          provider,
          model: settings.models[provider] ?? null,
          latencyMs: Date.now() - started,
          error: null,
          reason: null
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`${provider}: ${message}`)
        logAiCall(this.db, {
          provider,
          model: settings.models[provider] ?? 'unknown',
          purpose: request.purpose,
          status: 'error',
          latencyMs: Date.now() - providerStarted,
          inputTokens: null,
          outputTokens: null,
          error: message.slice(0, 1000)
        })
        recordAiFailure(this.db, provider, message)
      }
    }

    return this.failure(errors.join('; ') || 'No AI provider answered.', 'error', started)
  }

  private failure(message: string, reason: AiFailureReason, started: number): AiTextResult {
    return {
      ok: false,
      text: null,
      provider: null,
      model: null,
      latencyMs: Date.now() - started,
      error: message,
      reason
    }
  }
}

type AiSettings = AppSettings['ai']

async function callProvider(
  provider: AiProviderId,
  settings: AiSettings,
  secrets: SecretStore,
  request: AiTextRequest,
  signal: AbortSignal
): Promise<ProviderResponse> {
  const model = settings.models[provider] || 'unknown'
  const maxTokens = request.maxTokens ?? settings.maxOutputTokens

  if (provider === 'anthropic') {
    const key = secrets.get(KEY_NAMES.anthropic)
    if (!key) throw new Error('Missing Anthropic API key')
    const response = await fetchJson('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: settings.temperature,
        system: request.system,
        messages: [{ role: 'user', content: request.prompt }]
      }),
      signal
    })
    const content = Array.isArray(response.content) ? response.content : []
    const text = content
      .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim()
    return {
      text,
      inputTokens: numOrNull(isRecord(response.usage) ? response.usage.input_tokens : null),
      outputTokens: numOrNull(isRecord(response.usage) ? response.usage.output_tokens : null)
    }
  }

  if (provider === 'openai') {
    const key = secrets.get(KEY_NAMES.openai)
    if (!key) throw new Error('Missing OpenAI API key')
    return callOpenAiCompatible('https://api.openai.com/v1', key, model, settings, request, signal, true)
  }

  if (provider === 'gemini') {
    const key = secrets.get(KEY_NAMES.gemini)
    if (!key) throw new Error('Missing Gemini API key')
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`
    const response = await fetchJson(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
        generationConfig: { temperature: settings.temperature, maxOutputTokens: maxTokens }
      }),
      signal
    })
    const candidates = Array.isArray(response.candidates) ? response.candidates : []
    const first = isRecord(candidates[0]) ? candidates[0] : null
    const content = first && isRecord(first.content) ? first.content : null
    const parts = content && Array.isArray(content.parts) ? content.parts : []
    const text = parts
      .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim()
    const usage = isRecord(response.usageMetadata) ? response.usageMetadata : null
    return {
      text,
      inputTokens: numOrNull(usage?.promptTokenCount),
      outputTokens: numOrNull(usage?.candidatesTokenCount)
    }
  }

  if (provider === 'openai_compatible') {
    const key = secrets.get(KEY_NAMES.openai_compatible)
    if (!key) throw new Error('Missing OpenAI-compatible API key')
    const base = settings.compatibleBaseUrl.replace(/\/+$/, '')
    return callOpenAiCompatible(base, key, model, settings, request, signal, false)
  }

  const base = settings.ollamaBaseUrl.replace(/\/+$/, '')
  const response = await fetchJson(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.prompt }
      ],
      options: { temperature: settings.temperature, num_predict: maxTokens }
    }),
    signal
  })
  const message = isRecord(response.message) ? response.message : null
  return {
    text: message && typeof message.content === 'string' ? message.content : '',
    inputTokens: numOrNull(response.prompt_eval_count),
    outputTokens: numOrNull(response.eval_count)
  }
}

async function callOpenAiCompatible(
  baseUrl: string,
  key: string,
  model: string,
  settings: AiSettings,
  request: AiTextRequest,
  signal: AbortSignal,
  officialOpenAi: boolean
): Promise<ProviderResponse> {
  const isReasoningModel = officialOpenAi && /^(gpt-5|o[1-9])/i.test(model)
  const maxTokens = request.maxTokens ?? settings.maxOutputTokens
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.prompt }
    ]
  }
  if (!isReasoningModel) {
    body.temperature = settings.temperature
    body.max_tokens = maxTokens
  } else {
    body.max_completion_tokens = maxTokens
  }

  const response = await fetchJson(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal
  })
  const choices = Array.isArray(response.choices) ? response.choices : []
  const first = isRecord(choices[0]) ? choices[0] : null
  const message = first && isRecord(first.message) ? first.message : null
  const usage = isRecord(response.usage) ? response.usage : null
  return {
    text: message && typeof message.content === 'string' ? message.content : '',
    inputTokens: numOrNull(usage?.prompt_tokens),
    outputTokens: numOrNull(usage?.completion_tokens)
  }
}

async function fetchJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, init)
  const text = await response.text()
  if (!response.ok) {
    const snippet = text.replace(/\s+/g, ' ').slice(0, 300)
    throw new Error(`HTTP ${response.status}${snippet ? `: ${snippet}` : ''}`)
  }
  try {
    const parsed = JSON.parse(text) as unknown
    if (!isRecord(parsed)) throw new Error('Response was not a JSON object')
    return parsed
  } catch (error) {
    if (error instanceof Error && error.message.includes('JSON object')) throw error
    throw new Error('Response was not valid JSON')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function localMidnight(): number {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}
