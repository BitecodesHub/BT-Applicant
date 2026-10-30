import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSection, saveSection } from '@main/core/settings'
import { currentSchemaVersion } from '@main/db/migrate'
import { createApplication, getApplication } from '@main/db/repos/applications'
import { listChatMessages, ensureChatState, pruneChatMessages, recordChatMessage } from '@main/db/repos/chat'
import { listEvents } from '@main/db/repos/events'
import { getProfile, upsertTargetCountry } from '@main/db/repos/profile'
import { ChatCommandRouter } from '@main/services/chat/commands'
import { ChatService, CHAT_SECRET_KEYS } from '@main/services/chat/service'
import { TelegramClient } from '@main/services/chat/telegram'
import {
  normalizeWhatsAppPhone,
  verifySignature,
  WhatsAppClient,
  WhatsAppWebhookServer,
  type WhatsAppInbound
} from '@main/services/chat/whatsapp'
import { createTestContext, seedEmailApplication, seedJob, seedProfile, type TestContext } from './helpers'

const TELEGRAM_TOKEN = '123456:abcdefghijklmnopqrstuvwx'
let ctx: TestContext
let clock = 1_000_000
let onProfileChanged: ReturnType<typeof vi.fn>
let router: ChatCommandRouter

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function setupRouter(): void {
  router = new ChatCommandRouter(ctx.db, ctx.applications, onProfileChanged as never, {
    now: () => clock,
    code: () => '246810'
  })
}

beforeEach(() => {
  ctx = createTestContext()
  seedProfile(ctx.db)
  clock = 1_000_000
  onProfileChanged = vi.fn(() => ({ evaluated: 3, errors: 0 }))
  setupRouter()
})

afterEach(() => {
  ctx.close()
})

describe('chat schema and defaults', () => {
  it('applies migration v4 with chat tables and safe defaults', () => {
    expect(currentSchemaVersion(ctx.db)).toBe(4)
    const tables = ctx.db
      .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'chat_%' ORDER BY name")
      .map((row) => row.name)
    expect(tables).toEqual(['chat_actions', 'chat_messages', 'chat_state'])

    const settings = getSection(ctx.db, 'chat')
    expect(settings.enabled).toBe(false)
    expect(settings.commandsEnabled).toBe(true)
    expect(settings.telegram.enabled).toBe(false)
    expect(settings.telegram.pollSeconds).toBe(10)
    expect(settings.whatsapp.webhookPort).toBe(4780)
    expect(settings.whatsapp.webhookPath).toBe('/whatsapp/webhook')
    expect(settings.notify.approvals).toBe(true)
    const latestEvent = ctx.db.get<{ id: number | null }>('SELECT MAX(id) AS id FROM events')?.id ?? 0
    expect(ensureChatState(ctx.db, 'telegram').lastEventId).toBe(latestEvent)
  })

  it('prunes old chat summaries and keeps recent ones', () => {
    recordChatMessage(ctx.db, { provider: 'local', direction: 'inbound', chatRef: 'local', summary: 'old', status: 'received' }, 1_000)
    recordChatMessage(ctx.db, { provider: 'local', direction: 'inbound', chatRef: 'local', summary: 'recent', status: 'received' }, 50_000)
    expect(pruneChatMessages(ctx.db, 10_000)).toBe(1)
    expect(listChatMessages(ctx.db, 10).map((message) => message.summary)).toEqual(['recent'])
  })
})

