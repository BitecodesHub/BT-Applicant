import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { E2E_ROOT, MANIFEST, UPLOAD_FILE, USER_DATA } from './paths'
import { Db } from '../src/main/db/database'
import { applyMigrations } from '../src/main/db/migrate'
import { seedDefaults } from '../src/main/db/seed'
import { createMemoryCipher, SecretStore } from '../src/main/core/secrets'
import { DEFAULT_SETTINGS, saveSection } from '../src/main/core/settings'
import { AiService } from '../src/main/services/ai'
import { MailService } from '../src/main/services/mail'
import { ApplicationService } from '../src/main/services/applications'
import { PipelineService } from '../src/main/services/pipeline'
import {
  addResume,
  replaceWorkAuthorizations,
  saveProfile,
  upsertTargetCountry,
  type TargetCountryRecord
} from '../src/main/db/repos/profile'
import { createApplication, getApplication } from '../src/main/db/repos/applications'
import { replaceRoleSelections } from '../src/main/db/repos/roles'
import { analyzeStoredResume } from '../src/main/services/resume'
import { upsertJob, type JobInsert } from '../src/main/db/repos/jobs'
import { logSourceFetch, recordSourceSuccess } from '../src/main/db/repos/sources'
import { upsertSchedule } from '../src/main/db/repos/tasks'
import { logEvent } from '../src/main/db/repos/events'
import type { SponsorEvidence, WorkAuthStatement } from '../src/shared/types'

