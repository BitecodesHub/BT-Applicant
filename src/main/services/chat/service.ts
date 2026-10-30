import { createHash } from 'node:crypto'
import type { ApplicationService } from '../applications'
import type { Db } from '../../db/database'
import type { SecretStore } from '../../core/secrets'
import { getSection } from '../../core/settings'
import {
  ensureChatState,
  getChatState,
  listChatMessages,
  patchChatState,
  pruneChatActions,
  recordChatMessage,
  type ChatChannel,
  type ChatMessageStatus,
  type ChatProvider
} from '../../db/repos/chat'
import { listEventsAfter, logEvent } from '../../db/repos/events'
import type { EventRecord } from '../../db/repos/events'
import type { ChatSettings } from '../../../shared/settings'
import type {
  ChatCommandResultDTO,
  ChatPageDTO,
  ChatProviderStatusDTO,
  ChatSecretsStatusDTO,
  ChatTestResultDTO
} from '../../../shared/api'
import { CHAT_COMMANDS, ChatCommandRouter } from './commands'
import { TelegramClient } from './telegram'
import { WhatsAppClient, WhatsAppWebhookServer, normalizeWhatsAppPhone, type WhatsAppInbound } from './whatsapp'

export const CHAT_SECRET_KEYS = {
  telegramToken: 'chat.telegram.botToken',
  whatsappAccessToken: 'chat.whatsapp.accessToken',
  whatsappVerifyToken: 'chat.whatsapp.verifyToken',
  whatsappAppSecret: 'chat.whatsapp.appSecret'
} as const

const SECRET_KEYS = Object.values(CHAT_SECRET_KEYS)
const NOTIFY_INTERVAL_MS = 15_000
const MAX_COMMAND_AGE_MS = 60 * 60_000
const COMMANDS_PER_MINUTE = 20
const NOTIFICATIONS_PER_MINUTE = 10

export interface ChatServiceOptions {
  db: Db
  secrets: SecretStore
  applications: ApplicationService
  onProfileChanged: () => { evaluated: number; errors: number }
  onChange?: () => void
  fetchImpl?: typeof fetch
  now?: () => number
  notifyIntervalMs?: number
}

interface ReplyOutcome {
  ok: boolean
  error: string | null
  messageId: number | null
}

/**
 * Owns both chat channels and the deterministic command router. All outbound
 * requests are explicit, rate limited, and written to the local audit log
 * without message bodies, tokens, or confirmation codes.
 */
export class ChatService {
  private readonly router: ChatCommandRouter
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly notifyIntervalMs: number

  private readonly lifecycle = new AbortController()
  private started = false
  private telegramClient: TelegramClient | null = null
  private telegramToken: string | null = null
  private telegramAbort: AbortController | null = null
  private telegramLoop: Promise<void> | null = null
  private telegramRunning = false

  private whatsappClient: WhatsAppClient | null = null
  private whatsappToken: string | null = null
  private webhook: WhatsAppWebhookServer | null = null
  private webhookKey: string | null = null

  private notifyTimer: NodeJS.Timeout | null = null
  private scanPromise: Promise<void> | null = null
  private reconfigureQueue: Promise<void> = Promise.resolve()
  private readonly pendingWork = new Set<Promise<unknown>>()
  private readonly commandMarks = new Map<ChatChannel, number[]>()
  private readonly notificationMarks = new Map<ChatProvider, number[]>()
  private readonly rateWarnings = new Map<ChatChannel, number>()

  constructor(private readonly options: ChatServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? (() => Date.now())
    this.notifyIntervalMs = options.notifyIntervalMs ?? NOTIFY_INTERVAL_MS
    this.router = new ChatCommandRouter(options.db, options.applications, options.onProfileChanged, { now: this.now })
  }

  start(): void {
    if (this.started) return
    this.started = true
    ensureChatState(this.options.db, 'telegram', this.now())
    ensureChatState(this.options.db, 'whatsapp', this.now())
    pruneChatActions(this.options.db, this.now())
    this.notifyTimer = setInterval(() => {
      void this.scanNotifications()
    }, this.notifyIntervalMs)
    this.notifyTimer.unref()
    void this.reconfigure()
  }

  async stop(): Promise<void> {
    this.started = false
    if (this.notifyTimer) {
      clearInterval(this.notifyTimer)
      this.notifyTimer = null
    }
    this.lifecycle.abort()
    this.telegramAbort?.abort()
    await this.reconfigureQueue.catch(() => undefined)
    await this.stopTelegram()
    await this.stopWebhook()
    if (this.scanPromise) await this.scanPromise.catch(() => undefined)
    await Promise.allSettled([...this.pendingWork])
    this.pendingWork.clear()
    this.telegramClient = null
    this.telegramToken = null
    this.whatsappClient = null
    this.whatsappToken = null
  }

  reconfigure(): Promise<void> {
    const next = this.reconfigureQueue
      .catch(() => undefined)
      .then(() => this.applyConfiguration())
      .catch((error) => {
        logEvent(this.options.db, {
          category: 'chat.configure_failed',
          level: 'warn',
          message: `Chat configuration failed: ${sanitizeError(error, SECRET_KEYS.map((key) => this.options.secrets.get(key)))}`,
          detail: {}
        })
      })
    this.reconfigureQueue = next.catch(() => undefined)
    return this.reconfigureQueue
  }