describe('deterministic command router', () => {
  it('answers status and help without changing application state', () => {
    const status = router.execute('/status', 'telegram', '42')
    expect(status.ok).toBe(true)
    expect(status.reply).toContain('BT Applicant · status')
    expect(status.reply).toContain('Approvals:')

    const help = router.execute('help', 'whatsapp', '491512345678')
    expect(help.ok).toBe(true)
    expect(help.reply).toContain('/confirm')
    expect(help.reply).toContain('approve — Prepare an approval')
  })

  it('prepares an approval, then executes it once with a single-use code', () => {
    const jobId = seedJob(ctx.db)
    const application = seedEmailApplication(ctx.db, jobId, { status: 'awaiting_approval' })
    const approveSpy = vi.spyOn(ctx.applications, 'approve')

    const prepared = router.execute(`/approve ${application.id}`, 'telegram', '42')
    expect(prepared.ok).toBe(true)
    expect(prepared.requiresConfirmation).toBe(true)
    expect(prepared.reply).toContain('/confirm 246810')
    expect(approveSpy).not.toHaveBeenCalled()
    expect(getApplication(ctx.db, application.id)!.status).toBe('awaiting_approval')

    const wrongChat = router.execute('/confirm 246810', 'telegram', '999')
    expect(wrongChat.ok).toBe(false)
    expect(approveSpy).not.toHaveBeenCalled()

    const confirmed = router.execute('/confirm 246810', 'telegram', '42')
    expect(confirmed.ok).toBe(true)
    expect(approveSpy).toHaveBeenCalledWith(application.id)
    expect(getApplication(ctx.db, application.id)!.status).toBe('queued')

    const reused = router.execute('/confirm 246810', 'telegram', '42')
    expect(reused.ok).toBe(false)
    expect(reused.reply).toContain('invalid, expired')
  })

  it('rejects an expired code and a code used from another channel', () => {
    const jobId = seedJob(ctx.db)
    const application = seedEmailApplication(ctx.db, jobId, { status: 'awaiting_approval' })
    router.execute(`/approve ${application.id}`, 'telegram', '42')

    clock += 5 * 60_000
    const expired = router.execute('/confirm 246810', 'telegram', '42')
    expect(expired.ok).toBe(false)
    expect(getApplication(ctx.db, application.id)!.status).toBe('awaiting_approval')

    setupRouter()
    const prepared = router.execute(`/approve ${application.id}`, 'whatsapp', '491512345678')
    expect(prepared.ok).toBe(true)
    const wrongChannel = router.execute('/confirm 246810', 'telegram', '491512345678')
    expect(wrongChannel.ok).toBe(false)
  })

  it('passes the rejection reason through only after confirmation', () => {
    const jobId = seedJob(ctx.db)
    const application = seedEmailApplication(ctx.db, jobId, { status: 'awaiting_approval' })
    const prepared = router.execute(`/reject ${application.id} not a fit`, 'telegram', '42')
    expect(prepared.reply).toContain('not a fit')
    expect(getApplication(ctx.db, application.id)!.status).toBe('awaiting_approval')

    expect(router.execute('/confirm 246810', 'telegram', '42').ok).toBe(true)
    const rejected = getApplication(ctx.db, application.id)!
    expect(rejected.status).toBe('rejected')
    expect(rejected.lastError).toBe('not a fit')
  })

  it('retries only failed or blocked applications', () => {
    const jobId = seedJob(ctx.db)
    const created = createApplication(ctx.db, {
      jobId,
      channel: 'email',
      channelReason: 'test',
      decisionEvidence: { matchedRule: 'email.published_application_address' },
      status: 'awaiting_approval',
      recipient: 'jobs@acme.test'
    })
    const invalid = router.execute(`/retry ${created.application.id}`, 'telegram', '42')
    expect(invalid.ok).toBe(false)
    expect(invalid.reply).toContain('only failed or blocked')

    ctx.db.run("UPDATE applications SET status = 'failed' WHERE id = ?", created.application.id)
    const prepared = router.execute(`/retry ${created.application.id}`, 'telegram', '42')
    expect(prepared.requiresConfirmation).toBe(true)
    expect(router.execute('/confirm 246810', 'telegram', '42').ok).toBe(true)
    expect(getApplication(ctx.db, created.application.id)!.status).toBe('queued')
  })

  it('validates profile values before saving and re-evaluates jobs', () => {
    const invalidEmail = router.execute('/set email not-an-email', 'local', 'local')
    expect(invalidEmail.ok).toBe(false)
    expect(getProfile(ctx.db).email).toBe('asha.verma@example.com')

    const invalidCountry = router.execute('/set country Germany', 'local', 'local')
    expect(invalidCountry.ok).toBe(false)

    const phone = router.execute('/set phone +49 151 2345678', 'local', 'local')
    expect(phone.ok).toBe(true)
    expect(phone.reply).toContain('Phone updated.')
    expect(getProfile(ctx.db).phone).toBe('+49 151 2345678')
    expect(onProfileChanged).toHaveBeenCalledTimes(1)

    const skills = router.execute('/set skills Kubernetes, Terraform, AWS', 'local', 'local')
    expect(skills.ok).toBe(true)
    expect(getProfile(ctx.db).skills).toEqual(['Kubernetes', 'Terraform', 'AWS'])
    const event = listEvents(ctx.db, { category: 'profile.updated', limit: 5 }).items[0]!
    expect(event.detail?.field).toBe('skills')
    expect(JSON.stringify(event.detail)).not.toContain('Kubernetes')
  })

  it('normalizes citizenship codes and rejects duplicates', () => {
    const duplicated = router.execute('/set citizenship DE de', 'local', 'local')
    expect(duplicated.ok).toBe(false)
    const saved = router.execute('/set citizenship de, fr', 'local', 'local')
    expect(saved.ok).toBe(true)
    expect(getProfile(ctx.db).citizenships).toEqual(['DE', 'FR'])
  })

  it('pauses and resumes through the same settings the desktop UI uses', () => {
    expect(router.execute('/pause', 'telegram', '42').ok).toBe(true)
    expect(getSection(ctx.db, 'automation').paused).toBe(true)
    expect(router.execute('pause', 'telegram', '42').reply).toContain('already paused')
    expect(router.execute('/resume', 'telegram', '42').ok).toBe(true)
    expect(getSection(ctx.db, 'automation').paused).toBe(false)
  })

  it('queues discovery for enabled targets and refuses when there are none', () => {
    const empty = router.execute('/scan', 'telegram', '42')
    expect(empty.ok).toBe(false)
    expect(empty.reply).toContain('No enabled target')

    upsertTargetCountry(ctx.db, {
      countryCode: 'DE',
      enabled: true,
      remotePreference: 'any',
      employmentTypes: [],
      jobTitles: [],
      keywords: [],
      excludeKeywords: [],
      minSalary: null,
      currency: null,
      seniority: [],
      scheduleCron: '0 6 * * *',
      timezone: 'UTC',
      sources: []
    })
    const queued = router.execute('/scan', 'telegram', '42')
    expect(queued.ok).toBe(true)
    const task = ctx.db.get<{ idempotency_key: string }>("SELECT idempotency_key FROM tasks WHERE type = 'source.poll'")
    expect(task?.idempotency_key).toMatch(/^chat-scan:/)
  })
})