async function main(): Promise<void> {
const now = Date.now()
const DAY = 86_400_000

rmSync(E2E_ROOT, { recursive: true, force: true })
mkdirSync(USER_DATA, { recursive: true })
mkdirSync(join(USER_DATA, 'resumes'), { recursive: true })
mkdirSync(join(USER_DATA, 'mock-outbox'), { recursive: true })

const db = new Db(join(USER_DATA, 'bt-applicant.db'))
applyMigrations(db)
seedDefaults(db)

function setAutomation(patch: Partial<typeof DEFAULT_SETTINGS.automation>): void {
  saveSection(db, 'automation', { ...DEFAULT_SETTINGS.automation, ...patch })
}

saveSection(db, 'ai', { ...DEFAULT_SETTINGS.ai, mode: 'off' })
saveSection(db, 'outbound', { ...DEFAULT_SETTINGS.outbound, mode: 'mock', killSwitch: true })
saveSection(db, 'ui', { ...DEFAULT_SETTINGS.ui, theme: 'dark', density: 'comfortable' })
saveSection(db, 'digest', { ...DEFAULT_SETTINGS.digest, enabled: true, time: '19:00', notify: false })
saveSection(db, 'worker', { concurrency: 2, pollIntervalMs: 500, leaseMs: 120_000 })
saveSection(db, 'onboarding', { completed: true, step: 4 })

saveProfile(db, {
  fullName: 'Jordan Vale',
  email: 'jordan.vale@example.com',
  phone: '+49 30 901820',
  city: 'Berlin',
  countryCode: 'DE',
  citizenships: ['IN'],
  residenceCountry: 'DE',
  linkedin: 'https://www.linkedin.com/in/jordan-vale',
  website: null,
  github: 'https://github.com/jordan-vale',
  summary:
    'Platform engineer with seven years building reliable delivery systems. I run Kubernetes in production, automate infrastructure with Terraform, and care about boring, observable operations.',
  yearsExperience: 7,
  skills: ['TypeScript', 'Kubernetes', 'Terraform', 'AWS', 'Docker', 'Node.js', 'PostgreSQL', 'GitHub Actions'],
  languages: [
    { language: 'English', level: 'Fluent' },
    { language: 'Hindi', level: 'Native' }
  ],
  salaryExpectation: { min: 95_000, max: 125_000, currency: 'EUR', period: 'year' },
  noticePeriod: '4 weeks',
  earliestStart: 'Flexible'
})

replaceWorkAuthorizations(db, [
  {
    countryCode: 'IN',
    status: 'citizen',
    permitType: null,
    validFrom: null,
    validUntil: null,
    needsSponsorship: false,
    evidenceNote: 'Indian passport holder.'
  },
  {
    countryCode: 'DE',
    status: 'work_permit',
    permitType: 'EU Blue Card',
    validFrom: '2024-03-01',
    validUntil: '2028-12-31',
    needsSponsorship: false,
    evidenceNote: 'Blue Card valid through 2028; no sponsorship needed for German roles.'
  }
])

const resumePath = join(USER_DATA, 'resumes', 'jordan-vale-resume.pdf')
const resumeLines = [
  'Jordan Vale',
  'Platform Engineer',
  'jordan.vale@example.com | +49 30 5550 1188 | Berlin, Germany | linkedin.com/in/jordanvale',
  'Summary',
  'Platform engineer with eight years building reliable internal infrastructure and developer tooling for product teams.',
  'Skills',
  'Kubernetes, Terraform, AWS, Go, Docker, CI/CD, Python, Linux, Prometheus, Grafana',
  'Experience',
  'Senior Platform Engineer | Northwind Cloud | Berlin, Germany',
  'Jan 2021 - Present',
  '- Built the internal developer platform used by 120 engineers.',
  '- Cut deployment lead time from 45 minutes to 6 minutes with Terraform.',
  'DevOps Engineer | Cloudline | Munich, Germany',
  'Mar 2018 - Dec 2020',
  '- Automated release pipelines and infrastructure with Terraform.',
  'Education',
  'BSc Computer Science | Technical University of Munich | 2014 - 2017',
  'Certifications',
  'AWS Certified Solutions Architect - Amazon Web Services, 2022',
  'Certified Kubernetes Administrator (CKA) - Cloud Native Computing Foundation, 2021',
  'Languages',
  'English (Native), German (B2)',
  'Projects',
  'Developer portal | Kubernetes, Terraform',
  '- Built the self-service platform used by product teams.',
  'Awards',
  'Engineering Excellence Award - Northwind Cloud, 2023'
]
const resumeContent = ['BT', '/F1 11 Tf', '72 740 Td', ...resumeLines.flatMap((line, index) => [index === 0 ? '0 0 Td' : '0 -16 Td', `(${line}) Tj`]), 'ET'].join('\n')
const resumePdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length ${Buffer.byteLength(resumeContent)} >> stream
${resumeContent}
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
trailer << /Root 1 0 R >>
%%EOF`
writeFileSync(resumePath, resumePdf, 'utf8')
const storedResume = addResume(db, {
  label: 'Jordan Vale — platform resume',
  fileName: 'jordan-vale-resume.pdf',
  storedPath: resumePath,
  mimeType: 'application/pdf',
  sizeBytes: Buffer.byteLength(resumePdf),
  sha256: 'e2e-fixture-resume-sha256',
  notes: 'Verified resume used by the deterministic end-to-end run.',
  isDefault: true
})
await analyzeStoredResume(db, storedResume.id)

replaceRoleSelections(db, [
  { roleKey: 'platform_engineer', title: 'Platform Engineer', source: 'catalog' },
  { roleKey: 'site_reliability_engineer', title: 'Site Reliability Engineer', source: 'catalog' }
])

const deTarget = upsertTargetCountry(db, {
  countryCode: 'DE',
  enabled: true,
  remotePreference: 'any',
  employmentTypes: ['full_time'],
  jobTitles: ['Platform Engineer', 'DevOps Engineer', 'Site Reliability Engineer', 'Infrastructure Engineer'],
  keywords: ['kubernetes', 'terraform', 'aws'],
  excludeKeywords: ['commission only'],
  minSalary: 90_000,
  currency: 'EUR',
  seniority: ['senior', 'staff'],
  scheduleCron: '0 */6 * * *',
  timezone: 'Europe/Berlin',
  sources: []
})
const inTarget = upsertTargetCountry(db, {
  countryCode: 'IN',
  enabled: true,
  remotePreference: 'any',
  employmentTypes: ['full_time'],
  jobTitles: ['Platform Engineer', 'DevOps Engineer', 'Site Reliability Engineer'],
  keywords: ['kubernetes', 'aws'],
  excludeKeywords: [],
  minSalary: 2_500_000,
  currency: 'INR',
  seniority: ['senior'],
  scheduleCron: '0 9 * * 1-5',
  timezone: 'Asia/Kolkata',
  sources: []
})

const UNSTATED: SponsorEvidence = { signal: 'unstated', quote: null, offset: null, ruleId: null, source: 'deterministic' }
const OFFERED: SponsorEvidence = {
  signal: 'sponsorship_offered',
  quote: 'We provide visa sponsorship for this role.',
  offset: 0,
  ruleId: 'sponsorship.explicit_offer',
  source: 'deterministic'
}
const NOT_OFFERED: SponsorEvidence = {
  signal: 'sponsorship_not_offered',
  quote: 'We are unable to sponsor visas for this position.',
  offset: 0,
  ruleId: 'sponsorship.explicit_refusal',
  source: 'deterministic'
}
const CITIZEN_ONLY: SponsorEvidence = {
  signal: 'citizenship_or_clearance_required',
  quote: 'Applicants must be US citizens and eligible for a security clearance.',
  offset: 0,
  ruleId: 'sponsorship.citizenship_required',
  source: 'deterministic'
}
const STATEMENTS: Record<string, WorkAuthStatement[]> = {
  gitlab: [{ quote: 'We provide visa sponsorship for this role.', offset: 0, ruleId: 'sponsorship.explicit_offer' }],
  cloudflare: [{ quote: 'We are unable to sponsor visas for this position.', offset: 0, ruleId: 'sponsorship.explicit_refusal' }],
  discord: [{ quote: 'Applicants must be US citizens and eligible for a security clearance.', offset: 0, ruleId: 'sponsorship.citizenship_required' }]
}

interface SeedJob {
  key: string
  externalId: string
  company: string
  title: string
  countryCode: string
  location: string
  remoteType: JobInsert['remoteType']
  salaryMin: number
  salaryMax: number
  currency: string
  email: string | null
  emailEvidence: string | null
  applyUrl: string | null
  sponsor: SponsorEvidence
  skills: string[]
  postedDaysAgo: number
  description: string
}

const seedJobs: SeedJob[] = [
  {
    key: 'stripe',
    externalId: 'stripe-e2e-platform',
    company: 'Stripe',
    title: 'Senior Platform Engineer',
    countryCode: 'DE',
    location: 'Berlin, Germany',
    remoteType: 'hybrid',
    salaryMin: 96_000,
    salaryMax: 128_000,
    currency: 'EUR',
    email: 'stripe-jobs@example.test',
    emailEvidence: 'Apply by email to stripe-jobs@example.test with your resume.',
    applyUrl: null,
    sponsor: UNSTATED,
    skills: ['Kubernetes', 'Terraform', 'AWS', 'TypeScript'],
    postedDaysAgo: 1,
    description:
      'Stripe is hiring a Senior Platform Engineer in Berlin to build reliable self-service infrastructure. You will work with Kubernetes, Terraform and AWS. Apply by email to stripe-jobs@example.test with your resume. Hybrid, three days per week in the office.'
  },
  {
    key: 'datadog',
    externalId: 'datadog-e2e-sre',
    company: 'Datadog',
    title: 'Site Reliability Engineer',
    countryCode: 'DE',
    location: 'Remote, Germany',
    remoteType: 'remote',
    salaryMin: 92_000,
    salaryMax: 120_000,
    currency: 'EUR',
    email: 'datadog-jobs@example.test',
    emailEvidence: 'Send applications by email to datadog-jobs@example.test.',
    applyUrl: null,
    sponsor: OFFERED,
    skills: ['Kubernetes', 'Go', 'Terraform', 'Observability'],
    postedDaysAgo: 2,
    description:
      'Datadog is looking for a Site Reliability Engineer to operate large-scale observability systems. We provide visa sponsorship for this role. Send applications by email to datadog-jobs@example.test. Fully remote within Germany.'
  },
  {
    key: 'figma',
    externalId: 'figma-e2e-devops',
    company: 'Figma',
    title: 'Staff DevOps Engineer',
    countryCode: 'DE',
    location: 'Berlin, Germany',
    remoteType: 'hybrid',
    salaryMin: 110_000,
    salaryMax: 145_000,
    currency: 'EUR',
    email: null,
    emailEvidence: null,
    applyUrl: 'https://jobs.lever.co/figma/e2e-staff-devops',
    sponsor: UNSTATED,
    skills: ['Kubernetes', 'Terraform', 'CI/CD', 'AWS'],
    postedDaysAgo: 3,
    description:
      'Figma is hiring a Staff DevOps Engineer to improve developer productivity and platform reliability. This role uses Kubernetes, Terraform and CI/CD. Apply through the Lever application form.'
  },
  {
    key: 'cloudflare',
    externalId: 'cloudflare-e2e-infra',
    company: 'Cloudflare',
    title: 'Senior Infrastructure Engineer',
    countryCode: 'US',
    location: 'Austin, United States',
    remoteType: 'onsite',
    salaryMin: 150_000,
    salaryMax: 190_000,
    currency: 'USD',
    email: 'cloudflare-jobs@example.test',
    emailEvidence: 'Email cloudflare-jobs@example.test to apply.',
    applyUrl: null,
    sponsor: NOT_OFFERED,
    skills: ['Kubernetes', 'Go', 'Networking'],
    postedDaysAgo: 4,
    description:
      'Cloudflare is hiring a Senior Infrastructure Engineer in Austin. We are unable to sponsor visas for this position. Email cloudflare-jobs@example.test to apply.'
  },
  {
    key: 'discord',
    externalId: 'discord-e2e-platform',
    company: 'Discord',
    title: 'Platform Engineer',
    countryCode: 'US',
    location: 'Remote, United States',
    remoteType: 'remote',
    salaryMin: 145_000,
    salaryMax: 185_000,
    currency: 'USD',
    email: 'discord-jobs@example.test',
    emailEvidence: 'Send your application to discord-jobs@example.test.',
    applyUrl: null,
    sponsor: CITIZEN_ONLY,
    skills: ['Kubernetes', 'Rust', 'Terraform'],
    postedDaysAgo: 5,
    description:
      'Discord is hiring a Platform Engineer. Applicants must be US citizens and eligible for a security clearance. Send your application to discord-jobs@example.test.'
  },
  {
    key: 'gitlab',
    externalId: 'gitlab-e2e-sre',
    company: 'GitLab',
    title: 'Senior Site Reliability Engineer',
    countryCode: 'NL',
    location: 'Amsterdam, Netherlands',
    remoteType: 'remote',
    salaryMin: 85_000,
    salaryMax: 110_000,
    currency: 'EUR',
    email: 'gitlab-jobs@example.test',
    emailEvidence: 'Applications are accepted by email at gitlab-jobs@example.test.',
    applyUrl: null,
    sponsor: OFFERED,
    skills: ['Kubernetes', 'Ruby', 'Terraform', 'Prometheus'],
    postedDaysAgo: 2,
    description:
      'GitLab is looking for a Senior Site Reliability Engineer in the Netherlands. We provide visa sponsorship for this role. Applications are accepted by email at gitlab-jobs@example.test.'
  },
  {
    key: 'openai',
    externalId: 'openai-e2e-infra',
    company: 'OpenAI',
    title: 'Infrastructure Engineer',
    countryCode: 'GB',
    location: 'London, United Kingdom',
    remoteType: 'hybrid',
    salaryMin: 110_000,
    salaryMax: 150_000,
    currency: 'GBP',
    email: null,
    emailEvidence: null,
    applyUrl: 'https://jobs.ashbyhq.com/openai/e2e-infrastructure',
    sponsor: UNSTATED,
    skills: ['Kubernetes', 'Python', 'Distributed Systems'],
    postedDaysAgo: 1,
    description:
      'OpenAI is hiring an Infrastructure Engineer in London to scale training infrastructure. The posting does not state whether visa sponsorship is available.'
  },
  {
    key: 'huggingface',
    externalId: 'huggingface-e2e-platform',
    company: 'Hugging Face',
    title: 'ML Platform Engineer',
    countryCode: 'CA',
    location: 'Toronto, Canada',
    remoteType: 'hybrid',
    salaryMin: 130_000,
    salaryMax: 165_000,
    currency: 'CAD',
    email: 'huggingface-jobs@example.test',
    emailEvidence: 'Send your resume to huggingface-jobs@example.test.',
    applyUrl: null,
    sponsor: UNSTATED,
    skills: ['Python', 'Kubernetes', 'MLOps', 'AWS'],
    postedDaysAgo: 6,
    description:
      'Hugging Face is hiring an ML Platform Engineer in Toronto. The posting does not discuss work authorization. Send your resume to huggingface-jobs@example.test.'
  }
]

const jobIds: Record<string, number> = {}
for (const job of seedJobs) {
  const input: JobInsert = {
    externalId: job.externalId,
    sourceId: 'greenhouse-tech',
    sourceName: 'Greenhouse — tech employers',
    title: job.title,
    company: job.company,
    companyDomain: null,
    countryCode: job.countryCode,
    locationRaw: job.location,
    remoteType: job.remoteType,
    employmentType: 'full_time',
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    salaryCurrency: job.currency,
    salaryPeriod: 'year',
    descriptionHtml: null,
    descriptionText: job.description,
    requirements: [],
    postedAt: now - job.postedDaysAgo * DAY,
    expiresAt: null,
    url: `https://example.test/${job.key}/jobs/${job.externalId}`,
    applyUrl: job.applyUrl,
    applicationEmail: job.email,
    applicationEmailEvidence: job.emailEvidence,
    applicationInstructions: null,
    skills: job.skills,
    seniority: 'senior',
    raw: null,
    dedupeKey: `${job.company}|${job.title}|${job.countryCode}`.toLowerCase(),
    fingerprint: `fingerprint-${job.key}-e2e`
  }
  jobIds[job.key] = upsertJob(db, input, job.sponsor, STATEMENTS[job.key] ?? []).id
}