  getPage(): ChatPageDTO {
    const settings = getSection(this.options.db, 'chat')
    const telegramState = ensureChatState(this.options.db, 'telegram', this.now())
    const whatsappState = ensureChatState(this.options.db, 'whatsapp', this.now())
    return {
      settings,
      secrets: this.secretStatus(),
      providers: [this.telegramStatus(settings, telegramState), this.whatsappStatus(settings, whatsappState)],
      messages: listChatMessages(this.options.db, 40).map((message) => ({
        id: message.id,
        provider: message.provider,
        direction: message.direction,
        chatRef: message.chatRef,
        summary: message.summary,
        command: message.command,
        status: message.status,
        error: message.error,
        createdAt: message.createdAt
      })),
      webhookUrl: this.webhookUrl(settings),
      commands: CHAT_COMMANDS
    }
  }

  async test(provider: ChatProvider): Promise<ChatTestResultDTO> {
    const started = this.now()
    if (provider === 'telegram') {
      const token = this.options.secrets.get(CHAT_SECRET_KEYS.telegramToken)
      if (!token) return this.testFailure('Store a Telegram bot token first.', started)
      try {
        const client = new TelegramClient(token, this.fetchImpl)
        const identity = await client.getMe(this.networkSignal(12_000))
        const account = identity.username ? `@${identity.username}` : identity.firstName ?? `bot ${identity.id}`
        const settings = getSection(this.options.db, 'chat')
        if (settings.telegram.chatId.trim()) {
          const chat = await client.getChat(settings.telegram.chatId.trim(), this.networkSignal(12_000))
          this.markSuccess('telegram')
          logEvent(this.options.db, {
            category: 'chat.test_ok',
            message: `Telegram connection verified for ${account}`,
            actor: 'user',
            detail: { provider: 'telegram', chatType: chat.type }
          })
          return { ok: true, message: `Bot ${account} is reachable and the allowlisted chat “${chat.label}” is visible.`, latencyMs: this.now() - started, account }
        }
        this.markSuccess('telegram')
        return {
          ok: true,
          message: `Bot ${account} is valid. Send /start to it in Telegram, then add the chat ID it replies with.`,
          latencyMs: this.now() - started,
          account
        }
      } catch (error) {
        return this.testFailure(sanitizeError(error, [token]), started, 'telegram')
      }
    }

    const accessToken = this.options.secrets.get(CHAT_SECRET_KEYS.whatsappAccessToken)
    const settings = getSection(this.options.db, 'chat')
    if (!accessToken) return this.testFailure('Store a WhatsApp Cloud API access token first.', started)
    try {
      const client = new WhatsAppClient(accessToken, settings.whatsapp.phoneNumberId, settings.whatsapp.graphVersion, this.fetchImpl)
      const account = await client.getAccount(this.networkSignal(12_000))
      this.markSuccess('whatsapp')
      logEvent(this.options.db, {
        category: 'chat.test_ok',
        message: 'WhatsApp Cloud API account verified',
        actor: 'user',
        detail: { provider: 'whatsapp' }
      })
      const label = [account.verifiedName, account.displayPhoneNumber].filter(Boolean).join(' · ') || 'the configured phone number'
      return {
        ok: true,
        message: `WhatsApp account ${label} is reachable. Send a test message to confirm delivery to your phone.`,
        latencyMs: this.now() - started,
        account: label
      }
    } catch (error) {
      return this.testFailure(sanitizeError(error, [accessToken]), started, 'whatsapp')
    }
  }

  async sendTest(provider: ChatProvider): Promise<ChatTestResultDTO> {
    const started = this.now()
    const settings = getSection(this.options.db, 'chat')
    const text = 'BT Applicant test: this chat is connected. Reply /help to see the commands. Approvals still require a one-time /confirm code.'
    if (provider === 'telegram') {
      const token = this.options.secrets.get(CHAT_SECRET_KEYS.telegramToken)
      const chatId = settings.telegram.chatId.trim()
      if (!token) return this.testFailure('Store a Telegram bot token first.', started)
      if (!chatId) return this.testFailure('Add the allowlisted Telegram chat ID first. Send /start to the bot to discover it.', started)
      const client = new TelegramClient(token, this.fetchImpl)
      this.telegramClient = this.telegramClient ?? client
      const outcome = await this.sendTelegram(chatId, text)
      if (!outcome.ok) return this.testFailure(outcome.error ?? 'Telegram rejected the test message.', started, 'telegram')
      logEvent(this.options.db, {
        category: 'chat.test_message_sent',
        message: 'Telegram test message sent',
        actor: 'user',
        detail: { provider: 'telegram' }
      })
      return { ok: true, message: 'Test message sent to your Telegram chat.', latencyMs: this.now() - started, account: null }
    }

    const accessToken = this.options.secrets.get(CHAT_SECRET_KEYS.whatsappAccessToken)
    if (!accessToken) return this.testFailure('Store a WhatsApp Cloud API access token first.', started)
    try {
      const client = new WhatsAppClient(accessToken, settings.whatsapp.phoneNumberId, settings.whatsapp.graphVersion, this.fetchImpl)
      const outcome = await this.sendWhatsApp(client, settings.whatsapp.toPhone, text)
      if (!outcome.ok) return this.testFailure(outcome.error ?? 'WhatsApp rejected the test message.', started, 'whatsapp')
      logEvent(this.options.db, {
        category: 'chat.test_message_sent',
        message: 'WhatsApp test message sent',
        actor: 'user',
        detail: { provider: 'whatsapp' }
      })
      return { ok: true, message: 'Test message sent to your WhatsApp number.', latencyMs: this.now() - started, account: null }
    } catch (error) {
      return this.testFailure(sanitizeError(error, [accessToken]), started, 'whatsapp')
    }
  }

