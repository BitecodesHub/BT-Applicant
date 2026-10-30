import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getSection, saveSection } from '@main/core/settings'
import { getApplication, listOutboxForApplication, setApplicationStatus } from '@main/db/repos/applications'
import { listEvents } from '@main/db/repos/events'
import { getWebRunForApplication } from '@main/db/repos/web-runs'
import { createApplication } from '@main/db/repos/applications'
import {
  createTestContext,
  seedEmailApplication,
  seedJob,
  seedProfile,
  seedResume,
  setAiMode,
  setAutomation,
  type TestContext
} from './helpers'

let ctx: TestContext
let resumeReady: boolean

function setUpProfile(): void {
  seedProfile(ctx.db)
  if (!resumeReady) {
    seedResume(ctx.db, ctx.dir)
    resumeReady = true
  }
}

function emlFiles(): string[] {
  try {
    return readdirSync(ctx.mockOutbox).filter((name) => name.endsWith('.eml'))
  } catch {
    return []
  }
}

function eventCategories(applicationId: number): string[] {
  return listEvents(ctx.db, { applicationId, limit: 50 }).items.map((event) => event.category)
}

beforeEach(() => {
  ctx = createTestContext()
  resumeReady = false
  setAiMode(ctx.db, 'off')
})

afterEach(() => {
  ctx.close()
})

