import type {
  AiProviderId,
  ApplicationChannel,
  ApplicationStatus,
  ConnectorMeta,
  DailyMetricsSnapshot,
  DigestBacklog,
  DigestSummary,
  EligibilityReason,
  EligibilityResult,
  EligibilityVerdict,
  EmploymentType,
  JobStatus,
  LanguageSkill,
  NormalizedJob,
  OutboxStatus,
  RemoteType,
  RouteDecision,
  SalaryExpectation,
  ScoreBreakdown,
  Severity,
  SponsorEvidence,
  SponsorshipSignal,
  TaskStatus,
  TaskType,
  TemplateKind,
  WorkAuthorizationStatus,
  WorkAuthStatement
} from './types'
import type { AppSettings, ChatSettings, SettingsSection } from './settings'
import type { ResumeExtractedData, ResumeExtractionSummary } from './resume'
import type { RoleDefinition } from './roles'

export interface ProfileDTO {
  id: number
  fullName: string
  email: string
  phone: string | null
  city: string | null
  countryCode: string | null
  citizenships: string[]
  residenceCountry: string | null
  linkedin: string | null
  website: string | null
  github: string | null
  summary: string | null
  yearsExperience: number | null
  skills: string[]
  languages: LanguageSkill[]
  salaryExpectation: SalaryExpectation | null
  noticePeriod: string | null
  earliestStart: string | null
  updatedAt: number
}

export interface CompletenessDTO {
  score: number
  missing: string[]
  warnings: string[]
  readyToApply: boolean
}

export interface ResumeDTO {
  id: number
  label: string
  fileName: string
  storedPath: string
  mimeType: string
  sizeBytes: number
  sha256: string
  isDefault: boolean
  notes: string | null
  createdAt: number
}

export interface ResumeExtractionDTO extends ResumeExtractionSummary {
  data: ResumeExtractedData
  textPreview: string
}

export interface ResumeUploadDTO {
  resume: ResumeDTO
  extraction: ResumeExtractionDTO | null
  extractionError: string | null
}

export interface ResumeImportDTO {
  profile: ProfileDTO
  completeness: CompletenessDTO
  imported: string[]
  keptExisting: string[]
}

export interface RoleSelectionDTO {
  roleKey: string
  title: string
  source: 'catalog' | 'custom'
}

export interface RoleCatalogDTO extends RoleDefinition {
  selected: boolean
}

export interface RoleSelectionPageDTO {
  catalog: RoleCatalogDTO[]
  customSelections: RoleSelectionDTO[]
  effectiveTitles: string[]
}

export interface RoleFitComponentDTO {
  key: string
  label: string
  score: number
  max: number
  detail: string
}

export interface RoleRecommendationDTO {
  key: string
  title: string
  family: string
  description: string
  score: number
  confidence: number
  fit: 'strong' | 'good' | 'stretch' | 'low'
  selected: boolean
  components: RoleFitComponentDTO[]
  matchedSkills: string[]
  missingSkills: string[]
  matchedCertifications: string[]
  evidence: string[]
  market: {
    activeJobs: number
    evaluatedJobs: number
    eligibleJobs: number
    countries: string[]
  }
}

export interface RoleRecommendationsDTO {
  generatedAt: number
  resumeId: number | null
  resumeLabel: string | null
  resumeConfidence: number | null
  usedProfileOnly: boolean
  recommendations: RoleRecommendationDTO[]
}

export interface WorkAuthorizationDTO {
  id: number
  countryCode: string
  status: WorkAuthorizationStatus
  permitType: string | null
  validFrom: string | null
  validUntil: string | null
  needsSponsorship: boolean
  evidenceNote: string | null
  createdAt: number
  updatedAt: number
}

export type WorkAuthorizationInputDTO = Omit<WorkAuthorizationDTO, 'id' | 'createdAt' | 'updatedAt'>

export interface CountryAnswerDTO {
  id: number
  questionKey: string
  questionText: string
  countryCode: string | null
  answer: string
  verified: boolean
  createdAt: number
  updatedAt: number
}