  runLocalCommand(text: string): ChatCommandResultDTO {
    const settings = getSection(this.options.db, 'chat')
    const trimmed = text.replace(/\s+/g, ' ').trim()
    if (!trimmed) return { ok: false, command: '', reply: 'Type a command such as /status or /help.', requiresConfirmation: false, messageId: null }
    if (!settings.commandsEnabled) {
      return { ok: false, command: commandOf(trimmed), reply: 'Chat commands are disabled in Chat settings.', requiresConfirmation: false, messageId: null }
    }
    if (!this.allowCommand('local')) {
      return { ok: false, command: commandOf(trimmed), reply: 'Too many commands in one minute. Wait a moment and try again.', requiresConfirmation: false, messageId: null }
    }
    const inbound = recordChatMessage(this.options.db, {
      provider: 'local',
      direction: 'inbound',
      chatRef: 'local',
      summary: summarizeInbound(trimmed),
      command: commandOf(trimmed),
      status: 'received'
    }, this.now())
    const result = this.router.execute(trimmed, 'local', 'local')
    const outbound = recordChatMessage(this.options.db, {
      provider: 'local',
      direction: 'outbound',
      chatRef: 'local',
      summary: summarizeOutbound(result.reply),
      command: commandOf(trimmed),
      status: result.ok ? 'sent' : 'failed'
    }, this.now())
    this.options.onChange?.()
    return {
      ok: result.ok,
      command: result.command,
      reply: result.reply,
      requiresConfirmation: result.requiresConfirmation,
      messageId: outbound.inserted ? outbound.id : inbound.id
    }
  }

  async scanNotifications(): Promise<void> {
    if (this.scanPromise) return this.scanPromise
    const run = this.scanOnce().finally(() => {
      this.scanPromise = null
    })
    this.scanPromise = run
    return run
  }

  private async scanOnce(): Promise<void> {
    const settings = getSection(this.options.db, 'chat')
    if (!settings.enabled) return
    const providers = this.readyProviders(settings)
    if (providers.length === 0) return
    const maxEvent = this.options.db.get<{ id: number | null }>('SELECT MAX(id) AS id FROM events')?.id ?? 0
    for (const provider of providers) {
      const state = ensureChatState(this.options.db, provider, this.now())
      if (state.lastEventId >= maxEvent) continue
      const events = listEventsAfter(this.options.db, state.lastEventId, 100)
      if (events.length === 0) continue
      const pending: { id: number; text: string }[] = []
      for (const event of events) {
        const text = notificationText(event, settings)
        if (text) pending.push({ id: event.id, text })
      }
      let cursor = state.lastEventId
      let sent = 0
      for (const event of events) {
        const item = pending.find((entry) => entry.id === event.id)
        if (!item) {
          cursor = event.id
          continue
        }
        if (sent >= 8 || !this.allowNotification(provider)) break
        const outcome =
          provider === 'telegram'
            ? await this.sendTelegram(settings.telegram.chatId.trim(), item.text)
            : await this.sendWhatsAppCurrent(item.text)
        if (!outcome.ok) break
        sent += 1
        cursor = event.id
      }
      if (cursor > state.lastEventId) patchChatState(this.options.db, provider, { lastEventId: cursor }, this.now())
    }
  }

  private async applyConfiguration(): Promise<void> {
    if (!this.started) return
    const settings = getSection(this.options.db, 'chat')
    const telegramToken = this.options.secrets.get(CHAT_SECRET_KEYS.telegramToken)
    const whatsappToken = this.options.secrets.get(CHAT_SECRET_KEYS.whatsappAccessToken)
    const verifyToken = this.options.secrets.get(CHAT_SECRET_KEYS.whatsappVerifyToken)
    const appSecret = this.options.secrets.get(CHAT_SECRET_KEYS.whatsappAppSecret)

    const telegramShouldRun = Boolean(settings.enabled && settings.telegram.enabled && telegramToken)
    const whatsappShouldRun = Boolean(
      settings.enabled &&
        settings.whatsapp.enabled &&
        whatsappToken &&
        settings.whatsapp.phoneNumberId.trim() &&
        verifyToken &&
        appSecret
    )
    const webhookKey = [
      settings.whatsapp.webhookPort,
      normalizePath(settings.whatsapp.webhookPath),
      settings.whatsapp.phoneNumberId.trim(),
      settings.whatsapp.graphVersion,
      whatsappToken ?? '',
      verifyToken ?? '',
      appSecret ?? ''
    ].join('|')
    const telegramWasRunning = this.telegramRunning
    const whatsappWasRunning = Boolean(this.webhook?.listening)

    if (!telegramShouldRun || telegramToken !== this.telegramToken) {
      await this.stopTelegram()
    }
    if (!whatsappShouldRun || webhookKey !== this.webhookKey) {
      await this.stopWebhook()
    }

    if (telegramShouldRun && !this.telegramRunning) {
      if (!telegramWasRunning) this.resetEventCursor('telegram')
      await this.startTelegram(settings, telegramToken!)
    }

    if (whatsappShouldRun && !this.webhook) {
      if (!whatsappWasRunning) this.resetEventCursor('whatsapp')
      await this.startWebhook(settings, whatsappToken!, verifyToken!, appSecret!, webhookKey)
    }
  }