describe('chat service command console', () => {
  function service(): ChatService {
    return new ChatService({
      db: ctx.db,
      secrets: ctx.secrets,
      applications: ctx.applications,
      onProfileChanged: onProfileChanged as never,
      onChange: vi.fn(),
      fetchImpl: vi.fn() as unknown as typeof fetch
    })
  }

  it('records inbound and outbound summaries without confirmation codes', () => {
    const jobId = seedJob(ctx.db)
    const application = seedEmailApplication(ctx.db, jobId, { status: 'awaiting_approval' })
    const chat = service()
    const prepared = chat.runLocalCommand(`/approve ${application.id}`)
    expect(prepared.ok).toBe(true)
    const code = prepared.reply.match(/\/confirm (\d{6})/)?.[1]
    expect(code).toBeTruthy()

    const messages = listChatMessages(ctx.db, 10)
    expect(messages).toHaveLength(2)
    expect(messages[0]!.direction).toBe('outbound')
    expect(messages[0]!.summary).toContain('••••••')
    expect(messages[0]!.summary).not.toContain(code!)
    expect(messages[1]!.direction).toBe('inbound')
    expect(messages[1]!.command).toBe('approve')
  })

  it('refuses commands when they are disabled and rate limits a burst', () => {
    saveSection(ctx.db, 'chat', { ...getSection(ctx.db, 'chat'), commandsEnabled: false })
    const chat = service()
    const disabled = chat.runLocalCommand('/status')
    expect(disabled.ok).toBe(false)
    expect(disabled.reply).toContain('disabled')
    expect(listChatMessages(ctx.db, 5)).toHaveLength(0)

    saveSection(ctx.db, 'chat', { ...getSection(ctx.db, 'chat'), commandsEnabled: true })
    const enabled = service()
    for (let index = 0; index < 20; index += 1) {
      expect(enabled.runLocalCommand('/status').ok).toBe(true)
    }
    const limited = enabled.runLocalCommand('/status')
    expect(limited.ok).toBe(false)
    expect(limited.reply).toContain('Too many commands')
  })

  it('reports secret presence without exposing values and lists every command', () => {
    const chat = service()
    const before = chat.getPage()
    expect(before.secrets).toEqual({
      telegramToken: false,
      whatsappAccessToken: false,
      whatsappVerifyToken: false,
      whatsappAppSecret: false
    })
    expect(before.commands.length).toBeGreaterThanOrEqual(15)
    expect(before.providers).toHaveLength(2)
    expect(before.webhookUrl).toBe('http://127.0.0.1:4780/whatsapp/webhook')

    ctx.secrets.set(CHAT_SECRET_KEYS.telegramToken, TELEGRAM_TOKEN)
    const after = chat.getPage()
    expect(after.secrets.telegramToken).toBe(true)
    expect(JSON.stringify(after)).not.toContain(TELEGRAM_TOKEN)
  })

  it('surfaces a redacted Telegram failure and records it once', async () => {
    ctx.secrets.set(CHAT_SECRET_KEYS.telegramToken, TELEGRAM_TOKEN)
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: false, error_code: 401, description: `Unauthorized bot ${TELEGRAM_TOKEN}` }, 401))
    const chat = new ChatService({
      db: ctx.db,
      secrets: ctx.secrets,
      applications: ctx.applications,
      onProfileChanged: onProfileChanged as never,
      fetchImpl: fetchImpl as unknown as typeof fetch
    })
    const result = await chat.test('telegram')
    expect(result.ok).toBe(false)
    expect(result.message).not.toContain(TELEGRAM_TOKEN)
    expect(result.message).toContain('[bot token]')
    const failed = listEvents(ctx.db, { category: 'chat.test_failed', limit: 10 }).items
    expect(failed).toHaveLength(1)
    const state = ensureChatState(ctx.db, 'telegram')
    expect(state.lastError).toContain('[bot token]')
  })
})