export interface TargetCountryDTO {
  id: number
  countryCode: string
  enabled: boolean
  remotePreference: RemoteType | 'any'
  employmentTypes: string[]
  jobTitles: string[]
  keywords: string[]
  excludeKeywords: string[]
  minSalary: number | null
  currency: string | null
  seniority: string[]
  scheduleCron: string
  timezone: string
  sources: string[]
  createdAt: number
  updatedAt: number
  lastRunAt: number | null
}

export type TargetCountryInputDTO = Omit<TargetCountryDTO, 'id' | 'createdAt' | 'updatedAt' | 'lastRunAt'>

export interface SourceDTO {
  id: string
  connector: string
  label: string
  config: Record<string, unknown>
  enabled: boolean
  countries: string[]
  rateLimitPerMinute: number
  lastSuccessAt: number | null
  lastErrorAt: number | null
  lastError: string | null
  consecutiveFailures: number
  lastItemCount: number | null
  verifiedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface SourceInputDTO {
  id: string
  connector: string
  label: string
  config: Record<string, unknown>
  enabled: boolean
  countries: string[]
  rateLimitPerMinute: number
}

export interface SourceFetchDTO {
  id: number
  sourceId: string
  startedAt: number
  finishedAt: number | null
  status: string
  items: number
  newItems: number
  error: string | null
  durationMs: number | null
}

export interface JobDTO {
  id: number
  dedupeKey: string
  fingerprint: string
  sourceId: string
  sourceName: string
  externalId: string
  title: string
  company: string
  companyDomain: string | null
  countryCode: string | null
  locationRaw: string | null
  remoteType: RemoteType
  employmentType: EmploymentType
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  salaryPeriod: string | null
  descriptionHtml: string | null
  descriptionText: string
  requirements: string[]
  postedAt: number | null
  expiresAt: number | null
  firstSeenAt: number
  lastVerifiedAt: number
  url: string
  applyUrl: string | null
  applicationEmail: string | null
  applicationEmailEvidence: string | null
  applicationInstructions: string | null
  sponsorSignal: SponsorshipSignal
  sponsorEvidence: SponsorEvidence | null
  workAuthStatements: WorkAuthStatement[]
  skills: string[]
  seniority: string | null
  status: JobStatus
  createdAt: number
  updatedAt: number
}

export type JobDetailDTO = JobDTO

export interface JobListItemDTO {
  id: number
  title: string
  company: string
  countryCode: string | null
  locationRaw: string | null
  remoteType: RemoteType
  employmentType: EmploymentType
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  salaryPeriod: string | null
  postedAt: number | null
  firstSeenAt: number
  lastVerifiedAt: number
  url: string
  applyUrl: string | null
  sourceId: string
  sourceName: string
  status: JobStatus
  sponsorSignal: SponsorshipSignal
  verdict: EligibilityVerdict | null
  score: number | null
  applicationId: number | null
  applicationStatus: string | null
  applicationChannel: string | null
  hasEmail: boolean
}

export interface JobListFiltersDTO {
  search?: string
  status?: JobStatus | 'all'
  verdict?: EligibilityVerdict | 'all'
  country?: string
  sourceId?: string
  remoteType?: RemoteType | 'all'
  minScore?: number
  onlyActive?: boolean
  needsAttention?: boolean
  limit?: number
  offset?: number
  sort?: 'score' | 'newest' | 'company'
}

export interface JobStatsDTO {
  total: number
  active: number
  eligible: number
  eligibleNeedsSponsorship: number
  ineligible: number
  needsReview: number
  duplicates: number
  closed: number
  discoveredToday: number
}

export interface EvaluationDTO {
  jobId: number
  verdict: EligibilityVerdict
  score: number
  scoreBreakdown: ScoreBreakdown
  reasons: EligibilityReason[]
  ruleIds: string[]
  authorizationBasis: EligibilityResult['authorizationBasis'] | null
  matchedBloc: string | null
  requiresSponsorship: boolean
  profileHash: string | null
  evaluatedAt: number
}

export interface ApplicationDTO {
  id: number
  jobId: number
  channel: ApplicationChannel
  channelReason: string
  decisionEvidence: Record<string, unknown>
  status: ApplicationStatus
  active: boolean
  attempt: number
  resumeId: number | null
  templateId: number | null
  subject: string | null
  body: string | null
  recipient: string | null
  applyUrl: string | null
  lastError: string | null
  confirmation: Record<string, unknown> | null
  approvedAt: number | null
  submittedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface ApplicationListItemDTO {
  id: number
  jobId: number
  jobTitle: string
  company: string
  countryCode: string | null
  channel: ApplicationChannel
  status: ApplicationStatus
  score: number | null
  verdict: EligibilityVerdict | null
  subject: string | null
  recipient: string | null
  applyUrl: string | null
  attempt: number
  createdAt: number
  updatedAt: number
  submittedAt: number | null
  lastError: string | null
}

export interface ApplicationStatsDTO {
  total: number
  awaitingApproval: number
  needsHuman: number
  queued: number
  submitted: number
  emailSubmitted: number
  webSubmitted: number
  failed: number
  uncertain: number
  rejected: number
}

export interface OutboxDTO {
  id: number
  applicationId: number
  adapter: 'mock' | 'smtp'
  status: OutboxStatus
  toAddress: string
  fromAddress: string | null
  subject: string
  bodyText: string
  attachments: { resumeId: number; fileName: string; storedPath: string; sizeBytes: number; mimeType: string; sha256: string }[]
  attempt: number
  idempotencyKey: string
  providerMessageId: string | null
  error: string | null
  queuedAt: number
  sentAt: number | null
  updatedAt: number
  jobTitle?: string | null
  company?: string | null
  applicationStatus?: ApplicationStatus | null
}

export interface ResponseDTO {
  id: number
  applicationId: number
  receivedAt: number
  channel: string
  kind: string
  notes: string | null
  createdAt: number
}

export interface WebRunDTO {
  id: number
  applicationId: number
  url: string
  status: 'prepared' | 'awaiting_human' | 'submitted' | 'failed' | 'cancelled'
  steps: { label: string; status: 'pending' | 'done' | 'blocked' | 'failed'; detail?: string }[]
  prefilled: Record<string, unknown>
  lastError: string | null
  confirmation: Record<string, unknown> | null
  createdAt: number
  updatedAt: number
}

export interface TemplateDTO {
  id: number
  name: string
  kind: TemplateKind
  subject: string
  body: string
  isDefault: boolean
  version: number
  createdAt: number
  updatedAt: number
}

export interface TemplateVersionDTO {
  id: number
  templateId: number
  subject: string
  body: string
  version: number
  note: string | null
  createdAt: number
}

export interface TaskDTO {
  id: number
  type: TaskType
  payload: Record<string, unknown>
  status: TaskStatus
  priority: number
  runAt: number
  attempts: number
  maxAttempts: number
  leaseOwner: string | null
  leaseExpiresAt: number | null
  cancelRequested: boolean
  idempotencyKey: string | null
  lastError: string | null
  result: Record<string, unknown> | null
  createdAt: number
  updatedAt: number
  completedAt: number | null
}

export interface ScheduleDTO {
  id: number
  key: string
  taskType: TaskType
  payload: Record<string, unknown>
  cron: string
  timezone: string
  enabled: boolean
  nextRunAt: number | null
  lastRunAt: number | null
  lastResult: string | null
}

export interface HeartbeatDTO {
  id: string
  startedAt: number
  lastSeenAt: number
  status: string
  currentTaskId: number | null
  appVersion: string | null
}

export interface EventDTO {
  id: number
  ts: number
  level: Severity
  category: string
  jobId: number | null
  applicationId: number | null
  sourceId: string | null
  taskId: number | null
  message: string
  detail: Record<string, unknown> | null
  actor: string
}

export interface QueueStatsDTO {
  pending: number
  running: number
  dead: number
  cancelled: number
  oldestPendingAt: number | null
  nextRunAt: number | null
  doneToday: number
}

export interface MailStatusDTO {
  mode: 'mock' | 'smtp'
  killSwitch: boolean
  smtpConfigured: boolean
  credentialPresent: boolean
  fromAddress: string
  message: string
}

export interface ChatSecretsStatusDTO {
  telegramToken: boolean
  whatsappAccessToken: boolean
  whatsappVerifyToken: boolean
  whatsappAppSecret: boolean
}

export interface ChatProviderStatusDTO {
  provider: 'telegram' | 'whatsapp'
  enabled: boolean
  configured: boolean
  running: boolean
  connected: boolean
  detail: string
  lastActivityAt: number | null
  lastSuccessAt: number | null
  lastError: string | null
  lastErrorAt: number | null
  webhookListening: boolean
  webhookUrl: string | null
}

export interface ChatMessageDTO {
  id: number
  provider: 'telegram' | 'whatsapp' | 'local'
  direction: 'inbound' | 'outbound'
  chatRef: string
  summary: string
  command: string | null
  status: 'received' | 'sent' | 'failed' | 'ignored' | 'rejected'
  error: string | null
  createdAt: number
}

export interface ChatCommandInfoDTO {
  command: string
  description: string
  example: string | null
}

export interface ChatPageDTO {
  settings: ChatSettings
  secrets: ChatSecretsStatusDTO
  providers: ChatProviderStatusDTO[]
  messages: ChatMessageDTO[]
  webhookUrl: string | null
  commands: ChatCommandInfoDTO[]
}

export interface ChatTestResultDTO {
  ok: boolean
  message: string
  latencyMs: number | null
  account: string | null
}

export interface ChatCommandResultDTO {
  ok: boolean
  command: string
  reply: string
  requiresConfirmation: boolean
  messageId: number | null
}

export interface AiProviderStatusDTO {
  id: AiProviderId
  label: string
  model: string
  configured: boolean
  circuitState: 'closed' | 'open' | 'half_open'
  consecutiveFailures: number
  lastSuccessAt: number | null
  lastError: string | null
}

export interface AiTestResultDTO {
  ok: boolean
  provider: AiProviderId | null
  model: string | null
  latencyMs: number
  text: string | null
  error: string | null
  reason: string | null
}

export interface ConnectorDTO extends ConnectorMeta {
  registered: boolean
}

export interface SystemStatusDTO {
  version: string
  platform: string
  userDataDir: string
  dbPath: string
  schemaVersion: number
  workerRunning: boolean
  inFlight: number
  paused: boolean
  mail: MailStatusDTO
  aiMode: AppSettings['ai']['mode']
  timeZone: string
}

export interface SystemCountsDTO {
  jobs: number
  activeJobs: number
  applications: number
  awaitingApproval: number
  needsHuman: number
  queued: number
  submitted: number
  sources: number
  sourcesEnabled: number
  resumes: number
  targets: number
  pendingTasks: number
  deadTasks: number
  eventsToday: number
}

export interface BootstrapDTO {
  system: SystemStatusDTO
  settings: AppSettings
  profile: ProfileDTO
  completeness: CompletenessDTO
  authorizations: WorkAuthorizationDTO[]
  targets: TargetCountryDTO[]
  resumes: ResumeDTO[]
  sources: SourceDTO[]
  counts: SystemCountsDTO
  aiProviders: AiProviderStatusDTO[]
  connectors: ConnectorDTO[]
  onboarded: boolean
}

export interface DashboardDTO {
  system: SystemStatusDTO
  counts: SystemCountsDTO
  digest: DigestSummary
  metrics7: DailyMetricsSnapshot[]
  jobStats: JobStatsDTO
  applicationStats: ApplicationStatsDTO
  queue: QueueStatsDTO
  recentEvents: EventDTO[]
  recentApplications: ApplicationListItemDTO[]
  sources: SourceDTO[]
  aiProviders: AiProviderStatusDTO[]
}

export interface DailyReportDTO {
  date: string
  metrics: DailyMetricsSnapshot
  digest: DigestSummary
  backlog: DigestBacklog
  days: DailyMetricsSnapshot[]
  digests: DigestSummary[]
  queue: QueueStatsDTO
  events: EventDTO[]
}

export interface DiagnosticsDTO {
  system: SystemStatusDTO
  counts: SystemCountsDTO
  queue: QueueStatsDTO
  schemaVersion: number
  dbSizeBytes: number
  databasePath: string
  userDataDir: string
  heartbeats: HeartbeatDTO[]
  recentErrors: EventDTO[]
  sourceHealth: SourceDTO[]
  aiProviders: AiProviderStatusDTO[]
  aiCallsToday: number
  aiFallbacksToday: number
  retention: AppSettings['retention']
  versions: Record<string, string>
}

export interface JobDetailBundleDTO {
  job: JobDetailDTO
  evaluation: EvaluationDTO | null
  application: ApplicationDTO | null
  relatedApplications: ApplicationListItemDTO[]
  events: EventDTO[]
  emailEvidence: { email: string; evidence: string | null } | null
}

export interface ApplicationDetailBundleDTO {
  application: ApplicationDTO
  job: JobDetailDTO
  evaluation: EvaluationDTO | null
  events: EventDTO[]
  outbox: OutboxDTO[]
  responses: ResponseDTO[]
  webRun: WebRunDTO | null
  resume: ResumeDTO | null
}

export interface QueuePageDTO {
  queue: QueueStatsDTO
  tasks: TaskDTO[]
  schedules: ScheduleDTO[]
  heartbeats: HeartbeatDTO[]
}

export interface ApiContract {
  'app.bootstrap': { request: void; response: BootstrapDTO }
  'app.dashboard': { request: void; response: DashboardDTO }
  'app.dailyReport': { request: { date?: string } | undefined; response: DailyReportDTO }
  'app.diagnostics': { request: void; response: DiagnosticsDTO }

