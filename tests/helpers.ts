import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Db } from '@main/db/database'
import { applyMigrations } from '@main/db/migrate'
import { seedDefaults } from '@main/db/seed'
import { createMemoryCipher, SecretStore } from '@main/core/secrets'
import { AiService } from '@main/services/ai'
import { MailService } from '@main/services/mail'
import { ApplicationService } from '@main/services/applications'
import { addResume, getProfile, saveProfile, replaceWorkAuthorizations } from '@main/db/repos/profile'
import { upsertJob, type JobInsert } from '@main/db/repos/jobs'
import { createApplication, type ApplicationRecord } from '@main/db/repos/applications'
import { saveSection, getSection } from '@main/core/settings'
import type { AppSettings } from '@shared/settings'
import type { SponsorEvidence, WorkAuthStatement } from '@shared/types'

export interface TestContext {
  db: Db
  dir: string
  mockOutbox: string
  secrets: SecretStore
  ai: AiService
  mail: MailService
  applications: ApplicationService
  close: () => void
}

export function createTestContext(): TestContext {
  const dir = mkdtempSync(join(tmpdir(), 'bt-applicant-test-'))
  const db = new Db(':memory:')
  applyMigrations(db)
  seedDefaults(db)
  const mockOutbox = join(dir, 'mock-outbox')
  const secrets = new SecretStore(db, createMemoryCipher())
  const ai = new AiService(db, secrets)
  const mail = new MailService(db, secrets, mockOutbox)
  const applications = new ApplicationService(db, ai, mail)
  return {
    db,
    dir,
    mockOutbox,
    secrets,
    ai,
    mail,
    applications,
    close: () => db.close()
  }
}

export const UNSTATED_SPONSOR: SponsorEvidence = {
  signal: 'unstated',
  quote: null,
  offset: null,
  ruleId: null,
  source: 'deterministic'
}

export function seedProfile(db: Db, overrides: Partial<Parameters<typeof saveProfile>[1]> = {}) {
  saveProfile(db, {
    fullName: 'Asha Verma',
    email: 'asha.verma@example.com',
    phone: '+91 90000 00000',
    city: 'Pune',
    countryCode: 'IN',
    citizenships: ['IN'],
    residenceCountry: 'IN',
    linkedin: null,
    website: null,
    github: null,
    summary: 'Backend engineer focused on reliable data pipelines.',
    yearsExperience: 6,
    skills: ['TypeScript', 'Node.js', 'PostgreSQL'],
    languages: [],
    salaryExpectation: null,
    noticePeriod: null,
    earliestStart: null,
    ...overrides
  })
  return getProfile(db)
}

export function seedResume(db: Db, dir: string): number {
  const storedPath = join(dir, 'resume.pdf')
  writeFileSync(storedPath, '%PDF-1.4\nBT Applicant test resume\n%%EOF\n', 'utf8')
  const resume = addResume(db, {
    label: 'Backend resume',
    fileName: 'asha-verma-resume.pdf',
    storedPath,
    mimeType: 'application/pdf',
    sizeBytes: 43,
    sha256: 'test-sha256',
    notes: null
  })
  return resume.id
}

export function authorize(db: Db, items: Parameters<typeof replaceWorkAuthorizations>[1]): void {
  replaceWorkAuthorizations(db, items)
}

export interface JobOverrides extends Partial<JobInsert> {
  sponsor?: SponsorEvidence
  statements?: WorkAuthStatement[]
}

export function seedJob(db: Db, overrides: JobOverrides = {}): number {
  const now = Date.now()
  const { sponsor = UNSTATED_SPONSOR, statements = [], ...jobOverrides } = overrides
  const input: JobInsert = {
    externalId: 'ext-1',
    sourceId: 'greenhouse-tech',
    sourceName: 'Greenhouse — tech employers',
    title: 'Senior Backend Engineer',
    company: 'Acme',
    companyDomain: 'acme.test',
    countryCode: 'DE',
    locationRaw: 'Berlin, Germany',
    remoteType: 'hybrid',
    employmentType: 'full_time',
    salaryMin: 90_000,
    salaryMax: 120_000,
    salaryCurrency: 'EUR',
    salaryPeriod: 'year',
    descriptionHtml: null,
    descriptionText: 'We are hiring a backend engineer. Apply by email to jobs@acme.test. We sponsor visas.',
    requirements: [],
    postedAt: now,
    expiresAt: null,
    url: 'https://acme.test/jobs/1',
    applyUrl: null,
    applicationEmail: 'jobs@acme.test',
    applicationEmailEvidence: 'Apply by email to jobs@acme.test.',
    applicationInstructions: null,
    skills: ['TypeScript', 'Node.js'],
    seniority: 'senior',
    raw: null,
    dedupeKey: 'acme|senior-backend-engineer|de',
    fingerprint: 'fingerprint-acme-1',
    ...jobOverrides
  }
  return upsertJob(db, input, sponsor, statements).id
}

export function seedEmailApplication(
  db: Db,
  jobId: number,
  overrides: Partial<{ recipient: string; status: ApplicationRecord['status']; attempt: number }> = {}
): ApplicationRecord {
  const created = createApplication(db, {
    jobId,
    channel: 'email',
    channelReason: 'The posting explicitly directs applications to a published email address.',
    decisionEvidence: { matchedRule: 'email.published_application_address' },
    status: overrides.status ?? 'draft',
    recipient: overrides.recipient ?? 'jobs@acme.test'
  })
  return created.application
}

export function setAutomation(db: Db, patch: Partial<AppSettings['automation']>): void {
  saveSection(db, 'automation', { ...getSection(db, 'automation'), ...patch })
}

export function setAiMode(db: Db, mode: AppSettings['ai']['mode']): void {
  saveSection(db, 'ai', { ...getSection(db, 'ai'), mode })
}