describe('Telegram client', () => {
  it('parses updates, chat identity, and sends text', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
      calls.push({ url, body })
      if (url.endsWith('/getMe')) return jsonResponse({ ok: true, result: { id: 77, username: 'bt_bot', first_name: 'BT' } })
      if (url.endsWith('/getChat')) return jsonResponse({ ok: true, result: { id: 42, type: 'private', first_name: 'Asha' } })
      if (url.endsWith('/getUpdates')) {
        return jsonResponse({
          ok: true,
          result: [
            { update_id: 5, message: { message_id: 7, date: 100, text: '/status', chat: { id: 42, first_name: 'Asha', type: 'private' } } },
            { update_id: 6, message: { message_id: 8, date: 101, chat: { id: 42, first_name: 'Asha' } } }
          ]
        })
      }
      return jsonResponse({ ok: true, result: { message_id: 99 } })
    })
    const client = new TelegramClient(TELEGRAM_TOKEN, fetchImpl as unknown as typeof fetch, 'https://telegram.test')

    await expect(client.getMe()).resolves.toEqual({ id: 77, username: 'bt_bot', firstName: 'BT' })
    await expect(client.getChat('42')).resolves.toEqual({ id: '42', label: 'Asha', type: 'private' })
    const updates = await client.getUpdates(1, 10)
    expect(updates).toEqual([
      { updateId: 5, messageId: 7, chatId: '42', chatLabel: 'Asha', text: '/status', date: 100 }
    ])
    expect(calls.find((call) => call.url.endsWith('/getUpdates'))?.body).toMatchObject({ offset: 1, timeout: 10 })
    await expect(client.sendMessage('42', 'hello')).resolves.toEqual({ messageId: 99 })
  })

  it('splits long messages and redacts the token from errors', async () => {
    const sent: string[] = []
    let messageId = 0
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/sendMessage')) {
        const body = JSON.parse(String(init?.body)) as { text: string }
        sent.push(body.text)
        messageId += 1
        return jsonResponse({ ok: true, result: { message_id: messageId } })
      }
      throw new Error(`network down for ${TELEGRAM_TOKEN}`)
    })
    const client = new TelegramClient(TELEGRAM_TOKEN, fetchImpl as unknown as typeof fetch, 'https://telegram.test')
    await expect(client.sendMessage('1', 'a'.repeat(8000))).resolves.toEqual({ messageId: 3 })
    expect(sent).toHaveLength(3)
    expect(sent.join('')).toHaveLength(8000)

    const error = await client.getMe().catch((caught: unknown) => String(caught))
    expect(error).toContain('Telegram could not be reached.')
    expect(error).not.toContain(TELEGRAM_TOKEN)
  })

  it('rejects a malformed token before making a request', () => {
    expect(() => new TelegramClient('not-a-token')).toThrow('format is invalid')
  })
})