const secrets = new SecretStore(db, createMemoryCipher())
const ai = new AiService(db, secrets)
const mail = new MailService(db, secrets, join(USER_DATA, 'mock-outbox'))
const applications = new ApplicationService(db, ai, mail)
const pipeline = new PipelineService(db, secrets)

setAutomation({ allowedChannels: [] })
for (const id of Object.values(jobIds)) pipeline.evaluateJob(id)
setAutomation({ allowedChannels: ['email', 'web'], minScore: 55 })

function expectStatus(id: number, status: string): void {
  const app = getApplication(db, id)
  if (!app || app.status !== status) {
    throw new Error(`Fixture application ${id} expected ${status}, received ${app?.status ?? 'missing'} (${app?.lastError ?? 'no error'})`)
  }
}

const stripeApplication = createApplication(db, {
  jobId: jobIds.stripe!,
  channel: 'email',
  channelReason: 'The posting explicitly directs applications to a published email address.',
  decisionEvidence: { matchedRule: 'email.published_application_address' },
  status: 'draft',
  recipient: 'stripe-jobs@example.test'
}).application
await applications.draft(stripeApplication.id)
expectStatus(stripeApplication.id, 'awaiting_approval')

const datadogApplication = createApplication(db, {
  jobId: jobIds.datadog!,
  channel: 'email',
  channelReason: 'The posting explicitly directs applications to a published email address.',
  decisionEvidence: { matchedRule: 'email.published_application_address' },
  status: 'draft',
  recipient: 'datadog-jobs@example.test'
}).application
await applications.draft(datadogApplication.id)
applications.approve(datadogApplication.id)
const datadogOutcome = await applications.dispatch(datadogApplication.id)
if (datadogOutcome.status !== 'submitted') throw new Error(`Fixture Datadog dispatch failed: ${datadogOutcome.detail}`)

