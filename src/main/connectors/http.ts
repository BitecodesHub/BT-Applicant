import { isIP } from 'node:net'

export interface FetchResult<T> {
  ok: boolean
  status: number
  data: T | null
  text: string
  latencyMs: number
  headers: Headers
  error?: string
}

export interface RequestOptions {
  timeoutMs?: number
  signal?: AbortSignal
  headers?: Record<string, string>
  retries?: number
  userAgent?: string
}

const DEFAULT_USER_AGENT =
  'BTApplicant/0.1 (+personal job search tool; respects robots and API terms; contact: local-user)'
const MAX_REDIRECTS = 3
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024

class RequestRejectedError extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isPrivateIPv4(host: string): boolean {
  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b] = parts as [number, number, number, number]
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 0) return true
  if (a === 192 && b === 168) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  return a >= 224
}

function isPrivateIPv6(host: string): boolean {
  if (host === '::' || host === '::1') return true
  const mapped = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mapped) return isPrivateIPv4(mapped[1]!)
  const first = Number.parseInt(host.split(':')[0] ?? '', 16)
  if (!Number.isFinite(first)) return true
  if ((first & 0xfe00) === 0xfc00) return true
  if ((first & 0xffc0) === 0xfe80) return true
  if ((first & 0xff00) === 0xff00) return true
  return false
}

/**
 * Rejects local, private, and link-local destinations. The JSON-LD connector
 * accepts user-supplied URLs, so this prevents a posting from steering the app
 * at loopback services or cloud metadata endpoints.
 */
export function blockedHostReason(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return 'The URL has no host.'
  if (host === 'localhost' || /\.(localhost|local|internal|home\.arpa)$/.test(host)) {
    return `Local hostname "${host}" is not allowed.`
  }
  const family = isIP(host)
  if (family === 4) return isPrivateIPv4(host) ? `Private IPv4 address "${host}" is not allowed.` : null
  if (family === 6) return isPrivateIPv6(host) ? `Private IPv6 address "${host}" is not allowed.` : null
  if (!host.includes('.')) return `Single-label hostname "${host}" is not allowed.`
  return null
}

export function assertSafeRemoteUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new RequestRejectedError(`Invalid URL: ${raw}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new RequestRejectedError('Only http and https URLs can be fetched.')
  }
  if (url.username || url.password) throw new RequestRejectedError('URLs with embedded credentials are not allowed.')
  const reason = blockedHostReason(url.hostname)
  if (reason) throw new RequestRejectedError(reason)
  return url
}

async function fetchWithRedirects(
  initial: URL,
  headers: Record<string, string>,
  signal: AbortSignal
): Promise<Response> {
  let current = initial
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(current, { method: 'GET', headers, signal, redirect: 'manual' })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      await response.body?.cancel().catch(() => undefined)
      if (!location) throw new RequestRejectedError(`HTTP ${response.status} without a Location header.`)
      if (hop === MAX_REDIRECTS) throw new RequestRejectedError('Too many redirects.')
      current = assertSafeRemoteUrl(new URL(location, current).toString())
      continue
    }
    return response
  }
  throw new RequestRejectedError('Too many redirects.')
}

async function readLimitedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new RequestRejectedError(`Response is larger than ${MAX_RESPONSE_BYTES / 1024 / 1024} MB.`)
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new RequestRejectedError(`Response exceeded the ${MAX_RESPONSE_BYTES / 1024 / 1024} MB limit.`)
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}

function failure(started: number, error: string, status = 0, text = ''): FetchResult<string> {
  return { ok: false, status, data: null, text, latencyMs: Date.now() - started, headers: new Headers(), error }
}

export async function requestText(url: string, options: RequestOptions = {}): Promise<FetchResult<string>> {
  const timeoutMs = options.timeoutMs ?? 20_000
  const retries = options.retries ?? 2
  const started = Date.now()
  const headers = {
    'user-agent': options.userAgent ?? DEFAULT_USER_AGENT,
    accept: 'application/json, text/html;q=0.9, */*;q=0.8',
    ...options.headers
  }
  let lastError = ''

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const signals = options.signal ? [options.signal, controller.signal] : [controller.signal]
    try {
      const target = assertSafeRemoteUrl(url)
      const response = await fetchWithRedirects(target, headers, AbortSignal.any(signals))
      const text = await readLimitedText(response)
      clearTimeout(timeout)

      if (response.ok) {
        return { ok: true, status: response.status, data: text, text, latencyMs: Date.now() - started, headers: response.headers }
      }

      lastError = `HTTP ${response.status}`
      const retryable = response.status === 429 || response.status >= 500
      if (!retryable || attempt === retries) {
        return {
          ok: false,
          status: response.status,
          data: null,
          text: text.slice(0, 1000),
          latencyMs: Date.now() - started,
          headers: response.headers,
          error: lastError
        }
      }
      const retryAfter = Number(response.headers.get('retry-after') ?? 0)
      await sleep(retryAfter > 0 ? Math.min(retryAfter * 1000, 10_000) : 500 * 2 ** attempt)
    } catch (error) {
      clearTimeout(timeout)
      lastError = error instanceof Error ? error.message : String(error)
      if (error instanceof RequestRejectedError || attempt === retries) {
        return failure(started, lastError)
      }
      await sleep(500 * 2 ** attempt)
    }
  }

  return failure(started, lastError)
}

export async function requestJson<T>(url: string, options: RequestOptions = {}): Promise<FetchResult<T>> {
  const result = await requestText(url, options)
  if (!result.ok || result.data === null) return { ...result, data: null }
  try {
    return { ...result, data: JSON.parse(result.data) as T }
  } catch {
    return { ...result, ok: false, data: null, error: 'Response was not valid JSON' }
  }
}

/**
 * Token bucket, one per source. Serialises requests for a single source so a
 * burst cannot exceed the configured rate.
 */
export class RateLimiter {
  private tokens: number
  private lastRefill: number
  private readonly capacity: number
  private readonly refillPerMs: number

  constructor(perMinute: number) {
    this.capacity = Math.max(1, perMinute)
    this.tokens = this.capacity
    this.lastRefill = Date.now()
    this.refillPerMs = this.capacity / 60_000
  }

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now()
      this.tokens = Math.min(this.capacity, this.tokens + (now - this.lastRefill) * this.refillPerMs)
      this.lastRefill = now
      if (this.tokens >= 1) {
        this.tokens -= 1
        return
      }
      await sleep(Math.ceil((1 - this.tokens) / this.refillPerMs))
    }
  }
}
