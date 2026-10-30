import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

const GRAPH_ROOT = 'https://graph.facebook.com'
const MAX_BODY_BYTES = 1024 * 1024
const MAX_TEXT = 3900

export interface WhatsAppAccount {
  displayPhoneNumber: string | null
  verifiedName: string | null
}

export interface WhatsAppInbound {
  messageId: string
  from: string
  text: string
  timestamp: number
  phoneNumberId: string | null
}

interface GraphError {
  error?: { message?: string; code?: number; type?: string }
}

export function normalizeWhatsAppPhone(input: string): string | null {
  const digits = input.replace(/[^\d]/g, '')
  if (digits.length < 7 || digits.length > 15) return null
  return digits
}

export class WhatsAppClient {
  constructor(
    private readonly accessToken: string,
    private readonly phoneNumberId: string,
    private readonly graphVersion: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly apiRoot = GRAPH_ROOT
  ) {
    if (!accessToken.trim()) throw new Error('A WhatsApp Cloud API access token is required.')
    if (!/^\d{5,30}$/.test(phoneNumberId)) throw new Error('The WhatsApp phone number ID must be the numeric ID from Meta, not the phone number itself.')
    if (!/^v\d{1,2}\.\d{1,2}$/.test(graphVersion)) throw new Error('The WhatsApp Graph API version format is invalid (expected something like v23.0).')
  }

  async getAccount(signal?: AbortSignal): Promise<WhatsAppAccount> {
    const url = `${this.apiRoot}/${this.graphVersion}/${this.phoneNumberId}?fields=display_phone_number,verified_name`
    const response = await this.request(url, { method: 'GET' }, signal)
    return {
      displayPhoneNumber: typeof response.display_phone_number === 'string' ? response.display_phone_number : null,
      verifiedName: typeof response.verified_name === 'string' ? response.verified_name : null
    }
  }

  async sendText(toPhone: string, text: string, signal?: AbortSignal): Promise<{ messageId: string | null }> {
    const to = normalizeWhatsAppPhone(toPhone)
    if (!to) throw new Error('The recipient phone number must contain 7 to 15 digits in international format.')
    const url = `${this.apiRoot}/${this.graphVersion}/${this.phoneNumberId}/messages`
    let lastId: string | null = null
    for (const chunk of splitText(text)) {
      const response = await this.request(
        url,
        {
          method: 'POST',
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'text',
            text: { preview_url: false, body: chunk }
          })
        },
        signal
      )
      const id = Array.isArray(response.messages) ? response.messages[0]?.id : null
      if (typeof id === 'string') lastId = id
    }
    return { messageId: lastId }
  }

  private async request(url: string, init: { method: string; body?: string }, signal?: AbortSignal): Promise<Record<string, unknown>> {
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        ...init,
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          ...(init.body ? { 'content-type': 'application/json' } : {})
        },
        signal
      })
    } catch (error) {
      if (signal?.aborted) throw new Error('WhatsApp request cancelled')
      throw new Error(`WhatsApp could not be reached. ${this.redact(errorMessage(error))}`)
    }

    const raw = await response.text()
    let parsed: Record<string, unknown> = {}
    try {
      parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    } catch {
      parsed = {}
    }
    if (!response.ok) {
      const graphError = parsed as GraphError
      const detail = graphError.error?.message ?? `WhatsApp rejected the request (HTTP ${response.status}).`
      throw new Error(this.redact(detail))
    }
    return parsed
  }

  private redact(message: string): string {
    return message.split(this.accessToken).join('[access token]').slice(0, 500)
  }
}

export interface WhatsAppWebhookOptions {
  port: number
  path: string
  verifyToken: string
  appSecret: string
  onVerified?: () => void
  onMessage: (message: WhatsAppInbound) => void | Promise<void>
  onError?: (error: Error) => void
}

/**
 * Local webhook receiver for WhatsApp Cloud API callbacks. It binds to
 * loopback only; expose it through a trusted TLS tunnel if Meta must reach it.
 * Every POST is rejected unless its X-Hub-Signature-256 matches the app secret.
 */
export class WhatsAppWebhookServer {
  private server: Server | null = null
  private port = 0

  constructor(private readonly options: WhatsAppWebhookOptions) {}

  get url(): string | null {
    if (!this.server || this.port === 0) return null
    return `http://127.0.0.1:${this.port}${normalizePath(this.options.path)}`
  }

  get listening(): boolean {
    return this.server !== null
  }