  private async startTelegram(settings: ChatSettings, token: string): Promise<void> {
    let client: TelegramClient
    try {
      client = new TelegramClient(token, this.fetchImpl)
    } catch (error) {
      this.recordProviderError('telegram', sanitizeError(error, [token]), 'chat.configure_failed')
      this.notifyChange()
      return
    }
    this.telegramClient = client
    this.telegramToken = token
    const controller = new AbortController()
    this.telegramAbort = controller
    this.telegramRunning = true
    this.telegramLoop = this.pollTelegram(controller)
      .catch((error) => {
        if (!controller.signal.aborted) this.recordProviderError('telegram', sanitizeError(error, [token]), 'chat.poll_failed')
      })
      .finally(() => {
        if (this.telegramAbort === controller) {
          this.telegramAbort = null
          this.telegramRunning = false
        }
      })
    logEvent(this.options.db, {
      category: 'chat.started',
      message: 'Telegram long polling started',
      detail: { provider: 'telegram', pollSeconds: settings.telegram.pollSeconds }
    })
    this.notifyChange()
  }

  private async pollTelegram(controller: AbortController): Promise<void> {
    let failures = 0
    const initialState = getChatState(this.options.db, 'telegram')
    let initialized = Boolean(initialState && initialState.lastUpdateId !== null)
    while (!controller.signal.aborted && this.started) {
      const settings = getSection(this.options.db, 'chat')
      const client = this.telegramClient
      if (!client || !settings.enabled || !settings.telegram.enabled) return
      try {
        if (!initialized) {
          const last = await client.getUpdates(-1, 0, this.combinedSignal(controller.signal, 12_000))
          const lastId = last.length > 0 ? last[last.length - 1]!.updateId : 0
          patchChatState(this.options.db, 'telegram', { lastUpdateId: lastId, lastSuccessAt: this.now(), lastError: null }, this.now())
          initialized = true
          continue
        }
        const state = getChatState(this.options.db, 'telegram')
        const offset = Math.max((state?.lastUpdateId ?? 0) + 1, 1)
        const timeout = Math.min(Math.max(Math.round(settings.telegram.pollSeconds), 2), 50)
        const updates = await client.getUpdates(offset, timeout, this.combinedSignal(controller.signal, (timeout + 15) * 1000))
        this.markSuccess('telegram')
        failures = 0
        if (updates.length > 0) {
          for (const update of updates) {
            if (controller.signal.aborted || !this.started) break
            await this.handleTelegramUpdate(update, settings)
            patchChatState(this.options.db, 'telegram', { lastUpdateId: update.updateId }, this.now())
          }
          this.notifyChange()
        }
      } catch (error) {
        if (controller.signal.aborted || !this.started) return
        failures += 1
        const message = sanitizeError(error, [this.telegramToken ?? ''])
        this.recordProviderError('telegram', message, 'chat.poll_failed', failures <= 1 || failures % 5 === 0)
        if (/Unauthorized|not found|Conflict|webhook is active/i.test(message)) {
          logEvent(this.options.db, {
            category: 'chat.stopped',
            level: 'warn',
            message: `Telegram polling stopped: ${message}`,
            detail: { provider: 'telegram' }
          })
          return
        }
        await sleep(Math.min(60_000, 2_000 * 2 ** Math.min(failures - 1, 5)), controller.signal)
      }
    }
  }

  private async handleTelegramUpdate(
    update: { updateId: number; messageId: number; chatId: string; chatLabel: string; text: string; date: number },
    settings: ChatSettings
  ): Promise<void> {
    const allowed = settings.telegram.chatId.trim()
    if (!allowed) {
      if (/^\/?(start|whoami)\b/i.test(update.text.trim())) {
        const reply = [
          'BT Applicant is not linked yet.',
          `Chat ID: ${update.chatId}`,
          '',
          'Add this chat ID in the desktop app under Chat, save, then send /start again.',
          'Until it is allowlisted, no command is executed.'
        ].join('\n')
        await this.sendTelegram(update.chatId, reply, { command: 'start' })
        logEvent(this.options.db, {
          category: 'chat.setup_requested',
          message: 'A Telegram chat requested linking; no command was executed',
          detail: { provider: 'telegram' }
        })
      }
      return
    }
    if (update.chatId !== allowed) {
      logEvent(this.options.db, {
        category: 'chat.rejected',
        level: 'warn',
        message: 'A Telegram message from a non-allowlisted chat was ignored',
        detail: { provider: 'telegram', chatRef: shortRef(update.chatId) }
      })
      return
    }
    if (this.now() - update.date * 1000 > MAX_COMMAND_AGE_MS) {
      this.recordIgnored('telegram', update.chatId, update.text, 'stale message')
      return
    }
    if (!settings.commandsEnabled) {
      this.recordIgnored('telegram', update.chatId, update.text, 'commands disabled')
      return
    }
    if (!this.allowCommand('telegram')) {
      this.recordIgnored('telegram', update.chatId, update.text, 'rate limited')
      await this.warnRateLimit('telegram', update.chatId)
      return
    }

    const inbound = recordChatMessage(this.options.db, {
      provider: 'telegram',
      direction: 'inbound',
      externalId: `${update.chatId}:${update.messageId}`,
      chatRef: shortRef(update.chatId),
      summary: summarizeInbound(update.text),
      command: commandOf(update.text),
      status: 'received'
    }, this.now())
    if (!inbound.inserted) return

    let reply: string
    let status: ChatMessageStatus = 'sent'
    let error: string | null = null
    try {
      const result = this.router.execute(update.text, 'telegram', update.chatId)
      reply = result.reply
      status = result.ok ? 'sent' : 'failed'
    } catch (caught) {
      reply = 'That command could not be completed. The error was recorded in Activity.'
      status = 'failed'
      error = sanitizeError(caught, [this.telegramToken ?? ''])
      logEvent(this.options.db, {
        category: 'chat.command_failed',
        level: 'warn',
        message: `Telegram command failed: ${error}`,
        detail: { provider: 'telegram' }
      })
    }

    const outcome = await this.sendTelegram(update.chatId, reply, { command: commandOf(update.text), status, error })
    if (!outcome.ok) error = outcome.error
    patchChatState(this.options.db, 'telegram', { lastActivityAt: this.now() }, this.now())
    this.options.onChange?.()
  }