describe('application workflow', () => {
  it('drafts, approves, and delivers a published-email application through the mock outbox', async () => {
    setUpProfile()
    const jobId = seedJob(ctx.db)
    const application = seedEmailApplication(ctx.db, jobId)

    const draft = await ctx.applications.draft(application.id)
    expect(draft.status).toBe('awaiting_approval')
    expect(draft.aiEnhanced).toBe(false)

    const drafted = getApplication(ctx.db, application.id)!
    expect(drafted.subject).toBe('Application for Senior Backend Engineer — Asha Verma')
    expect(drafted.body).toContain('Acme hiring team')
    expect(drafted.body).toContain('TypeScript')
    expect(drafted.resumeId).not.toBeNull()
    expect(drafted.templateId).not.toBeNull()
    expect(eventCategories(application.id)).toContain('application.drafted')

    const queued = ctx.applications.approve(application.id)
    expect(queued.status).toBe('queued')
    const task = ctx.db.get<{ idempotency_key: string }>(
      "SELECT idempotency_key FROM tasks WHERE type = 'application.dispatch'"
    )
    expect(task?.idempotency_key).toBe(`dispatch:${application.id}:1`)

    const outcome = await ctx.applications.dispatch(application.id)
    expect(outcome.status).toBe('submitted')

    const submitted = getApplication(ctx.db, application.id)!
    expect(submitted.status).toBe('submitted')
    expect(submitted.submittedAt).not.toBeNull()
    expect(submitted.confirmation).toMatchObject({ adapter: 'mock', to: 'jobs@acme.test' })

    const outbox = listOutboxForApplication(ctx.db, application.id)
    expect(outbox).toHaveLength(1)
    expect(outbox[0]?.status).toBe('sent')
    expect(outbox[0]?.adapter).toBe('mock')
    expect(outbox[0]?.providerMessageId).toMatch(/^mock-/)

    const files = emlFiles()
    expect(files).toHaveLength(1)
    const eml = readFileSync(join(ctx.mockOutbox, files[0]!), 'utf8')
    expect(eml).toContain('To: jobs@acme.test')
    expect(eml).toContain('X-Delivery-Mode: mock (no network transmission)')
    expect(eml).toContain('Subject: Application for Senior Backend Engineer — Asha Verma')
    expect(eml).toContain('asha-verma-resume.pdf')
    expect(eml).toContain('Dear Acme hiring team')

    const categories = eventCategories(application.id)
    expect(categories).toContain('email.mock_sent')
    expect(categories).toContain('application.submitted')
  })

  it('falls back to the deterministic template when the AI provider is unreachable', async () => {
    setUpProfile()
    const jobId = seedJob(ctx.db)
    const application = seedEmailApplication(ctx.db, jobId)
    const ai = getSection(ctx.db, 'ai')
    saveSection(ctx.db, 'ai', {
      ...ai,
      mode: 'enhanced',
      chain: ['ollama'],
      ollamaBaseUrl: 'http://127.0.0.1:9',
      timeoutMs: 1_000
    })

    const result = await ctx.applications.draft(application.id)
    expect(result.status).toBe('awaiting_approval')
    expect(result.aiEnhanced).toBe(false)

    const drafted = getApplication(ctx.db, application.id)!
    expect(drafted.body).toContain('The posting calls for')
    const categories = eventCategories(application.id)
    expect(categories).toContain('application.drafted')
    expect(categories).toContain('ai.fallback')
    const fallback = listEvents(ctx.db, { applicationId: application.id, category: 'ai.fallback', limit: 5 }).items[0]
    expect(fallback?.level).toBe('warn')
  })

  it('queues immediately when approval is not required', async () => {
    setUpProfile()
    setAutomation(ctx.db, { requireApproval: false })
    const application = seedEmailApplication(ctx.db, seedJob(ctx.db))

    const result = await ctx.applications.draft(application.id)
    expect(result.status).toBe('queued')
    expect(getApplication(ctx.db, application.id)?.status).toBe('queued')

    const outcome = await ctx.applications.dispatch(application.id)
    expect(outcome.status).toBe('submitted')
  })

  it('blocks drafting when no resume is stored', async () => {
    seedProfile(ctx.db)
    const application = seedEmailApplication(ctx.db, seedJob(ctx.db))

    const result = await ctx.applications.draft(application.id)
    expect(result.status).toBe('needs_human')
    expect(result.detail).toContain('No resume')
    expect(getApplication(ctx.db, application.id)?.body).toBeNull()
  })

  it('keeps the application queued while automation is paused', async () => {
    setUpProfile()
    const application = seedEmailApplication(ctx.db, seedJob(ctx.db))
    await ctx.applications.draft(application.id)
    ctx.applications.approve(application.id)
    setAutomation(ctx.db, { paused: true })

    const outcome = await ctx.applications.dispatch(application.id)
    expect(outcome.status).toBe('queued')
    expect(outcome.detail).toContain('paused')
    expect(emlFiles()).toHaveLength(0)
  })

  it('enforces the daily application limit', async () => {
    setUpProfile()
    setAutomation(ctx.db, { dailyApplicationLimit: 0 })
    const application = seedEmailApplication(ctx.db, seedJob(ctx.db))
    await ctx.applications.draft(application.id)
    ctx.applications.approve(application.id)

    const outcome = await ctx.applications.dispatch(application.id)
    expect(outcome.status).toBe('queued')
    expect(outcome.detail).toContain('Daily limit')
    expect(emlFiles()).toHaveLength(0)
    expect(eventCategories(application.id)).toContain('application.limit')
  })

  it('enforces the per-company cap while excluding the current application', async () => {
    setUpProfile()
    const first = seedEmailApplication(ctx.db, seedJob(ctx.db))
    await ctx.applications.draft(first.id)
    ctx.applications.approve(first.id)
    expect((await ctx.applications.dispatch(first.id)).status).toBe('submitted')

    const secondJob = seedJob(ctx.db, {
      externalId: 'ext-2',
      dedupeKey: 'acme|staff-backend-engineer|de',
      fingerprint: 'fingerprint-acme-2',
      title: 'Staff Backend Engineer',
      url: 'https://acme.test/jobs/2'
    })
    const second = seedEmailApplication(ctx.db, secondJob)
    await ctx.applications.draft(second.id)
    ctx.applications.approve(second.id)

    const outcome = await ctx.applications.dispatch(second.id)
    expect(outcome.status).toBe('needs_human')
    expect(outcome.detail).toContain('Daily cap for Acme')
    expect(emlFiles()).toHaveLength(1)
    expect(listOutboxForApplication(ctx.db, second.id)).toHaveLength(0)
  })

  it('prepares a guided web run instead of submitting a web form automatically', async () => {
    setUpProfile()
    const jobId = seedJob(ctx.db, {
      externalId: 'ext-web',
      applicationEmail: null,
      applicationEmailEvidence: null,
      applyUrl: 'https://jobs.lever.co/acme/123'
    })
    const application = createApplication(ctx.db, {
      jobId,
      channel: 'web',
      channelReason: 'The posting uses Lever for applications.',
      decisionEvidence: { matchedRule: 'web.ats_provider', atsProvider: 'lever' },
      status: 'draft',
      applyUrl: 'https://jobs.lever.co/acme/123'
    }).application

    await ctx.applications.draft(application.id)
    ctx.applications.approve(application.id)
    const outcome = await ctx.applications.dispatch(application.id)

    expect(outcome.status).toBe('needs_human')
    const run = getWebRunForApplication(ctx.db, application.id)
    expect(run?.status).toBe('awaiting_human')
    expect(run?.url).toBe('https://jobs.lever.co/acme/123')
    expect(run?.prefilled.fullName).toBe('Asha Verma')
    expect((run?.steps ?? []).length).toBeGreaterThan(0)
    expect(eventCategories(application.id)).toContain('application.needs_human')
  })

  it('refuses a recipient that does not match the verified posting address', async () => {
    setUpProfile()
    const application = seedEmailApplication(ctx.db, seedJob(ctx.db), { recipient: 'other@acme.test' })
    await ctx.applications.draft(application.id)
    ctx.applications.approve(application.id)

    const outcome = await ctx.applications.dispatch(application.id)
    expect(outcome.status).toBe('needs_human')
    expect(outcome.detail).toContain('does not match')
    expect(emlFiles()).toHaveLength(0)
  })

  it('refuses an address without quoted evidence', async () => {
    setUpProfile()
    const jobId = seedJob(ctx.db, {
      applicationEmail: 'jobs@acme.test',
      applicationEmailEvidence: null,
      applyUrl: null
    })
    const application = seedEmailApplication(ctx.db, jobId)
    await ctx.applications.draft(application.id)
    ctx.applications.approve(application.id)

    const outcome = await ctx.applications.dispatch(application.id)
    expect(outcome.status).toBe('needs_human')
    expect(outcome.detail).toContain('no quoted evidence')
  })

  it('creates a fresh dispatch attempt after a failure', async () => {
    setUpProfile()
    const application = seedEmailApplication(ctx.db, seedJob(ctx.db))
    await ctx.applications.draft(application.id)
    ctx.applications.approve(application.id)
    setApplicationStatus(ctx.db, application.id, 'failed', { error: 'temporary SMTP error' })

    const retried = ctx.applications.retry(application.id)
    expect(retried.status).toBe('queued')
    expect(retried.attempt).toBe(2)
    const keys = ctx.db
      .all<{ idempotency_key: string }>("SELECT idempotency_key FROM tasks WHERE type = 'application.dispatch'")
      .map((row) => row.idempotency_key)
    expect(keys).toContain(`dispatch:${application.id}:2`)

    const outcome = await ctx.applications.dispatch(application.id)
    expect(outcome.status).toBe('submitted')
  })
})