  async start(): Promise<string> {
    if (this.server) return this.url!
    const server = createServer((request, response) => {
      void this.handle(request, response).catch((error) => {
        this.options.onError?.(error instanceof Error ? error : new Error(String(error)))
        if (!response.headersSent) writeJson(response, 500, { error: 'webhook failure' })
        else response.end()
      })
    })
    server.requestTimeout = 10_000
    server.headersTimeout = 10_000
    server.keepAliveTimeout = 5_000
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error)
      server.once('error', onError)
      server.listen(this.options.port, '127.0.0.1', () => {
        server.off('error', onError)
        resolve()
      })
    })
    server.on('error', (error) => this.options.onError?.(error))
    this.server = server
    const address = server.address()
    this.port = typeof address === 'object' && address ? address.port : this.options.port
    return this.url!
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.port = 0
    if (!server) return
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (normalizePath(url.pathname) !== normalizePath(this.options.path)) {
      writeJson(response, 404, { error: 'not found' })
      return
    }

    if (request.method === 'GET') {
      const mode = url.searchParams.get('hub.mode')
      const token = url.searchParams.get('hub.verify_token') ?? ''
      const challenge = url.searchParams.get('hub.challenge') ?? ''
      if (mode !== 'subscribe' || !this.options.verifyToken || !safeEqual(token, this.options.verifyToken)) {
        writeJson(response, 403, { error: 'verification failed' })
        return
      }
      if (!/^\d{1,30}$/.test(challenge)) {
        writeJson(response, 400, { error: 'invalid challenge' })
        return
      }
      this.options.onVerified?.()
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      response.end(challenge)
      return
    }

    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'GET, POST' })
      response.end()
      return
    }

    if (!this.options.appSecret) {
      writeJson(response, 503, { error: 'app secret not configured' })
      return
    }

    const declaredLength = Number(request.headers['content-length'] ?? 0)
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      writeJson(response, 413, { error: 'payload too large' })
      request.destroy()
      return
    }

    let raw: Buffer
    try {
      raw = await readBody(request)
    } catch (error) {
      writeJson(response, error instanceof Error && error.message === 'payload too large' ? 413 : 400, { error: 'unreadable body' })
      return
    }

    const signature = headerValue(request.headers['x-hub-signature-256'])
    if (!signature || !verifySignature(raw, signature, this.options.appSecret)) {
      writeJson(response, 401, { error: 'invalid signature' })
      return
    }

    let payload: unknown
    try {
      payload = JSON.parse(raw.toString('utf8'))
    } catch {
      writeJson(response, 400, { error: 'invalid json' })
      return
    }

    const messages = extractMessages(payload)
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    response.end('ok')
    if (messages.length === 0) return
    for (const message of messages) {
      try {
        await this.options.onMessage(message)
      } catch (error) {
        this.options.onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }
}

export function verifySignature(raw: Buffer, signature: string, appSecret: string): boolean {
  if (!appSecret || !signature.startsWith('sha256=')) return false
  const expected = `sha256=${createHmac('sha256', appSecret).update(raw).digest('hex')}`
  return safeEqual(signature, expected)
}

function extractMessages(payload: unknown): WhatsAppInbound[] {
  if (!isRecord(payload) || payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) return []
  const results: WhatsAppInbound[] = []
  for (const entry of payload.entry.slice(0, 10)) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue
    for (const change of entry.changes.slice(0, 10)) {
      if (!isRecord(change) || change.field !== 'messages' || !isRecord(change.value)) continue
      const value = change.value
      const metadata = isRecord(value.metadata) ? value.metadata : {}
      const phoneNumberId = typeof metadata.phone_number_id === 'string' ? metadata.phone_number_id : null
      if (!Array.isArray(value.messages)) continue
      for (const message of value.messages.slice(0, 50)) {
        if (!isRecord(message) || message.type !== 'text' || !isRecord(message.text)) continue
        const id = typeof message.id === 'string' ? message.id : ''
        const from = typeof message.from === 'string' ? message.from.replace(/[^\d]/g, '') : ''
        const text = typeof message.text.body === 'string' ? message.text.body : ''
        const timestamp = Number(message.timestamp ?? 0)
        if (!id || id.length > 200 || from.length < 7 || from.length > 15 || !text.trim()) continue
        results.push({ messageId: id, from, text: text.slice(0, 4096), timestamp: Number.isFinite(timestamp) ? timestamp : 0, phoneNumberId })
      }
    }
  }
  return results
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('payload too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function normalizePath(path: string): string {
  const trimmed = path.trim() || '/whatsapp/webhook'
  return trimmed.startsWith('/') ? trimmed.replace(/\/+$/, '') || '/' : `/${trimmed}`
}

function headerValue(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return null
}

function writeJson(response: ServerResponse, status: number, body: Record<string, unknown>): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

function splitText(text: string): string[] {
  const normalized = text.trim()
  if (normalized.length === 0) return ['']
  const chunks: string[] = []
  let remaining = normalized
  while (remaining.length > MAX_TEXT) {
    let cut = remaining.lastIndexOf('\n', MAX_TEXT)
    if (cut < MAX_TEXT * 0.6) cut = MAX_TEXT
    chunks.push(remaining.slice(0, cut))
    remaining = remaining.slice(cut).trimStart()
  }
  if (remaining.length > 0) chunks.push(remaining)
  return chunks
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