  private async startWebhook(
    settings: ChatSettings,
    accessToken: string,
    verifyToken: string,
    appSecret: string,
    webhookKey: string
  ): Promise<void> {
    const phoneNumberId = settings.whatsapp.phoneNumberId.trim()
    let client: WhatsAppClient
    try {
      client = new WhatsAppClient(accessToken, phoneNumberId, settings.whatsapp.graphVersion, this.fetchImpl)
    } catch (error) {
      this.recordProviderError('whatsapp', sanitizeError(error, [accessToken, verifyToken, appSecret]), 'chat.configure_failed')
      this.notifyChange()
      return
    }
    this.whatsappClient = client
    this.whatsappToken = accessToken
    this.webhookKey = webhookKey
    const webhook = new WhatsAppWebhookServer({
      port: settings.whatsapp.webhookPort,
      path: settings.whatsapp.webhookPath,
      verifyToken,
      appSecret,
      onVerified: () => {
        patchChatState(this.options.db, 'whatsapp', { webhookVerifiedAt: this.now(), lastSuccessAt: this.now(), lastError: null }, this.now())
        logEvent(this.options.db, {
          category: 'chat.webhook_verified',
          message: 'WhatsApp webhook verification completed',
          detail: { provider: 'whatsapp' }
        })
        this.notifyChange()
      },
      onMessage: (message) => {
        const task = this.handleWhatsAppMessage(message)
        this.pendingWork.add(task)
        void task
          .catch((error) => {
            this.recordProviderError('whatsapp', sanitizeError(error, [accessToken, verifyToken, appSecret]), 'chat.command_failed')
          })
          .finally(() => this.pendingWork.delete(task))
      },
      onError: (error) => {
        this.recordProviderError('whatsapp', sanitizeError(error, [accessToken, verifyToken, appSecret]), 'chat.webhook_failed')
        this.notifyChange()
      }
    })
    this.webhook = webhook
    try {
      const url = await webhook.start()
      logEvent(this.options.db, {
        category: 'chat.started',
        message: `WhatsApp webhook listening on ${url}`,
        detail: { provider: 'whatsapp', loopback: true }
      })
      this.notifyChange()
    } catch (error) {
      this.webhook = null
      this.whatsappClient = null
      this.whatsappToken = null
      this.webhookKey = null
      const message = sanitizeError(error, [accessToken, verifyToken, appSecret])
      this.recordProviderError(
        'whatsapp',
        `Webhook could not bind to 127.0.0.1:${settings.whatsapp.webhookPort}. ${message}`,
        'chat.webhook_failed'
      )
      logEvent(this.options.db, {
        category: 'chat.webhook_failed',
        level: 'warn',
        message: `WhatsApp webhook failed to start: ${message}`,
        detail: { provider: 'whatsapp' }
      })
      this.notifyChange()
    }
  }

  private async handleWhatsAppMessage(message: WhatsAppInbound): Promise<void> {
    const settings = getSection(this.options.db, 'chat')
    if (!settings.enabled || !settings.whatsapp.enabled) return
    if (settings.whatsapp.phoneNumberId && message.phoneNumberId && message.phoneNumberId !== settings.whatsapp.phoneNumberId) {
      return
    }
    const allowed = normalizeWhatsAppPhone(settings.whatsapp.toPhone)
    if (!allowed) {
      logEvent(this.options.db, {
        category: 'chat.rejected',
        level: 'warn',
        message: 'A WhatsApp message arrived before a recipient phone was configured; it was ignored',
        detail: { provider: 'whatsapp' }
      })
      return
    }
    if (message.from !== allowed) {
      logEvent(this.options.db, {
        category: 'chat.rejected',
        level: 'warn',
        message: 'A WhatsApp message from a non-allowlisted number was ignored',
        detail: { provider: 'whatsapp', chatRef: shortRef(message.from) }
      })
      return
    }
    if (this.now() - message.timestamp * 1000 > MAX_COMMAND_AGE_MS) {
      this.recordIgnored('whatsapp', message.from, message.text, 'stale message', message.messageId)
      return
    }
    if (!settings.commandsEnabled) {
      this.recordIgnored('whatsapp', message.from, message.text, 'commands disabled', message.messageId)
      return
    }
    const client = this.whatsappClient
    if (!client) {
      this.recordProviderError('whatsapp', 'Commands cannot be answered because the Cloud API client is not ready.', 'chat.command_failed')
      return
    }
    if (!this.allowCommand('whatsapp')) {
      this.recordIgnored('whatsapp', message.from, message.text, 'rate limited', message.messageId)
      await this.warnRateLimitWhatsApp(client, allowed)
      return
    }

    const inbound = recordChatMessage(this.options.db, {
      provider: 'whatsapp',
      direction: 'inbound',
      externalId: message.messageId,
      chatRef: shortRef(message.from),
      summary: summarizeInbound(message.text),
      command: commandOf(message.text),
      status: 'received'
    }, this.now())
    if (!inbound.inserted) return

    let reply: string
    let status: ChatMessageStatus = 'sent'
    let error: string | null = null
    try {
      const result = this.router.execute(message.text, 'whatsapp', allowed)
      reply = result.reply
      status = result.ok ? 'sent' : 'failed'
    } catch (caught) {
      reply = 'That command could not be completed. The error was recorded in Activity.'
      status = 'failed'
      error = sanitizeError(caught, [this.whatsappToken ?? ''])
      logEvent(this.options.db, {
        category: 'chat.command_failed',
        level: 'warn',
        message: `WhatsApp command failed: ${error}`,
        detail: { provider: 'whatsapp' }
      })
    }

    const outcome = await this.sendWhatsApp(client, allowed, reply, { command: commandOf(message.text), status, error })
    if (!outcome.ok) error = outcome.error
    patchChatState(this.options.db, 'whatsapp', { lastActivityAt: this.now() }, this.now())
    this.options.onChange?.()
  }

