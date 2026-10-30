import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { copyFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { AiProviderId, ApplicationStatus, EligibilityVerdict, Severity, TaskType, WorkAuthorizationStatus } from '../shared/types'
import type {
  ApiChannel,
  ApplicationDetailBundleDTO,
  ApplicationListItemDTO,
  ApplicationStatsDTO,
  BootstrapDTO,
  ConnectorDTO,
  DailyReportDTO,
  DashboardDTO,
  DiagnosticsDTO,
  EventDTO,
  JobDetailBundleDTO,
  JobListFiltersDTO,
  JobStatsDTO,
  MailStatusDTO,
  OutboxDTO,
  QueuePageDTO,
  ResumeExtractionDTO,
  ResumeUploadDTO,
  ScheduleDTO,
  SystemCountsDTO,
  SystemStatusDTO,
  TaskDTO,
  TemplateDTO,
  WebRunDTO,
  WorkAuthorizationDTO
} from '../shared/api'
import type { AppSettings, SettingsSection } from '../shared/settings'
import type { AppContainer } from './services/container'
import { loadSettings, saveSection } from './core/settings'
import { systemTimeZone, dateKey } from './core/time'
import { plural } from './core/text'
import { isValidCron } from './core/cron'
import { currentSchemaVersion } from './db/migrate'
import { listEvents, recentErrors, logEvent } from './db/repos/events'
import { computeDayMetrics, listDayMetrics, listDigests, getDigest } from './db/repos/metrics'
import { getApplicationStats, listApplications, getApplication, patchApplication, listOutbox, getOutbox, listResponses } from './db/repos/applications'
import { getEvaluation, getJob, getJobStats, listJobs } from './db/repos/jobs'
import {
  addResume,
  deleteResume,
  getProfile,
  getResume,
  listResumes,
  listTargetCountries,
  listWorkAuthorizations,
  profileCompleteness,
  replaceWorkAuthorizations,
  saveProfile,
  deleteTargetCountry,
  setTargetEnabled,
  upsertTargetCountry,
  listCountryAnswers,
  upsertCountryAnswer,
  deleteCountryAnswer,
  setDefaultResume
} from './db/repos/profile'
import {
  deleteSource,
  getSource,
  listSourceFetches,
  listSources,
  setSourceEnabled,
  upsertSource
} from './db/repos/sources'
import {
  deleteTemplate,
  getTemplate,
  listTemplateVersions,
  listTemplates,
  createTemplate,
  updateTemplate,
  setDefaultTemplate
} from './db/repos/templates'
import {
  getQueueStats,
  getTask,
  listHeartbeats,
  listSchedules,
  listTasks,
  requestCancel,
  retryTask,
  enqueue,
  setScheduleEnabled
} from './db/repos/tasks'
import { getWebRunForApplication } from './db/repos/web-runs'
import { getResumeExtraction, listResumeExtractions, type ResumeExtractionRecord } from './db/repos/resume-extractions'
import { CONNECTOR_METAS, getConnector } from './connectors/registry'
import { countAiCallsSince } from './db/repos/ai'
import { buildDigest, backlogCounts, todayReport } from './services/reporting'
import { analyzeStoredResume, importResumeIntoProfile } from './services/resume'
import { recommendRoles, roleSelectionPage, saveRoleSelections } from './services/roles'
import type { SourceRecord } from './db/repos/sources'

const nowDayStart = (): number => {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new Error(`Invalid request: ${result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`)
  }
  return result.data
}

const idSchema = z.object({ id: z.number().int().positive() })
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const profilePatchSchema = z
  .object({
    fullName: z.string().max(200),
    email: z.string().max(320),
    phone: z.string().max(80).nullable(),
    city: z.string().max(120).nullable(),
    countryCode: z.string().max(2).nullable(),
    citizenships: z.array(z.string().max(2)).max(10),
    residenceCountry: z.string().max(2).nullable(),
    linkedin: z.string().max(500).nullable(),
    website: z.string().max(500).nullable(),
    github: z.string().max(500).nullable(),
    summary: z.string().max(4000).nullable(),
    yearsExperience: z.number().min(0).max(80).nullable(),
    skills: z.array(z.string().max(80)).max(100),
    languages: z.array(z.object({ language: z.string().max(80), level: z.string().max(80) })).max(20),
    salaryExpectation: z
      .object({
        min: z.number().min(0),
        max: z.number().min(0).optional(),
        currency: z.string().min(3).max(3),
        period: z.enum(['year', 'month', 'hour'])
      })
      .nullable(),
    noticePeriod: z.string().max(120).nullable(),
    earliestStart: z.string().max(120).nullable()
  })
  .partial()

const workAuthSchema = z.object({
  countryCode: z.string().length(2),
  status: z.enum(['citizen', 'permanent_resident', 'work_permit', 'student_permit', 'dependent_permit', 'none']),
  permitType: z.string().max(200).nullable().optional(),
  validFrom: z.string().max(40).nullable().optional(),
  validUntil: z.string().max(40).nullable().optional(),
  needsSponsorship: z.boolean(),
  evidenceNote: z.string().max(2000).nullable().optional()
})

const targetSchema = z.object({
  countryCode: z.string().length(2),
  enabled: z.boolean(),
  remotePreference: z.enum(['remote', 'hybrid', 'onsite', 'any']),
  employmentTypes: z.array(z.string().max(40)).max(20),
  jobTitles: z.array(z.string().max(120)).max(30),
  keywords: z.array(z.string().max(80)).max(50),
  excludeKeywords: z.array(z.string().max(80)).max(50),
  minSalary: z.number().min(0).nullable(),
  currency: z.string().max(3).nullable(),
  seniority: z.array(z.string().max(40)).max(20),
  scheduleCron: z.string().max(120),
  timezone: z.string().max(80),
  sources: z.array(z.string().max(120)).max(100)
})

const sourceSchema = z.object({
  id: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/),
  connector: z.string().min(2).max(60),
  label: z.string().min(2).max(200),
  config: z.record(z.string(), z.unknown()),
  enabled: z.boolean(),
  countries: z.array(z.string().length(2)).max(250),
  rateLimitPerMinute: z.number().int().min(1).max(300)
})

const templateSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(2).max(200),
  kind: z.enum(['application_email', 'cover_letter', 'follow_up']),
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(40_000),
  isDefault: z.boolean(),
  note: z.string().max(1000).nullable().optional()
})

const automationSchema = z.object({
  paused: z.boolean(),
  unattendedEnabled: z.boolean(),
  requireApproval: z.boolean(),
  dailyApplicationLimit: z.number().int().min(0).max(100),
  minScore: z.number().min(0).max(100),
  allowedChannels: z.array(z.enum(['email', 'web', 'manual'])),
  excludeCompanies: z.array(z.string().max(200)).max(500),
  maxApplicationsPerCompanyPerDay: z.number().int().min(0).max(20)
})

const outboundSchema = z.object({
  mode: z.enum(['mock', 'smtp']),
  killSwitch: z.boolean(),
  smtp: z.object({
    host: z.string().max(255),
    port: z.number().int().min(1).max(65535),
    secure: z.boolean(),
    user: z.string().max(320),
    fromEmail: z.string().max(320),
    fromName: z.string().max(200)
  })
})

const aiSchema = z.object({
  mode: z.enum(['enhanced', 'off', 'simulated_outage']),
  chain: z.array(z.enum(['ollama', 'anthropic', 'openai', 'gemini', 'openai_compatible'])).min(1),
  models: z.record(z.string(), z.string().max(200)),
  ollamaBaseUrl: z.string().max(500),
  compatibleBaseUrl: z.string().max(500),
  timeoutMs: z.number().int().min(1000).max(120_000),
  maxCallsPerDay: z.number().int().min(0).max(10_000),
  maxOutputTokens: z.number().int().min(64).max(8192),
  temperature: z.number().min(0).max(1)
})