describe('WhatsApp client and webhook', () => {
  it('normalizes phone numbers and fetches the account and sends text', async () => {
    expect(normalizeWhatsAppPhone('+49 (151) 234-5678')).toBe('491512345678')
    expect(normalizeWhatsAppPhone('123')).toBeNull()
    expect(normalizeWhatsAppPhone('+1234567890123456')).toBeNull()

    const calls: { url: string; init?: RequestInit }[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.includes('?fields=')) return jsonResponse({ display_phone_number: '+49 151 2345678', verified_name: 'Asha' })
      return jsonResponse({ messages: [{ id: 'wamid.TEST' }] })
    })
    const client = new WhatsAppClient('EAAG-test-token', '1234567890', 'v23.0', fetchImpl as unknown as typeof fetch, 'https://graph.test')
    await expect(client.getAccount()).resolves.toEqual({ displayPhoneNumber: '+49 151 2345678', verifiedName: 'Asha' })
    await expect(client.sendText('+49 151 2345678', 'hello')).resolves.toEqual({ messageId: 'wamid.TEST' })
    const post = calls.find((call) => call.init?.method === 'POST')!
    const body = JSON.parse(String(post.init?.body)) as { to: string; text: { body: string } }
    expect(body.to).toBe('491512345678')
    expect(body.text.body).toBe('hello')
    expect((post.init?.headers as Record<string, string>).authorization).toBe('Bearer EAAG-test-token')
  })

  it('rejects invalid configuration and redacts access tokens from failures', async () => {
    expect(() => new WhatsAppClient('', '1234567890', 'v23.0')).toThrow('access token')
    expect(() => new WhatsAppClient('token', '+49151', 'v23.0')).toThrow('phone number ID')
    expect(() => new WhatsAppClient('token', '1234567890', '23')).toThrow('version')

    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: 'Invalid OAuth access token EAAG-secret' } }, 401))
    const client = new WhatsAppClient('EAAG-secret', '1234567890', 'v23.0', fetchImpl as unknown as typeof fetch, 'https://graph.test')
    const error = await client.getAccount().catch((caught: unknown) => String(caught))
    expect(error).not.toContain('EAAG-secret')
    expect(error).toContain('[access token]')
  })

  it('verifies HMAC signatures and ignores lookalikes', () => {
    const raw = Buffer.from('{"hello":"world"}', 'utf8')
    const valid = `sha256=${createHmac('sha256', 'app-secret').update(raw).digest('hex')}`
    expect(verifySignature(raw, valid, 'app-secret')).toBe(true)
    expect(verifySignature(raw, valid, 'other-secret')).toBe(false)
    expect(verifySignature(raw, 'sha256=deadbeef', 'app-secret')).toBe(false)
    expect(verifySignature(raw, valid, '')).toBe(false)
  })

  it('verifies GET requests and accepts only signed POST messages', async () => {
    const received: WhatsAppInbound[] = []
    const onVerified = vi.fn()
    const server = new WhatsAppWebhookServer({
      port: 0,
      path: '/whatsapp/webhook',
      verifyToken: 'verify-me',
      appSecret: 'app-secret',
      onVerified,
      onMessage: (message) => {
        received.push(message)
      }
    })
    const url = await server.start()
    try {
      expect(server.listening).toBe(true)
      const verified = await fetch(`${url}?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345`)
      expect(verified.status).toBe(200)
      expect(await verified.text()).toBe('12345')
      expect(onVerified).toHaveBeenCalledTimes(1)

      const wrongToken = await fetch(`${url}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345`)
      expect(wrongToken.status).toBe(403)

      const payload = JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: '1234567890' },
                  messages: [
                    { id: 'wamid.1', from: '491512345678', timestamp: '1700000000', type: 'text', text: { body: '/status' } }
                  ]
                }
              }
            ]
          }
        ]
      })
      const invalid = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=deadbeef' },
        body: payload
      })
      expect(invalid.status).toBe(401)
      expect(received).toHaveLength(0)

      const signature = `sha256=${createHmac('sha256', 'app-secret').update(payload).digest('hex')}`
      const accepted = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
        body: payload
      })
      expect(accepted.status).toBe(200)
      await vi.waitFor(() => expect(received).toHaveLength(1))
      expect(received[0]).toMatchObject({
        messageId: 'wamid.1',
        from: '491512345678',
        text: '/status',
        phoneNumberId: '1234567890'
      })
    } finally {
      await server.stop()
    }
    expect(server.listening).toBe(false)
  })
})