  private async sendTelegram(
    chatId: string,
    text: string,
    meta: { command?: string | null; status?: ChatMessageStatus; error?: string | null; record?: boolean } = {}
  ): Promise<ReplyOutcome> {
    const client = this.telegramClient
    if (!client || !chatId) return { ok: false, error: 'Telegram is not connected.', messageId: null }
    let ok = false
    let error: string | null = null
    try {
      await client.sendMessage(chatId, text, this.networkSignal(20_000))
      this.markSuccess('telegram')
      ok = true
    } catch (caught) {
      error = sanitizeError(caught, [this.telegramToken ?? ''])
      this.recordProviderError('telegram', error, 'chat.send_failed')
    }
    let messageId: number | null = null
    if (meta.record !== false) {
      const record = recordChatMessage(this.options.db, {
        provider: 'telegram',
        direction: 'outbound',
        chatRef: shortRef(chatId),
        summary: summarizeOutbound(text),
        command: meta.command ?? null,
        status: meta.status ?? (ok ? 'sent' : 'failed'),
        error: ok ? meta.error ?? null : error
      }, this.now())
      messageId = record.id
    }
    return { ok, error: ok ? null : error, messageId }
  }

  private async sendWhatsApp(
    client: WhatsAppClient,
    to: string,
    text: string,
    meta: { command?: string | null; status?: ChatMessageStatus; error?: string | null; record?: boolean } = {}
  ): Promise<ReplyOutcome> {
    let ok = false
    let error: string | null = null
    try {
      await client.sendText(to, text, this.networkSignal(20_000))
      this.markSuccess('whatsapp')
      ok = true
    } catch (caught) {
      error = sanitizeError(caught, [this.whatsappToken ?? ''])
      this.recordProviderError('whatsapp', error, 'chat.send_failed')
    }
    let messageId: number | null = null
    if (meta.record !== false) {
      const record = recordChatMessage(this.options.db, {
        provider: 'whatsapp',
        direction: 'outbound',
        chatRef: shortRef(to),
        summary: summarizeOutbound(text),
        command: meta.command ?? null,
        status: meta.status ?? (ok ? 'sent' : 'failed'),
        error: ok ? meta.error ?? null : error
      }, this.now())
      messageId = record.id
    }
    return { ok, error: ok ? null : error, messageId }
  }

  private async sendWhatsAppCurrent(text: string): Promise<ReplyOutcome> {
    const settings = getSection(this.options.db, 'chat')
    if (!this.whatsappClient) return { ok: false, error: 'WhatsApp is not connected.', messageId: null }
    return this.sendWhatsApp(this.whatsappClient, settings.whatsapp.toPhone, text)
  }

  private async warnRateLimit(provider: ChatProvider, chatId: string): Promise<void> {
    const last = this.rateWarnings.get(provider) ?? 0
    if (this.now() - last < 60_000) return
    this.rateWarnings.set(provider, this.now())
    await this.sendTelegram(chatId, 'Too many commands in one minute. Wait a moment, then try again.')
  }

  private async warnRateLimitWhatsApp(client: WhatsAppClient, to: string): Promise<void> {
    const last = this.rateWarnings.get('whatsapp') ?? 0
    if (this.now() - last < 60_000) return
    this.rateWarnings.set('whatsapp', this.now())
    await this.sendWhatsApp(client, to, 'Too many commands in one minute. Wait a moment, then try again.')
  }

  private async stopTelegram(): Promise<void> {
    this.telegramAbort?.abort()
    const loop = this.telegramLoop
    this.telegramAbort = null
    this.telegramLoop = null
    if (loop) await loop.catch(() => undefined)
    this.telegramRunning = false
    this.telegramClient = null
    this.telegramToken = null
  }

  private async stopWebhook(): Promise<void> {
    const webhook = this.webhook
    this.webhook = null
    this.whatsappClient = null
    this.whatsappToken = null
    this.webhookKey = null
    if (webhook) await webhook.stop()
  }

  private readyProviders(settings: ChatSettings): ChatProvider[] {
    const result: ChatProvider[] = []
    if (
      this.telegramClient &&
      settings.telegram.enabled &&
      settings.telegram.chatId.trim() &&
      this.options.secrets.get(CHAT_SECRET_KEYS.telegramToken)
    ) {
      result.push('telegram')
    }
    if (
      this.whatsappClient &&
      settings.whatsapp.enabled &&
      normalizeWhatsAppPhone(settings.whatsapp.toPhone) &&
      this.options.secrets.get(CHAT_SECRET_KEYS.whatsappAccessToken)
    ) {
      result.push('whatsapp')
    }
    return result
  }