const figmaApplication = createApplication(db, {
  jobId: jobIds.figma!,
  channel: 'web',
  channelReason: 'The posting uses the Lever application form.',
  decisionEvidence: { matchedRule: 'web.ats_provider', atsProvider: 'lever' },
  status: 'draft',
  applyUrl: 'https://jobs.lever.co/figma/e2e-staff-devops'
}).application
await applications.draft(figmaApplication.id)
applications.approve(figmaApplication.id)
const figmaOutcome = await applications.dispatch(figmaApplication.id)
if (figmaOutcome.status !== 'needs_human') throw new Error(`Fixture Figma web dispatch expected needs_human, received ${figmaOutcome.status}`)

db.run('DELETE FROM tasks')

const sampleTasks = [
  ['source.poll', 'done', 8, now - 3_600_000, now - 3_540_000],
  ['job.evaluate', 'done', 6, now - 3_500_000, now - 3_480_000],
  ['application.dispatch', 'done', 9, now - 1_800_000, now - 1_790_000]
] as const
for (const [type, status, priority, createdAt, completedAt] of sampleTasks) {
  db.run(
    `INSERT INTO tasks (type, payload, status, priority, run_at, attempts, max_attempts, idempotency_key, result, created_at, updated_at, completed_at)
     VALUES (?, '{}', ?, ?, ?, 1, 5, ?, '{"ok":true}', ?, ?, ?)`,
    type,
    status,
    priority,
    createdAt,
    `fixture:${type}:${createdAt}`,
    createdAt,
    completedAt,
    completedAt
  )
}

