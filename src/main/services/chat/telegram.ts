const API_ROOT = 'https://api.telegram.org'
const MAX_TEXT = 3900

export interface TelegramBotIdentity {
  id: number
  username: string | null
  firstName: string | null
}

export interface TelegramChatIdentity {
  id: string
  label: string
  type: string | null
}

export interface TelegramInbound {
  updateId: number
  messageId: number
  chatId: string
  chatLabel: string
  text: string
  date: number
}

interface TelegramResponse<T> {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
  parameters?: { retry_after?: number }
}

interface TelegramUpdate {
  update_id: number
  message?: {
    message_id: number
    date: number
    text?: string
    chat: {
      id: number | string
      type?: string
      title?: string
      username?: string
      first_name?: string
      last_name?: string
    }
  }
}

interface TelegramChat {
  id: number | string
  type?: string
  title?: string
  username?: string
  first_name?: string
  last_name?: string
}

/**
 * Minimal Telegram Bot API client. The token is only ever placed in the
 * request URL (as the official API requires) and is redacted from every error
 * surfaced to the interface or the audit log.
 */
export class TelegramClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly apiRoot = API_ROOT
  ) {
    if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token)) {
      throw new Error('The Telegram bot token format is invalid. Copy the token shown by @BotFather.')
    }
  }

  async getMe(signal?: AbortSignal): Promise<TelegramBotIdentity> {
    const result = await this.call<{ id: number; username?: string; first_name?: string }>('getMe', {}, signal)
    return { id: result.id, username: result.username ?? null, firstName: result.first_name ?? null }
  }

  async getChat(chatId: string, signal?: AbortSignal): Promise<TelegramChatIdentity> {
    const result = await this.call<TelegramChat>('getChat', { chat_id: chatId }, signal)
    return { id: String(result.id), label: chatLabel(result), type: result.type ?? null }
  }

  async getUpdates(offset: number | null, timeoutSeconds: number, signal?: AbortSignal): Promise<TelegramInbound[]> {
    const body: Record<string, unknown> = { allowed_updates: ['message'], limit: 100 }
    if (offset !== null) body.offset = offset
    if (timeoutSeconds > 0) body.timeout = timeoutSeconds
    const updates = await this.call<TelegramUpdate[]>('getUpdates', body, signal)
    if (!Array.isArray(updates)) return []
    return updates
      .filter((update) => update && typeof update.update_id === 'number' && update.message?.text)
      .map((update) => {
        const message = update.message!
        return {
          updateId: update.update_id,
          messageId: message.message_id,
          chatId: String(message.chat.id),
          chatLabel: chatLabel(message.chat),
          text: message.text!.slice(0, 4096),
          date: message.date
        }
      })
  }

  async sendMessage(chatId: string, text: string, signal?: AbortSignal): Promise<{ messageId: number }> {
    const chunks = splitText(text)
    let lastId = 0
    for (const chunk of chunks) {
      const result = await this.call<{ message_id: number }>(
        'sendMessage',
        { chat_id: chatId, text: chunk, disable_web_page_preview: true },
        signal
      )
      lastId = result.message_id
    }
    return { messageId: lastId }
  }

  private async call<T>(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.apiRoot}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal
      })
    } catch (error) {
      if (signal?.aborted) throw new Error('Telegram request cancelled')
      throw new Error(`Telegram could not be reached. ${this.redact(errorMessage(error))}`)
    }

    const raw = await response.text()
    let parsed: TelegramResponse<T>
    try {
      parsed = JSON.parse(raw) as TelegramResponse<T>
    } catch {
      throw new Error(`Telegram returned an unreadable response (HTTP ${response.status}).`)
    }
    if (!response.ok || !parsed.ok) {
      const retry = parsed.parameters?.retry_after
      const base = this.redact(parsed.description ?? `Telegram rejected the request (HTTP ${response.status}).`)
      throw new Error(retry ? `${base} Retry after ${retry} seconds.` : base)
    }
    return parsed.result as T
  }

  private redact(message: string): string {
    return message.split(this.token).join('[bot token]').slice(0, 500)
  }
}

function chatLabel(chat: { title?: string; username?: string; first_name?: string; last_name?: string; id: number | string }): string {
  if (chat.title) return chat.title
  const name = [chat.first_name, chat.last_name].filter(Boolean).join(' ').trim()
  if (name) return name
  if (chat.username) return `@${chat.username}`
  return String(chat.id)
}

function splitText(text: string): string[] {
  const normalized = text.trim()
  if (normalized.length === 0) return ['(empty message)']
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