  'profile.get': { request: void; response: { profile: ProfileDTO; completeness: CompletenessDTO } }
  'profile.save': { request: Partial<ProfileDTO>; response: { profile: ProfileDTO; completeness: CompletenessDTO } }
  'authorizations.list': { request: void; response: WorkAuthorizationDTO[] }
  'authorizations.replace': { request: WorkAuthorizationInputDTO[]; response: WorkAuthorizationDTO[] }
  'answers.list': { request: void; response: CountryAnswerDTO[] }
  'answers.upsert': {
    request: { id?: number; questionKey: string; questionText: string; countryCode?: string | null; answer: string; verified: boolean }
    response: CountryAnswerDTO[]
  }
  'answers.delete': { request: { id: number }; response: CountryAnswerDTO[] }
  'resumes.list': { request: void; response: ResumeDTO[] }
  'resumes.upload': { request: void; response: ResumeUploadDTO | null }
  'resumes.delete': { request: { id: number }; response: ResumeDTO[] }
  'resumes.default': { request: { id: number }; response: ResumeDTO[] }
  'resumes.reveal': { request: { id: number }; response: void }
  'resumes.extractions': { request: void; response: ResumeExtractionDTO[] }
  'resumes.analyze': { request: { id: number }; response: ResumeExtractionDTO }
  'resumes.import': { request: { id: number }; response: ResumeImportDTO }