const healthySources: Array<[string, number]> = [
  ['greenhouse-tech', 74],
  ['ashby-tech', 41],
  ['remotive', 63]
]
for (const [sourceId, items] of healthySources) {
  recordSourceSuccess(db, sourceId, items)
  logSourceFetch(db, {
    sourceId,
    startedAt: now - 2 * 3_600_000,
    finishedAt: now - 2 * 3_600_000 + 840,
    status: 'ok',
    items,
    newItems: Math.round(items / 9),
    error: null
  })
}

const scheduleAt = now + 60 * 60_000
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const schedules: Array<{ key: string; taskType: Parameters<typeof upsertSchedule>[1]['taskType']; cron: string; payload?: Record<string, unknown> }> = [
  { key: 'metrics.rollup', taskType: 'metrics.rollup', cron: '7 * * * *' },
  { key: 'application.reconcile', taskType: 'application.reconcile', cron: '*/10 * * * *' },
  { key: 'maintenance.reaper', taskType: 'maintenance.reaper', cron: '*/5 * * * *' },
  { key: 'maintenance.retention', taskType: 'maintenance.retention', cron: '20 3 * * *' },
  { key: 'digest.generate', taskType: 'digest.generate', cron: '0 19 * * *' },
  ...[deTarget, inTarget].map((target: TargetCountryRecord) => ({
    key: `target:${target.id}:poll`,
    taskType: 'source.poll' as const,
    cron: target.scheduleCron,
    payload: { targetCountryId: target.id }
  }))
]
for (const schedule of schedules) {
  upsertSchedule(db, {
    key: schedule.key,
    taskType: schedule.taskType,
    payload: schedule.payload ?? {},
    cron: schedule.cron,
    timezone: timeZone,
    enabled: true,
    nextRunAt: scheduleAt
  })
}