const digestSchema = z.object({
  enabled: z.boolean(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  notify: z.boolean()
})
const chatSchema = z.object({
  enabled: z.boolean(),
  commandsEnabled: z.boolean(),
  telegram: z.object({
    enabled: z.boolean(),
    chatId: z.string().max(64).regex(/^$|^-?\d{1,20}$/),
    username: z.string().max(64),
    pollSeconds: z.number().int().min(2).max(50)
  }),
  whatsapp: z.object({
    enabled: z.boolean(),
    phoneNumberId: z.string().max(30).regex(/^\d*$/),
    businessAccountId: z.string().max(30).regex(/^\d*$/),
    toPhone: z
      .string()
      .max(32)
      .regex(/^[+\d\s()-]*$/)
      .refine((value) => !value.trim() || /^\d{7,15}$/.test(value.replace(/[^\d]/g, ''))),
    webhookPort: z.number().int().min(1024).max(65535),
    webhookPath: z.string().max(120).regex(/^\/[A-Za-z0-9/_-]*$/),
    graphVersion: z.string().regex(/^v\d{1,2}\.\d{1,2}$/)
  }),
  notify: z.object({
    approvals: z.boolean(),
    submitted: z.boolean(),
    failures: z.boolean(),
    digest: z.boolean(),
    sources: z.boolean()
  })
})
const uiSchema = z.object({ theme: z.enum(['light', 'dark', 'system']), density: z.enum(['comfortable', 'compact']) })
const retentionSchema = z.object({
  eventsDays: z.number().int().min(7).max(3650),
  jobsDays: z.number().int().min(30).max(3650),
  aiCallsDays: z.number().int().min(7).max(3650)
})
const workerSchema = z.object({
  concurrency: z.number().int().min(1).max(8),
  pollIntervalMs: z.number().int().min(250).max(60_000),
  leaseMs: z.number().int().min(30_000).max(600_000)
})
const onboardingSchema = z.object({ completed: z.boolean(), step: z.number().int().min(0).max(10) })

function mapApplicationStats(stats: ReturnType<typeof getApplicationStats>): ApplicationStatsDTO {
  return stats
}

function mapJobStats(stats: ReturnType<typeof getJobStats>): JobStatsDTO {
  return stats
}

function systemCounts(container: AppContainer): SystemCountsDTO {
  const db = container.db
  const count = (sql: string, ...params: (string | number)[]): number => db.get<{ n: number }>(sql, ...params)?.n ?? 0
  return {
    jobs: count('SELECT COUNT(*) AS n FROM jobs'),
    activeJobs: count("SELECT COUNT(*) AS n FROM jobs WHERE status = 'active'"),
    applications: count('SELECT COUNT(*) AS n FROM applications WHERE active = 1'),
    awaitingApproval: count("SELECT COUNT(*) AS n FROM applications WHERE status = 'awaiting_approval' AND active = 1"),
    needsHuman: count("SELECT COUNT(*) AS n FROM applications WHERE status = 'needs_human' AND active = 1"),
    queued: count("SELECT COUNT(*) AS n FROM applications WHERE status IN ('queued','approved') AND active = 1"),
    submitted: count("SELECT COUNT(*) AS n FROM applications WHERE status = 'submitted'"),
    sources: count('SELECT COUNT(*) AS n FROM sources'),
    sourcesEnabled: count('SELECT COUNT(*) AS n FROM sources WHERE enabled = 1'),
    resumes: count('SELECT COUNT(*) AS n FROM resumes'),
    targets: count('SELECT COUNT(*) AS n FROM target_countries WHERE enabled = 1'),
    pendingTasks: count("SELECT COUNT(*) AS n FROM tasks WHERE status IN ('pending','running')"),
    deadTasks: count("SELECT COUNT(*) AS n FROM tasks WHERE status = 'dead'"),
    eventsToday: count('SELECT COUNT(*) AS n FROM events WHERE ts >= ?', nowDayStart())
  }
}

function systemStatus(container: AppContainer): SystemStatusDTO {
  const settings = loadSettings(container.db)
  return {
    version: container.options.version,
    platform: process.platform,
    userDataDir: container.paths.userDataDir,
    dbPath: container.paths.database,
    schemaVersion: currentSchemaVersion(container.db),
    workerRunning: container.worker.isRunning(),
    inFlight: container.worker.inFlight(),
    paused: settings.automation.paused,
    mail: container.mail.status(),
    aiMode: settings.ai.mode,
    timeZone: systemTimeZone()
  }
}

function mapWebRun(run: ReturnType<typeof getWebRunForApplication>): WebRunDTO | null {
  if (!run) return null
  return { ...run }
}

function applicationListForJob(container: AppContainer, jobId: number): ApplicationListItemDTO[] {
  return listApplications(container.db, { limit: 500 }).items.filter((item) => item.jobId === jobId)
}

function eventList(container: AppContainer, filters: Parameters<typeof listEvents>[1]): EventDTO[] {
  return listEvents(container.db, filters).items
}

function connectorList(): ConnectorDTO[] {
  return CONNECTOR_METAS.map((meta) => ({ ...meta, registered: true }))
}

export function registerIpc(container: AppContainer, notifyChange: () => void): void {
  const appSettings = (): AppSettings => loadSettings(container.db)
  const todayStart = nowDayStart()
  const timeZone = systemTimeZone()

  const handlers: Record<ApiChannel | string, (payload: unknown, event: IpcMainInvokeEvent) => unknown> = {
    'app.bootstrap': (): BootstrapDTO => {
      const profile = getProfile(container.db)
      const authorizations = listWorkAuthorizations(container.db)
      const resumes = listResumes(container.db)
      return {
        system: systemStatus(container),
        settings: appSettings(),
        profile,
        completeness: profileCompleteness(profile, resumes.length, authorizations.length),
        authorizations,
        targets: listTargetCountries(container.db),
        resumes,
        sources: listSources(container.db),
        counts: systemCounts(container),
        aiProviders: container.ai.health(),
        connectors: connectorList(),
        onboarded: appSettings().onboarding.completed
      }
    },

    'app.dashboard': (): DashboardDTO => {
      const dates: string[] = []
      for (let offset = 6; offset >= 0; offset -= 1) dates.push(dateKey(Date.now() - offset * 86_400_000, timeZone))
      const metrics7 = dates.map((date) => computeDayMetrics(container.db, date, timeZone))
      return {
        system: systemStatus(container),
        counts: systemCounts(container),
        digest: buildDigest(container.db, dateKey(Date.now(), timeZone), timeZone),
        metrics7,
        jobStats: mapJobStats(getJobStats(container.db, todayStart)),
        applicationStats: mapApplicationStats(getApplicationStats(container.db)),
        queue: getQueueStats(container.db, todayStart),
        recentEvents: eventList(container, { limit: 8 }),
        recentApplications: listApplications(container.db, { limit: 6 }).items,
        sources: listSources(container.db),
        aiProviders: container.ai.health()
      }
    },

    'app.dailyReport': (payload): DailyReportDTO => {
      const request = parse(z.object({ date: isoDate.optional() }).optional(), payload) ?? {}
      const report = todayReport(container.db)
      const date = request.date ?? report.date
      const metrics = computeDayMetrics(container.db, date, timeZone)
      const digest = getDigest(container.db, date) ?? buildDigest(container.db, date, timeZone)
      const days: ReturnType<typeof computeDayMetrics>[] = []
      for (let offset = 13; offset >= 0; offset -= 1) {
        days.push(computeDayMetrics(container.db, dateKey(Date.now() - offset * 86_400_000, timeZone), timeZone))
      }
      return {
        date,
        metrics,
        digest,
        backlog: backlogCounts(container.db),
        days,
        digests: listDigests(container.db, 30),
        queue: getQueueStats(container.db, todayStart),
        events: eventList(container, { from: nowDayStart(), limit: 100 })
      }
    },

    'app.diagnostics': (): DiagnosticsDTO => {
      const settings = appSettings()
      let dbSizeBytes = 0
      try {
        dbSizeBytes = statSync(container.paths.database).size
      } catch {
        dbSizeBytes = 0
      }
      const dayMetrics = computeDayMetrics(container.db, dateKey(Date.now(), timeZone), timeZone)
      return {
        system: systemStatus(container),
        counts: systemCounts(container),
        queue: getQueueStats(container.db, todayStart),
        schemaVersion: currentSchemaVersion(container.db),
        dbSizeBytes,
        databasePath: container.paths.database,
        userDataDir: container.paths.userDataDir,
        heartbeats: listHeartbeats(container.db),
        recentErrors: recentErrors(container.db, 30),
        sourceHealth: listSources(container.db),
        aiProviders: container.ai.health(),
        aiCallsToday: countAiCallsSince(container.db, todayStart),
        aiFallbacksToday: dayMetrics.aiFallbacks,
        retention: settings.retention,
        versions: process.versions as unknown as Record<string, string>
      }
    },

    'profile.get': () => {
      const profile = getProfile(container.db)
      const authorizations = listWorkAuthorizations(container.db)
      return {
        profile,
        completeness: profileCompleteness(profile, listResumes(container.db).length, authorizations.length)
      }
    },
    'profile.save': (payload) => {
      const patch = parse(profilePatchSchema, payload)
      const current = getProfile(container.db)
      const profile = saveProfile(container.db, { ...current, ...patch })
      const result = container.pipeline.reEvaluateJobs(200)
      logEvent(container.db, {
        category: 'profile.updated',
        message: 'Profile saved',
        actor: 'user',
        detail: { reEvaluated: result.evaluated, evaluationErrors: result.errors }
      })
      notifyChange()
      return {
        profile,
        completeness: profileCompleteness(profile, listResumes(container.db).length, listWorkAuthorizations(container.db).length)
      }
    },
    'authorizations.list': () => listWorkAuthorizations(container.db) as WorkAuthorizationDTO[],
    'authorizations.replace': (payload) => {
      const items = parse(z.array(workAuthSchema).max(250), payload)
      const saved = replaceWorkAuthorizations(container.db, items)
      const result = container.pipeline.reEvaluateJobs(200)
      logEvent(container.db, {
        category: 'authorizations.updated',
        message: `Work authorization records replaced (${saved.length} countries)`,
        actor: 'user',
        detail: { reEvaluated: result.evaluated }
      })
      notifyChange()
      return saved
    },
    'answers.list': () => listCountryAnswers(container.db),
    'answers.upsert': (payload) => {
      const input = parse(
        z.object({
          questionKey: z.string().min(1).max(120),
          questionText: z.string().min(1).max(500),
          countryCode: z.string().length(2).nullable().optional(),
          answer: z.string().max(4000),
          verified: z.boolean()
        }),
        payload
      )
      upsertCountryAnswer(container.db, input)
      notifyChange()
      return listCountryAnswers(container.db)
    },
    'answers.delete': (payload) => {
      const input = parse(idSchema, payload)
      deleteCountryAnswer(container.db, input.id)
      notifyChange()
      return listCountryAnswers(container.db)
    },

    'resumes.list': () => listResumes(container.db),
    'resumes.upload': async () => uploadResume(container, notifyChange),
    'resumes.delete': (payload) => {
      const { id } = parse(idSchema, payload)
      deleteResume(container.db, id)
      notifyChange()
      return listResumes(container.db)
    },
    'resumes.default': (payload) => {
      const { id } = parse(idSchema, payload)
      setDefaultResume(container.db, id)
      notifyChange()
      return listResumes(container.db)
    },
    'resumes.reveal': (payload) => {
      const { id } = parse(idSchema, payload)
      const resume = getResume(container.db, id)
      if (!resume) throw new Error('Resume not found')
      if (!resolve(resume.storedPath).startsWith(resolve(container.paths.resumes))) {
        throw new Error('Refusing to open a file outside the managed resume directory')
      }
      shell.showItemInFolder(resume.storedPath)
    },
    'resumes.extractions': () => listResumeExtractions(container.db).map(extractionDto),
    'resumes.analyze': async (payload) => {
      const { id } = parse(idSchema, payload)
      const record = await analyzeStoredResume(container.db, id)
      logEvent(container.db, {
        category: 'resume.analyzed',
        message: `Resume read locally: ${record.data.skills.length} skills, ${record.data.experience.length} roles, ${record.data.certifications.length} certifications`,
        actor: 'user',
        detail: { resumeId: id, confidence: record.confidence, textChars: record.textChars }
      })
      notifyChange()
      return extractionDto(record)
    },
    'resumes.import': (payload) => {
      const { id } = parse(idSchema, payload)
      const result = importResumeIntoProfile(container.db, id)
      const reEvaluated = container.pipeline.reEvaluateJobs(200)
      logEvent(container.db, {
        category: 'resume.imported',
        message:
          result.imported.length > 0
            ? `Imported ${result.imported.join(', ')} into the profile`
            : 'Resume details reviewed; the profile already had every extracted value',
        actor: 'user',
        detail: { resumeId: id, imported: result.imported, keptExisting: result.keptExisting, reEvaluated: reEvaluated.evaluated }
      })
      notifyChange()
      return {
        profile: result.profile,
        completeness: profileCompleteness(
          result.profile,
          listResumes(container.db).length,
          listWorkAuthorizations(container.db).length
        ),
        imported: result.imported,
        keptExisting: result.keptExisting
      }
    },

    'roles.page': () => roleSelectionPage(container.db),
    'roles.save': (payload) => {
      const input = parse(
        z.object({
          selectedKeys: z.array(z.string().min(1).max(80)).max(30),
          customTitles: z.array(z.string().max(120)).max(10)
        }),
        payload
      )
      const page = saveRoleSelections(container.db, input)
      const reEvaluated = container.pipeline.reEvaluateJobs(200)
      logEvent(container.db, {
        category: 'roles.updated',
        message: `Target roles updated (${page.effectiveTitles.length} title variations)`,
        actor: 'user',
        detail: { catalogRoles: page.catalog.filter((role) => role.selected).map((role) => role.key), custom: page.customSelections.map((item) => item.title), reEvaluated: reEvaluated.evaluated }
      })
      notifyChange()
      return page
    },
    'roles.recommend': () => recommendRoles(container.db),

    'targets.list': () => listTargetCountries(container.db),
    'targets.save': (payload) => {
      const parsed = parse(z.object({ id: z.number().int().positive().optional(), input: targetSchema }), payload)
      if (!isValidCron(parsed.input.scheduleCron, parsed.input.timezone || timeZone)) {
        throw new Error('Schedule cron expression is invalid for the selected time zone')
      }
      upsertTargetCountry(container.db, parsed.input, parsed.id)
      container.syncSchedules()
      logEvent(container.db, {
        category: 'target.saved',
        message: `Target country ${parsed.input.countryCode.toUpperCase()} saved`,
        actor: 'user'
      })
      notifyChange()
      return listTargetCountries(container.db)
    },
    'targets.delete': (payload) => {
      const { id } = parse(idSchema, payload)
      deleteTargetCountry(container.db, id)
      container.syncSchedules()
      notifyChange()
      return listTargetCountries(container.db)
    },
    'targets.toggle': (payload) => {
      const { id, enabled } = parse(z.object({ id: z.number().int().positive(), enabled: z.boolean() }), payload)
      setTargetEnabled(container.db, id, enabled)
      container.syncSchedules()
      notifyChange()
      return listTargetCountries(container.db)
    },
    'targets.poll': (payload) => {
      const { id } = parse(idSchema, payload)
      const target = listTargetCountries(container.db).find((item) => item.id === id)
      if (!target) throw new Error('Target country not found')
      const task = enqueue(container.db, {
        type: 'source.poll',
        payload: { targetCountryId: id },
        priority: 9,
        idempotencyKey: `manual-poll:${id}:${Math.floor(Date.now() / 10_000)}`
      })
      notifyChange()
      return { taskId: task.id }
    },

    'sources.list': () => listSources(container.db),
    'sources.save': (payload) => {
      const input = parse(sourceSchema, payload)
      if (!getConnector(input.connector)) throw new Error(`Connector ${input.connector} is not registered`)
      upsertSource(container.db, { ...input, countries: input.countries.map((code) => code.toUpperCase()) })
      logEvent(container.db, { category: 'source.saved', message: `Source ${input.label} saved`, actor: 'user', sourceId: input.id })
      notifyChange()
      return listSources(container.db)
    },
    'sources.toggle': (payload) => {
      const { id, enabled } = parse(z.object({ id: z.string().min(1), enabled: z.boolean() }), payload)
      setSourceEnabled(container.db, id, enabled)
      notifyChange()
      return listSources(container.db)
    },
    'sources.delete': (payload) => {
      const { id } = parse(z.object({ id: z.string().min(1) }), payload)
      const existing = getSource(container.db, id)
      const connector = existing ? getConnector(existing.connector) : null
      deleteSource(container.db, id)
      for (const field of connector?.meta.credentialFields ?? []) {
        container.secrets.delete(`source.${id}.${field.key}`)
      }
      logEvent(container.db, { category: 'source.deleted', message: `Source ${existing?.label ?? id} removed`, actor: 'user' })
      notifyChange()
      return listSources(container.db)
    },
    'sources.test': async (payload) => {
      const input = parse(
        z.object({
          id: z.string().optional(),
          connector: z.string().min(2),
          config: z.record(z.string(), z.unknown()),
          countryCode: z.string().length(2)
        }),
        payload
      )
      return testSource(container, input)
    },
    'sources.history': (payload) => {
      const { id } = parse(z.object({ id: z.string().min(1) }), payload)
      return listSourceFetches(container.db, id)
    },
    'sources.connectors': () => connectorList(),

    'jobs.list': (payload) => {
      const filters = parse(
        z
          .object({
            search: z.string().max(200).optional(),
            status: z.string().optional(),
            verdict: z.string().optional(),
            country: z.string().max(2).optional(),
            sourceId: z.string().optional(),
            remoteType: z.string().optional(),
            minScore: z.number().min(0).max(100).optional(),
            onlyActive: z.boolean().optional(),
            needsAttention: z.boolean().optional(),
            limit: z.number().int().min(1).max(500).optional(),
            offset: z.number().int().min(0).optional(),
            sort: z.enum(['score', 'newest', 'company']).optional()
          })
          .optional(),
        payload
      ) as JobListFiltersDTO | undefined
      return listJobs(container.db, filters ?? {})
    },
    'jobs.get': (payload): JobDetailBundleDTO => {
      const { id } = parse(idSchema, payload)
      const job = getJob(container.db, id)
      if (!job) throw new Error('Job not found')
      const evaluation = getEvaluation(container.db, id)
      const applications = applicationListForJob(container, id)
      return {
        job,
        evaluation: evaluation
          ? {
              jobId: evaluation.jobId,
              verdict: evaluation.verdict,
              score: evaluation.score,
              scoreBreakdown: evaluation.breakdown,
              reasons: evaluation.reasons,
              ruleIds: evaluation.ruleIds,
              authorizationBasis: evaluation.authorizationBasis as never,
              matchedBloc: evaluation.matchedBloc,
              requiresSponsorship: evaluation.requiresSponsorship,
              profileHash: evaluation.profileHash,
              evaluatedAt: evaluation.evaluatedAt
            }
          : null,
        application: getApplication(container.db, applications[0]?.id ?? -1) ?? null,
        relatedApplications: applications,
        events: eventList(container, { jobId: id, limit: 100 }),
        emailEvidence: job.applicationEmail
          ? { email: job.applicationEmail, evidence: job.applicationEmailEvidence }
          : null
      }
    },
    'jobs.evaluate': (payload) => {
      const { id } = parse(idSchema, payload)
      const outcome = container.pipeline.evaluateJob(id)
      notifyChange()
      return outcome
    },
    'jobs.reEvaluateAll': () => {
      const result = container.pipeline.reEvaluateJobs(500)
      notifyChange()
      return result
    },

    'applications.list': (payload) => {
      const filters = parse(
        z
          .object({
            search: z.string().max(200).optional(),
            status: z.string().optional(),
            channel: z.string().optional(),
            limit: z.number().int().min(1).max(500).optional(),
            offset: z.number().int().min(0).optional()
          })
          .optional(),
        payload
      )
      return listApplications(container.db, (filters ?? {}) as never)
    },
    'applications.get': (payload): ApplicationDetailBundleDTO => {
      const { id } = parse(idSchema, payload)
      const application = getApplication(container.db, id)
      if (!application) throw new Error('Application not found')
      const job = getJob(container.db, application.jobId)
      if (!job) throw new Error('Job for this application is missing')
      const evaluation = getEvaluation(container.db, job.id)
      return {
        application,
        job,
        evaluation: evaluation
          ? {
              jobId: evaluation.jobId,
              verdict: evaluation.verdict,
              score: evaluation.score,
              scoreBreakdown: evaluation.breakdown,
              reasons: evaluation.reasons,
              ruleIds: evaluation.ruleIds,
              authorizationBasis: evaluation.authorizationBasis as never,
              matchedBloc: evaluation.matchedBloc,
              requiresSponsorship: evaluation.requiresSponsorship,
              profileHash: evaluation.profileHash,
              evaluatedAt: evaluation.evaluatedAt
            }
          : null,
        events: eventList(container, { applicationId: id, limit: 100 }),
        outbox: listOutboxForApplicationSafe(container, id),
        responses: listResponses(container.db, id),
        webRun: mapWebRun(getWebRunForApplication(container.db, id)),
        resume: application.resumeId ? getResume(container.db, application.resumeId) ?? null : null
      }
    },
    'applications.approve': (payload) => {
      const { id } = parse(idSchema, payload)
      const application = container.applications.approve(id)
      notifyChange()
      return application
    },
    'applications.reject': (payload) => {
      const { id, reason } = parse(z.object({ id: z.number().int().positive(), reason: z.string().max(2000).nullable().optional() }), payload)
      const application = container.applications.reject(id, reason ?? null)
      notifyChange()
      return application
    },
    'applications.retry': (payload) => {
      const { id } = parse(idSchema, payload)
      const application = container.applications.retry(id)
      notifyChange()
      return application
    },
    'applications.dispatch': async (payload) => {
      const { id } = parse(idSchema, payload)
      const outcome = await container.applications.dispatch(id)
      notifyChange()
      return outcome
    },
    'applications.saveDraft': (payload) => {
      const input = parse(
        z.object({ id: z.number().int().positive(), subject: z.string().min(1).max(300), body: z.string().min(1).max(20_000) }),
        payload
      )
      const application = getApplication(container.db, input.id)
      if (!application) throw new Error('Application not found')
      if (application.status === 'submitted' || application.status === 'sending') {
        throw new Error('Submitted applications cannot be edited')
      }
      const updated = patchApplication(container.db, input.id, { subject: input.subject, body: input.body })
      logEvent(container.db, {
        category: 'application.draft_edited',
        message: `Draft for application #${input.id} edited by the user`,
        applicationId: input.id,
        jobId: application.jobId,
        actor: 'user'
      })
      notifyChange()
      return updated
    },
    'applications.response': (payload) => {
      const input = parse(
        z.object({
          id: z.number().int().positive(),
          kind: z.enum(['acknowledgement', 'interview', 'rejection', 'offer', 'other']),
          notes: z.string().max(2000).nullable().optional()
        }),
        payload
      )
      container.applications.recordResponse(input.id, input.kind, input.notes ?? null)
      notifyChange()
      return listResponses(container.db, input.id)
    },
    'applications.confirmWeb': (payload) => {
      const input = parse(z.object({ id: z.number().int().positive(), note: z.string().min(3).max(1000) }), payload)
      const application = container.applications.confirmWebSubmission(input.id, input.note)
      notifyChange()
      return application
    },
    'outbox.list': (payload) => {
      const filters = parse(
        z.object({ status: z.string().optional(), limit: z.number().int().min(1).max(500).optional() }).optional(),
        payload
      )
      return listOutbox(container.db, (filters ?? {}) as never) as OutboxDTO[]
    },
    'outbox.reveal': (payload) => {
      const { id } = parse(idSchema, payload)
      const message = getOutbox(container.db, id)
      if (!message) throw new Error('Outbox message not found')
      const attachment = message.attachments[0]
      if (attachment && resolve(attachment.storedPath).startsWith(resolve(container.paths.resumes))) {
        shell.showItemInFolder(attachment.storedPath)
        return
      }
      void shell.openPath(container.paths.mockOutbox)
    },

    'templates.list': (payload) => {
      const filters = parse(z.object({ kind: z.enum(['application_email', 'cover_letter', 'follow_up']).optional() }).optional(), payload)
      return listTemplates(container.db, filters?.kind)
    },
    'templates.save': (payload): TemplateDTO[] => {
      const input = parse(templateSchema, payload)
      if (input.id) {
        updateTemplate(container.db, input.id, { name: input.name, subject: input.subject, body: input.body, note: input.note ?? undefined })
        if (input.isDefault) setDefaultTemplate(container.db, input.id)
      } else {
        const created = createTemplate(container.db, {
          name: input.name,
          kind: input.kind,
          subject: input.subject,
          body: input.body,
          isDefault: input.isDefault
        })
        if (input.isDefault) setDefaultTemplate(container.db, created.id)
      }
      notifyChange()
      return listTemplates(container.db)
    },
    'templates.delete': (payload) => {
      const { id } = parse(idSchema, payload)
      deleteTemplate(container.db, id)
      notifyChange()
      return listTemplates(container.db)
    },
    'templates.default': (payload) => {
      const { id } = parse(idSchema, payload)
      setDefaultTemplate(container.db, id)
      notifyChange()
      return listTemplates(container.db)
    },
    'templates.versions': (payload) => {
      const { id } = parse(idSchema, payload)
      return listTemplateVersions(container.db, id)
    },

    'settings.get': () => appSettings(),
    'settings.save': async (payload): Promise<AppSettings> => {
      const input = parse(z.object({ section: z.enum(['automation', 'outbound', 'ai', 'chat', 'digest', 'ui', 'retention', 'worker', 'onboarding']), value: z.unknown() }), payload)
      const current = appSettings()
      let value: unknown
      switch (input.section) {
        case 'automation':
          value = parse(automationSchema, input.value)
          break
        case 'outbound':
          value = parse(outboundSchema, input.value)
          break
        case 'ai':
          value = parse(aiSchema, input.value)
          break
        case 'chat':
          value = parse(chatSchema, input.value)
          break
        case 'digest':
          value = parse(digestSchema, input.value)
          break
        case 'ui':
          value = parse(uiSchema, input.value)
          break
        case 'retention':
          value = parse(retentionSchema, input.value)
          break
        case 'worker':
          value = parse(workerSchema, input.value)
          break
        case 'onboarding':
          value = parse(onboardingSchema, input.value)
          break
      }
      saveSection(container.db, input.section as SettingsSection, value as never)
      void current
      if (input.section === 'worker') {
        container.worker.configure(value as AppSettings['worker'])
      }
      if (input.section === 'chat') {
        await container.chat.reconfigure()
      }
      container.syncSchedules()
      logEvent(container.db, {
        category: 'settings.updated',
        message: `Settings section ${input.section} updated`,
        actor: 'user'
      })
      notifyChange()
      return appSettings()
    },
    'chat.page': () => container.chat.getPage(),
    'chat.save': async (payload) => {
      const { settings } = parse(z.object({ settings: chatSchema }), payload)
      saveSection(container.db, 'chat', settings)
      await container.chat.reconfigure()
      logEvent(container.db, {
        category: 'settings.updated',
        message: 'Settings section chat updated',
        actor: 'user',
        detail: { telegram: settings.enabled && settings.telegram.enabled, whatsapp: settings.enabled && settings.whatsapp.enabled }
      })
      notifyChange()
      return container.chat.getPage()
    },
    'chat.test': async (payload) => {
      const { provider } = parse(z.object({ provider: z.enum(['telegram', 'whatsapp']) }), payload)
      const result = await container.chat.test(provider)
      notifyChange()
      return result
    },
    'chat.sendTest': async (payload) => {
      const { provider } = parse(z.object({ provider: z.enum(['telegram', 'whatsapp']) }), payload)
      const result = await container.chat.sendTest(provider)
      notifyChange()
      return result
    },
    'chat.command': (payload) => {
      const { text } = parse(z.object({ text: z.string().max(2000) }), payload)
      return container.chat.runLocalCommand(text)
    },
    'secrets.list': () => container.secrets.listKeys(),
    'secrets.set': async (payload) => {
      const input = parse(z.object({ key: z.string().min(3).max(200), value: z.string().max(4000) }), payload)
      assertSecretKey(input.key)
      container.secrets.set(input.key, input.value)
      logEvent(container.db, { category: 'secret.updated', message: `Secret ${input.key} stored`, actor: 'user' })
      if (input.key.startsWith('chat.')) await container.chat.reconfigure()
      notifyChange()
      return container.secrets.listKeys()
    },
    'secrets.delete': async (payload) => {
      const { key } = parse(z.object({ key: z.string().min(3).max(200) }), payload)
      assertSecretKey(key)
      container.secrets.delete(key)
      if (key.startsWith('chat.')) await container.chat.reconfigure()
      notifyChange()
      return container.secrets.listKeys()
    },
    'mail.status': () => container.mail.status(),
    'mail.verify': () => container.mail.verify(),
    'ai.status': () => container.ai.health(),
    'ai.test': async () => {
      const result = await container.ai.complete({
        purpose: 'diagnostic',
        system: 'You are a connectivity diagnostic. Respond with exactly: OK',
        prompt: 'Reply with OK.',
        maxTokens: 16
      })
      return {
        ok: result.ok,
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        text: result.text,
        error: result.error,
        reason: result.reason
      }
    },

    'tasks.page': (): QueuePageDTO => ({
      queue: getQueueStats(container.db, todayStart),
      tasks: listTasks(container.db, { limit: 250 }),
      schedules: listSchedules(container.db),
      heartbeats: listHeartbeats(container.db)
    }),
    'tasks.retry': (payload) => {
      const { id } = parse(idSchema, payload)
      retryTask(container.db, id)
      notifyChange()
      return {
        queue: getQueueStats(container.db, todayStart),
        tasks: listTasks(container.db, { limit: 250 }),
        schedules: listSchedules(container.db),
        heartbeats: listHeartbeats(container.db)
      }
    },
    'tasks.cancel': (payload) => {
      const { id } = parse(idSchema, payload)
      requestCancel(container.db, id)
      notifyChange()
      return {
        queue: getQueueStats(container.db, todayStart),
        tasks: listTasks(container.db, { limit: 250 }),
        schedules: listSchedules(container.db),
        heartbeats: listHeartbeats(container.db)
      }
    },
    'tasks.run': (payload) => {
      const input = parse(
        z.object({
          type: z.enum([
            'source.poll',
            'job.evaluate',
            'application.draft',
            'application.dispatch',
            'application.reconcile',
            'web.submit',
            'metrics.rollup',
            'digest.generate',
            'maintenance.retention',
            'maintenance.reaper'
          ]),
          payload: z.record(z.string(), z.unknown()).optional()
        }),
        payload
      )
      const task = enqueue(container.db, {
        type: input.type as TaskType,
        payload: input.payload ?? {},
        priority: 10,
        idempotencyKey: `manual:${input.type}:${Date.now()}`
      })
      notifyChange()
      return { taskId: task.id }
    },
    'tasks.scheduleToggle': (payload) => {
      const { id, enabled } = parse(z.object({ id: z.number().int().positive(), enabled: z.boolean() }), payload)
      setScheduleEnabled(container.db, id, enabled)
      container.syncSchedules()
      notifyChange()
      return listSchedules(container.db) as ScheduleDTO[]
    },

    'events.list': (payload) => {
      const filters = parse(
        z
          .object({
            search: z.string().max(200).optional(),
            level: z.enum(['info', 'warn', 'error', 'all']).optional(),
            category: z.string().max(120).optional(),
            limit: z.number().int().min(1).max(500).optional(),
            offset: z.number().int().min(0).optional()
          })
          .optional(),
        payload
      )
      return listEvents(container.db, (filters ?? {}) as never)
    }
  }

  ipcMain.handle('api:invoke', async (event, channel: string, payload: unknown) => {
    assertTrustedSender(event)
    const handler = handlers[channel]
    if (!handler) throw new Error(`Unknown API channel: ${channel}`)
    try {
      return await handler(payload, event)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.startsWith('Invalid request:')) throw error
      console.error(`[ipc] ${channel} failed:`, error)
      throw error
    }
  })
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? ''
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl && url.startsWith(devUrl)) return
  if (url.startsWith('file://')) return
  throw new Error('Rejected IPC call from an untrusted frame')
}