  'roles.page': { request: void; response: RoleSelectionPageDTO }
  'roles.save': { request: { selectedKeys: string[]; customTitles: string[] }; response: RoleSelectionPageDTO }
  'roles.recommend': { request: void; response: RoleRecommendationsDTO }

  'targets.list': { request: void; response: TargetCountryDTO[] }
  'targets.save': { request: { id?: number; input: TargetCountryInputDTO }; response: TargetCountryDTO[] }
  'targets.delete': { request: { id: number }; response: TargetCountryDTO[] }
  'targets.toggle': { request: { id: number; enabled: boolean }; response: TargetCountryDTO[] }
  'targets.poll': { request: { id: number }; response: { taskId: number } }

  'sources.list': { request: void; response: SourceDTO[] }
  'sources.save': { request: SourceInputDTO; response: SourceDTO[] }
  'sources.toggle': { request: { id: string; enabled: boolean }; response: SourceDTO[] }
  'sources.delete': { request: { id: string }; response: SourceDTO[] }
  'sources.test': {
    request: { id?: string; connector: string; config: Record<string, unknown>; countryCode: string }
    response: { ok: boolean; message: string; sampleCount?: number; sampleTitles?: string[]; latencyMs?: number }
  }
  'sources.history': { request: { id: string }; response: SourceFetchDTO[] }
  'sources.connectors': { request: void; response: ConnectorDTO[] }