logEvent(db, {
  category: 'system.fixture_ready',
  message: 'Deterministic end-to-end workspace prepared',
  actor: 'system',
  detail: { jobs: seedJobs.length, applications: 3, sources: 14 }
})

writeFileSync(
  UPLOAD_FILE,
  `Jordan Vale
Platform Engineer · Berlin
jordan.vale@example.com | +49 30 5550 1188

Summary
Platform engineer focused on developer experience, reliable delivery, and calm production operations.

Skills
Kubernetes, Terraform, AWS, Go, Docker, GitHub Actions, Prometheus, Grafana, Linux

Experience
Staff Platform Engineer | Northwind Cloud | Berlin, Germany
Feb 2024 - Present
- Led the developer experience programme for 140 engineers.
- Standardised Terraform modules and GitHub Actions pipelines across teams.

Education
BSc Computer Science | Technical University of Munich | 2014 - 2017

Certifications
Certified Kubernetes Administrator (CKA) - Cloud Native Computing Foundation, 2021

Languages
English (Native), German (Professional)

Projects
Developer portal | Kubernetes, Terraform
- Built the self-service platform used by product teams.

Awards
Engineering Excellence Award - Northwind Cloud, 2023
`,
  'utf8'
)

const initialEmlFiles = readdirSync(join(USER_DATA, 'mock-outbox')).filter((name) => name.endsWith('.eml'))
const manifest = {
  generatedAt: now,
  userData: USER_DATA,
  database: join(USER_DATA, 'bt-applicant.db'),
  mockOutbox: join(USER_DATA, 'mock-outbox'),
  uploadFile: UPLOAD_FILE,
  initialEmlCount: initialEmlFiles.length,
  initialEmlFiles,
  jobs: {
    stripe: jobIds.stripe,
    datadog: jobIds.datadog,
    figma: jobIds.figma,
    cloudflare: jobIds.cloudflare,
    discord: jobIds.discord,
    gitlab: jobIds.gitlab,
    openai: jobIds.openai,
    huggingface: jobIds.huggingface
  },
  jobTitles: Object.fromEntries(seedJobs.map((job) => [job.key, job.title])),
  applications: {
    stripe: stripeApplication.id,
    datadog: datadogApplication.id,
    figma: figmaApplication.id
  },
  targets: { de: deTarget.id, in: inTarget.id },
  resumeId: 1,
  sourceId: 'greenhouse-tech'
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2), 'utf8')

db.checkpoint()
db.close()

console.log(`[fixture] workspace ${USER_DATA}`)
console.log(`[fixture] jobs ${JSON.stringify(jobIds)}`)
console.log(`[fixture] applications ${JSON.stringify(manifest.applications)}`)
console.log(`[fixture] mock emails ${initialEmlFiles.length}`)
}

main().catch((error) => {
  console.error('[fixture] failed', error)
  process.exitCode = 1
})