function assertSecretKey(key: string): void {
  if (
    !/^(smtp\.password|ai\.(anthropic|openai|gemini|openai_compatible)|source\.[a-z0-9-]+\.[A-Za-z][A-Za-z0-9_]*|chat\.(telegram\.botToken|whatsapp\.(accessToken|verifyToken|appSecret)))$/.test(
      key
    )
  ) {
    throw new Error(`Secret key ${key} is not allowed`)
  }
}

function listOutboxForApplicationSafe(container: AppContainer, applicationId: number): OutboxDTO[] {
  return listOutbox(container.db, { limit: 500 })
    .filter((message) => message.applicationId === applicationId)
    .sort((a, b) => a.attempt - b.attempt) as OutboxDTO[]
}

function extractionDto(record: ResumeExtractionRecord): ResumeExtractionDTO {
  return {
    resumeId: record.resumeId,
    parserVersion: record.parserVersion,
    textChars: record.textChars,
    confidence: record.confidence,
    warnings: record.warnings,
    sectionsFound: record.sectionsFound,
    extractedAt: record.extractedAt,
    data: record.data,
    textPreview: record.text.slice(0, 4000)
  }
}

async function analyzeResumeSafe(
  container: AppContainer,
  resumeId: number
): Promise<{ extraction: ResumeExtractionDTO | null; error: string | null }> {
  try {
    const record = await analyzeStoredResume(container.db, resumeId)
    logEvent(container.db, {
      category: 'resume.analyzed',
      message: `Resume read locally: ${record.data.skills.length} skills, ${record.data.experience.length} roles, ${record.data.certifications.length} certifications`,
      actor: 'system',
      detail: { resumeId, confidence: record.confidence, textChars: record.textChars }
    })
    return { extraction: extractionDto(record), error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logEvent(container.db, {
      category: 'resume.analyze_failed',
      level: 'warn',
      message: `Resume could not be read: ${message}`,
      detail: { resumeId }
    })
    return { extraction: null, error: message }
  }
}

async function uploadResume(container: AppContainer, notifyChange: () => void): Promise<ResumeUploadDTO | null> {
  const result = await dialog.showOpenDialog({
    title: 'Choose a resume file',
    properties: ['openFile'],
    filters: [{ name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'txt', 'md', 'rtf'] }]
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const filePath = result.filePaths[0]!
  const stats = statSync(filePath)
  if (stats.size > 10 * 1024 * 1024) throw new Error('Resume files must be smaller than 10 MB')
  const extension = extname(filePath).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.rtf': 'application/rtf'
  }
  const mimeType = mimeTypes[extension]
  if (!mimeType) throw new Error('Choose a PDF, Word, text, Markdown, or RTF file')
  const buffer = await import('node:fs/promises').then((fs) => fs.readFile(filePath))
  const sha256 = createHash('sha256').update(buffer).digest('hex')
  const existing = listResumes(container.db).find((resume) => resume.sha256 === sha256)
  if (existing) {
    const cached = getResumeExtraction(container.db, existing.id)
    if (cached) {
      return { resume: existing, extraction: extractionDto(cached), extractionError: null }
    }
    const analyzed = await analyzeResumeSafe(container, existing.id)
    notifyChange()
    return { resume: existing, extraction: analyzed.extraction, extractionError: analyzed.error }
  }
  mkdirSync(container.paths.resumes, { recursive: true })
  const storedPath = join(container.paths.resumes, `${sha256.slice(0, 12)}-${basename(filePath)}`)
  copyFileSync(filePath, storedPath)
  const resume = addResume(container.db, {
    label: basename(filePath, extension),
    fileName: basename(filePath),
    storedPath,
    mimeType,
    sizeBytes: stats.size,
    sha256,
    notes: null
  })
  logEvent(container.db, {
    category: 'resume.added',
    message: `Resume ${resume.fileName} added`,
    actor: 'user',
    detail: { sizeBytes: resume.sizeBytes, sha256: resume.sha256 }
  })
  const analyzed = await analyzeResumeSafe(container, resume.id)
  notifyChange()
  return { resume, extraction: analyzed.extraction, extractionError: analyzed.error }
}

async function testSource(
  container: AppContainer,
  input: { id?: string; connector: string; config: Record<string, unknown>; countryCode: string }
): Promise<{ ok: boolean; message: string; sampleCount?: number; sampleTitles?: string[]; latencyMs?: number }> {
  const connector = getConnector(input.connector)
  if (!connector) return { ok: false, message: `Connector ${input.connector} is not registered` }
  const existing = input.id ? getSource(container.db, input.id) : undefined
  const credentials: Record<string, string> = {}
  if (existing) {
    for (const field of connector.meta.credentialFields) {
      const value = container.secrets.get(`source.${existing.id}.${field.key}`)
      if (value) credentials[field.key] = value
    }
  }
  const synthetic: SourceRecord = existing ?? {
    id: input.id ?? `test-${input.connector}`,
    connector: input.connector,
    label: 'Connection test',
    config: input.config,
    enabled: true,
    countries: [],
    rateLimitPerMinute: 30,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    consecutiveFailures: 0,
    lastItemCount: null,
    verifiedAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  const source = existing ? { ...existing, config: input.config } : synthetic
  const signal = AbortSignal.timeout(25_000)
  const context = {
    source,
    credentials,
    target: {
      countryCode: input.countryCode.toUpperCase(),
      jobTitles: [],
      keywords: [],
      remotePreference: 'any',
      pageLimit: 1
    },
    fetchImpl: fetch,
    signal,
    userAgent: 'BTApplicant/0.1 (+connection test)'
  }
  try {
    if (connector.test) {
      const result = await connector.test(context)
      logEvent(container.db, {
        category: result.ok ? 'source.test_ok' : 'source.test_failed',
        level: result.ok ? 'info' : 'warn',
        message: `Connection test for ${source.label}: ${result.message}`,
        sourceId: existing?.id ?? null,
        actor: 'user'
      })
      return result
    }
    const started = Date.now()
    const jobs = await connector.fetch(context)
    return {
      ok: true,
      message: `Fetched ${plural(jobs.length, 'job')} in ${Date.now() - started} ms`,
      sampleCount: jobs.length,
      sampleTitles: jobs.slice(0, 5).map((job) => job.title),
      latencyMs: Date.now() - started
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export function exportData(container: AppContainer, kind: 'jobs' | 'applications' | 'events' | 'outbox'): Promise<{ saved: boolean; path: string | null }> {
  return (async () => {
    let data: unknown
    if (kind === 'jobs') data = listJobs(container.db, { limit: 500, sort: 'newest' }).items
    if (kind === 'applications') data = listApplications(container.db, { limit: 500 }).items
    if (kind === 'events') data = listEvents(container.db, { limit: 5000 }).items
    if (kind === 'outbox') data = listOutbox(container.db, { limit: 500 })
    const result = await dialog.showSaveDialog({
      title: `Export ${kind}`,
      defaultPath: `bt-applicant-${kind}-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return { saved: false, path: null }
    writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf8')
    return { saved: true, path: result.filePath }
  })()
}

export function openWebApplicationWindow(url: string): void {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only web addresses can be opened in the application window')
  const window = new BrowserWindow({
    width: 1180,
    height: 900,
    title: 'Guided application — complete and submit yourself',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:employer-application'
    }
  })
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//i.test(target)) void shell.openExternal(target)
    return { action: 'deny' }
  })
  void window.loadURL(url)
}