describe('mail adapter safety', () => {
  it('defaults to mock delivery with the kill switch on', () => {
    const status = ctx.mail.status()
    expect(status.mode).toBe('mock')
    expect(status.killSwitch).toBe(true)
    expect(ctx.mail.effectiveMode()).toBe('mock')
    expect(status.message).toContain('Kill switch')
  })

  it('forces mock delivery while the kill switch is on even when SMTP is configured', () => {
    const outbound = getSection(ctx.db, 'outbound')
    saveSection(ctx.db, 'outbound', {
      ...outbound,
      mode: 'smtp',
      killSwitch: true,
      smtp: { host: 'smtp.example.com', port: 587, secure: true, user: 'asha', fromEmail: 'asha@example.com', fromName: 'Asha' }
    })
    ctx.secrets.set('smtp.password', 'app-password')
    expect(ctx.mail.effectiveMode()).toBe('mock')
    expect(ctx.mail.status().message).toContain('Kill switch')
  })

  it('stays on mock when SMTP is selected but incomplete', () => {
    const outbound = getSection(ctx.db, 'outbound')
    saveSection(ctx.db, 'outbound', {
      ...outbound,
      mode: 'smtp',
      killSwitch: false,
      smtp: { ...outbound.smtp, host: 'smtp.example.com', user: 'asha', fromEmail: 'asha@example.com' }
    })
    expect(ctx.mail.effectiveMode()).toBe('mock')
    ctx.secrets.set('smtp.password', 'app-password')
    expect(ctx.mail.effectiveMode()).toBe('smtp')
    const status = ctx.mail.status()
    expect(status.smtpConfigured).toBe(true)
    expect(status.credentialPresent).toBe(true)
  })
})