  private allowCommand(channel: ChatChannel): boolean {
    const now = this.now()
    const marks = (this.commandMarks.get(channel) ?? []).filter((ts) => now - ts < 60_000)
    if (marks.length >= COMMANDS_PER_MINUTE) {
      this.commandMarks.set(channel, marks)
      return false
    }
    marks.push(now)
    this.commandMarks.set(channel, marks)
    return true
  }

  private allowNotification(provider: ChatProvider): boolean {
    const now = this.now()
    const marks = (this.notificationMarks.get(provider) ?? []).filter((ts) => now - ts < 60_000)
    if (marks.length >= NOTIFICATIONS_PER_MINUTE) {
      this.notificationMarks.set(provider, marks)
      return false
    }
    marks.push(now)
    this.notificationMarks.set(provider, marks)
    return true
  }

  private recordIgnored(
    provider: ChatProvider,
    chatRef: string,
    text: string,
    reason: string,
    externalId?: string
  ): void {
    const command = commandOf(text)
    recordChatMessage(this.options.db, {
      provider,
      direction: 'inbound',
      externalId: externalId ?? null,
      chatRef: shortRef(chatRef),
      summary: `${summarizeInbound(text)} (${reason})`,
      command,
      status: 'ignored'
    }, this.now())
    logEvent(this.options.db, {
      category: 'chat.ignored',
      message: `Chat command ignored: ${reason}`,
      detail: { provider, command }
    })
  }

  private recordProviderError(provider: ChatProvider, message: string, category: string, writeEvent = true): void {
    const safe = message.slice(0, 500)
    const state = getChatState(this.options.db, provider)
    patchChatState(this.options.db, provider, { lastError: safe, lastErrorAt: this.now() }, this.now())
    if (writeEvent && state?.lastError !== safe) {
      logEvent(this.options.db, {
        category,
        level: 'warn',
        message: `${provider === 'telegram' ? 'Telegram' : 'WhatsApp'} error: ${safe}`,
        detail: { provider }
      })
    }
  }

  private markSuccess(provider: ChatProvider): void {
    patchChatState(this.options.db, provider, { lastSuccessAt: this.now(), lastError: null }, this.now())
  }

  private resetEventCursor(provider: ChatProvider): void {
    const maxEvent = this.options.db.get<{ id: number | null }>('SELECT MAX(id) AS id FROM events')?.id ?? 0
    patchChatState(this.options.db, provider, { lastEventId: maxEvent }, this.now())
  }

  private secretStatus(): ChatSecretsStatusDTO {
    return {
      telegramToken: this.options.secrets.has(CHAT_SECRET_KEYS.telegramToken),
      whatsappAccessToken: this.options.secrets.has(CHAT_SECRET_KEYS.whatsappAccessToken),
      whatsappVerifyToken: this.options.secrets.has(CHAT_SECRET_KEYS.whatsappVerifyToken),
      whatsappAppSecret: this.options.secrets.has(CHAT_SECRET_KEYS.whatsappAppSecret)
    }
  }

  private telegramStatus(settings: ChatSettings, state: ReturnType<typeof ensureChatState>): ChatProviderStatusDTO {
    const token = this.options.secrets.has(CHAT_SECRET_KEYS.telegramToken)
    const chatId = settings.telegram.chatId.trim()
    const configured = token && Boolean(chatId)
    const missing: string[] = []
    if (!token) missing.push('bot token')
    if (!chatId) missing.push('chat ID')
    let detail: string
    if (!settings.enabled) detail = 'Chat is off.'
    else if (!settings.telegram.enabled) detail = 'Telegram is off.'
    else if (missing.length > 0) detail = `Missing ${missing.join(' and ')}.`
    else if (this.telegramRunning) detail = 'Long polling is active.'
    else detail = 'Configured but not polling.'
    return {
      provider: 'telegram',
      enabled: settings.enabled && settings.telegram.enabled,
      configured,
      running: this.telegramRunning,
      connected: Boolean(state.lastSuccessAt && (!state.lastErrorAt || state.lastSuccessAt >= state.lastErrorAt)),
      detail,
      lastActivityAt: state.lastActivityAt,
      lastSuccessAt: state.lastSuccessAt,
      lastError: state.lastError,
      lastErrorAt: state.lastErrorAt,
      webhookListening: false,
      webhookUrl: null
    }
  }

  private whatsappStatus(settings: ChatSettings, state: ReturnType<typeof ensureChatState>): ChatProviderStatusDTO {
    const token = this.options.secrets.has(CHAT_SECRET_KEYS.whatsappAccessToken)
    const verify = this.options.secrets.has(CHAT_SECRET_KEYS.whatsappVerifyToken)
    const secret = this.options.secrets.has(CHAT_SECRET_KEYS.whatsappAppSecret)
    const phoneNumberId = settings.whatsapp.phoneNumberId.trim()
    const toPhone = normalizeWhatsAppPhone(settings.whatsapp.toPhone)
    const configured = Boolean(token && phoneNumberId && toPhone)
    const missing: string[] = []
    if (!token) missing.push('access token')
    if (!phoneNumberId) missing.push('phone number ID')
    if (!toPhone) missing.push('recipient phone')
    let detail: string
    if (!settings.enabled) detail = 'Chat is off.'
    else if (!settings.whatsapp.enabled) detail = 'WhatsApp is off.'
    else if (missing.length > 0) detail = `Missing ${missing.join(', ')}.`
    else if (this.webhook?.listening) detail = 'Webhook listening on loopback; outbound ready.'
    else if (!verify || !secret) detail = 'Webhook needs a verify token and app secret.'
    else detail = 'Configured but webhook is not listening.'
    return {
      provider: 'whatsapp',
      enabled: settings.enabled && settings.whatsapp.enabled,
      configured,
      running: Boolean(this.webhook?.listening),
      connected: Boolean(state.lastSuccessAt && (!state.lastErrorAt || state.lastSuccessAt >= state.lastErrorAt)),
      detail,
      lastActivityAt: state.lastActivityAt,
      lastSuccessAt: state.lastSuccessAt,
      lastError: state.lastError,
      lastErrorAt: state.lastErrorAt,
      webhookListening: Boolean(this.webhook?.listening),
      webhookUrl: this.webhookUrl(settings)
    }
  }