  'jobs.list': { request: JobListFiltersDTO; response: { items: JobListItemDTO[]; total: number } }
  'jobs.get': { request: { id: number }; response: JobDetailBundleDTO }
  'jobs.evaluate': {
    request: { id: number }
    response: { jobId: number; verdict: EligibilityVerdict; score: number; route: RouteDecision; applicationId: number | null; reason: string }
  }
  'jobs.reEvaluateAll': { request: void; response: { evaluated: number; errors: number } }

  'applications.list': {
    request: { search?: string; status?: ApplicationStatus | 'all'; channel?: ApplicationChannel | 'all'; limit?: number; offset?: number }
    response: { items: ApplicationListItemDTO[]; total: number }
  }
  'applications.get': { request: { id: number }; response: ApplicationDetailBundleDTO }
  'applications.approve': { request: { id: number }; response: ApplicationDTO }
  'applications.reject': { request: { id: number; reason?: string | null }; response: ApplicationDTO }
  'applications.retry': { request: { id: number }; response: ApplicationDTO }
  'applications.dispatch': { request: { id: number }; response: { applicationId: number; status: ApplicationStatus; detail: string } }
  'applications.saveDraft': { request: { id: number; subject: string; body: string }; response: ApplicationDTO }
  'applications.response': { request: { id: number; kind: string; notes?: string | null }; response: ResponseDTO[] }
  'applications.confirmWeb': { request: { id: number; note: string }; response: ApplicationDTO }
  'outbox.list': { request: { status?: OutboxStatus | 'all'; limit?: number } | undefined; response: OutboxDTO[] }
  'outbox.reveal': { request: { id: number }; response: void }