  private webhookUrl(settings: ChatSettings): string | null {
    if (!settings.whatsapp.webhookPort || !settings.whatsapp.webhookPath) return null
    return this.webhook?.url ?? `http://127.0.0.1:${settings.whatsapp.webhookPort}${normalizePath(settings.whatsapp.webhookPath)}`
  }

  private networkSignal(timeoutMs: number): AbortSignal {
    return AbortSignal.any([AbortSignal.timeout(timeoutMs), this.lifecycle.signal])
  }

  private combinedSignal(controllerSignal: AbortSignal, timeoutMs: number): AbortSignal {
    return AbortSignal.any([controllerSignal, this.lifecycle.signal, AbortSignal.timeout(timeoutMs)])
  }

  private testFailure(message: string, started: number, provider?: ChatProvider): ChatTestResultDTO {
    const safe = message.slice(0, 500)
    if (provider) this.recordProviderError(provider, safe, 'chat.test_failed')
    const latencyMs = this.now() - started
    return { ok: false, message: safe, latencyMs, account: null }
  }

  private notifyChange(): void {
    this.options.onChange?.()
  }
}

function notificationText(event: EventRecord, settings: ChatSettings): string | null {
  const notify = settings.notify
  const message = event.message.slice(0, 300)
  switch (event.category) {
    case 'application.awaiting_approval':
      return notify.approvals
        ? `APPROVAL NEEDED${event.applicationId ? ` · #${event.applicationId}` : ''}\n${message}\nReply /approvals to review, then /approve <id>.`
        : null
    case 'application.submitted':
      return notify.submitted ? `APPLICATION SUBMITTED${event.applicationId ? ` · #${event.applicationId}` : ''}\n${message}` : null
    case 'application.failed':
    case 'application.uncertain':
    case 'application.needs_human':
    case 'task.failed':
    case 'schedule.failed':
      return notify.failures
        ? `NEEDS ATTENTION${event.applicationId ? ` · #${event.applicationId}` : ''}\n${message}\nReply /applications for the current state.`
        : null
    case 'source.failed':
      return notify.sources ? `SOURCE ISSUE\n${message}\nReply /status for the current queue.` : null
    case 'digest.generated': {
      if (!notify.digest) return null
      const submitted = typeof event.detail?.submitted === 'number' ? event.detail.submitted : null
      const awaiting = typeof event.detail?.awaitingApproval === 'number' ? event.detail.awaitingApproval : null
      const extras = [
        submitted !== null ? `${submitted} submitted` : null,
        awaiting !== null ? `${awaiting} waiting for approval` : null
      ].filter(Boolean)
      return `DAILY REPORT\n${message}${extras.length > 0 ? `\n${extras.join(' · ')}` : ''}\nReply /report for details.`
    }
    default:
      return null
  }
}

function summarizeInbound(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim().slice(0, 240)
  if (/^\/?set\b/i.test(normalized)) {
    const field = normalized.match(/^\/?set\s+([A-Za-z_]+)/i)?.[1]?.toLowerCase() ?? ''
    return field ? `set ${field}` : 'set'
  }
  if (/^\/?confirm\b/i.test(normalized)) return 'confirm ••••••'
  if (/^\/?(approve|reject|retry)\b/i.test(normalized)) {
    const command = normalized.match(/^\/?([a-z]+)\s+#?(\d+)/i)
    return command ? `${command[1]!.toLowerCase()} ${command[2]}` : commandOf(normalized)
  }
  if (/^\/?(whoami)\b/i.test(normalized)) return 'whoami'
  const command = normalized.match(/^\/?([a-z]+)/i)?.[1]
  return command ? command.toLowerCase() : 'message'
}

function summarizeOutbound(text: string): string {
  return text
    .replace(/\/confirm\s+\d{6}/gi, '/confirm ••••••')
    .replace(/\b\d{6}\b/g, '••••••')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
}

function commandOf(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const slash = normalized.match(/^\/([a-z]+)/i)?.[1]
  if (slash) return slash.toLowerCase()
  const word = normalized.match(/^([a-z]+)/i)?.[1]?.toLowerCase() ?? ''
  return word === 'stop' ? 'pause' : word === 'continue' ? 'resume' : word
}

function shortRef(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

function sanitizeError(error: unknown, secrets: (string | null | undefined)[]): string {
  let message = errorMessage(error)
  for (const secret of secrets) {
    if (secret && secret.length >= 4) message = message.split(secret).join('[redacted]')
  }
  return message.slice(0, 500)
}

function normalizePath(path: string): string {
  const trimmed = path.trim() || '/whatsapp/webhook'
  return trimmed.startsWith('/') ? trimmed.replace(/\/+$/, '') || '/' : `/${trimmed}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