  'templates.list': { request: { kind?: TemplateKind } | undefined; response: TemplateDTO[] }
  'templates.save': {
    request: { id?: number; name: string; kind: TemplateKind; subject: string; body: string; isDefault: boolean; note?: string | null }
    response: TemplateDTO[]
  }
  'templates.delete': { request: { id: number }; response: TemplateDTO[] }
  'templates.default': { request: { id: number }; response: TemplateDTO[] }
  'templates.versions': { request: { id: number }; response: TemplateVersionDTO[] }

  'settings.get': { request: void; response: AppSettings }
  'settings.save': { request: { section: SettingsSection; value: unknown }; response: AppSettings }
  'secrets.list': { request: void; response: string[] }
  'secrets.set': { request: { key: string; value: string }; response: string[] }
  'secrets.delete': { request: { key: string }; response: string[] }
  'mail.status': { request: void; response: MailStatusDTO }
  'mail.verify': { request: void; response: { ok: boolean; mode: 'mock' | 'smtp'; message: string } }
  'ai.status': { request: void; response: AiProviderStatusDTO[] }
  'ai.test': { request: void; response: AiTestResultDTO }

  'chat.page': { request: void; response: ChatPageDTO }
  'chat.save': { request: { settings: ChatSettings }; response: ChatPageDTO }
  'chat.test': { request: { provider: 'telegram' | 'whatsapp' }; response: ChatTestResultDTO }
  'chat.sendTest': { request: { provider: 'telegram' | 'whatsapp' }; response: ChatTestResultDTO }
  'chat.command': { request: { text: string }; response: ChatCommandResultDTO }

  'tasks.page': { request: void; response: QueuePageDTO }
  'tasks.retry': { request: { id: number }; response: QueuePageDTO }
  'tasks.cancel': { request: { id: number }; response: QueuePageDTO }
  'tasks.run': { request: { type: TaskType; payload?: Record<string, unknown> }; response: { taskId: number } }
  'tasks.scheduleToggle': { request: { id: number; enabled: boolean }; response: ScheduleDTO[] }

  'events.list': {
    request: { search?: string; level?: Severity | 'all'; category?: string; limit?: number; offset?: number }
    response: { items: EventDTO[]; total: number }
  }
}

export type ApiChannel = keyof ApiContract
export type ApiRequest<K extends ApiChannel> = ApiContract[K]['request']
export type ApiResponse<K extends ApiChannel> = ApiContract[K]['response']

export interface WindowApi {
  invoke<K extends ApiChannel>(channel: K, payload?: ApiRequest<K>): Promise<ApiResponse<K>>
  chooseResumeFile(): Promise<{ canceled: boolean; filePath: string | null }>
  openExternal(url: string): Promise<void>
  openPath(path: string): Promise<void>
  openWebRun(applicationId: number, url: string): Promise<void>
  exportData(kind: 'jobs' | 'applications' | 'events' | 'outbox'): Promise<{ saved: boolean; path: string | null }>
  platform: string
  versions: Record<string, string>
  onDataChanged(callback: () => void): () => void
  onNavigate(callback: (path: string) => void): () => void
}
