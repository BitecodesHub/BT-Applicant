export type IsoCountryCode = string

export type WorkAuthorizationStatus =
  | 'citizen'
  | 'permanent_resident'
  | 'work_permit'
  | 'student_permit'
  | 'dependent_permit'
  | 'none'

export type SponsorshipSignal =
  | 'sponsorship_offered'
  | 'sponsorship_not_offered'
  | 'existing_right_to_work_required'
  | 'citizenship_or_clearance_required'
  | 'unstated'

export type EligibilityVerdict =
  | 'eligible'
  | 'eligible_needs_sponsorship_offered'
  | 'ineligible'
  | 'needs_review'

export type ApplicationChannel = 'email' | 'web' | 'manual'

export type ApplicationStatus =
  | 'draft'
  | 'awaiting_approval'
  | 'approved'
  | 'queued'
  | 'sending'
  | 'submitted'
  | 'failed'
  | 'uncertain'
  | 'needs_human'
  | 'rejected'
  | 'withdrawn'

export type OutboxStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'uncertain' | 'cancelled'

export type RemoteType = 'remote' | 'hybrid' | 'onsite' | 'unknown'

export type EmploymentType =
  | 'full_time'
  | 'part_time'
  | 'contract'
  | 'internship'
  | 'temporary'
  | 'unknown'

export type JobStatus = 'active' | 'expired' | 'closed' | 'duplicate' | 'removed'

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'dead' | 'cancelled'

export type TaskType =
  | 'source.poll'
  | 'job.evaluate'
  | 'application.draft'
  | 'application.dispatch'
  | 'application.reconcile'
  | 'web.submit'
  | 'metrics.rollup'
  | 'digest.generate'
  | 'maintenance.retention'
  | 'maintenance.reaper'

export type Severity = 'info' | 'warn' | 'error'

export type AiMode = 'enhanced' | 'off' | 'simulated_outage'

export type AiProviderId = 'ollama' | 'anthropic' | 'openai' | 'gemini' | 'openai_compatible'

export type CircuitState = 'closed' | 'open' | 'half_open'

export type OutboundMode = 'mock' | 'smtp'

export type ResponseKind = 'acknowledgement' | 'interview' | 'rejection' | 'offer' | 'other'

export type TemplateKind = 'application_email' | 'cover_letter' | 'follow_up'

export interface SalaryExpectation {
  min: number
  max?: number
  currency: string
  period: 'year' | 'month' | 'hour'
}

export interface LanguageSkill {
  language: string
  level: string
}

export interface SponsorEvidence {
  signal: SponsorshipSignal
  quote: string | null
  offset: number | null
  ruleId: string | null
  source: 'deterministic' | 'ai'
  model?: string
  confidence?: number
}

export interface WorkAuthStatement {
  quote: string
  offset: number
  ruleId: string
}

export interface ScoreBreakdown {
  titleMatch: number
  skillMatch: number
  locationFit: number
  salaryFit: number
  freshness: number
  sourceQuality: number
  penalties: number
  total: number
  notes: string[]
}

export interface EligibilityReason {
  code: string
  message: string
  ruleId?: string
  evidence?: string
}

export interface EligibilityResult {
  verdict: EligibilityVerdict
  reasons: EligibilityReason[]
  ruleIds: string[]
  authorizationBasis:
    | 'citizenship'
    | 'permanent_residence'
    | 'permit'
    | 'visa_free_bloc'
    | 'bilateral_route'
    | 'sponsorship_required'
    | 'none'
  matchedBloc: string | null
  requiresSponsorship: boolean
  sponsorSignal: SponsorshipSignal
}

export interface RouteDecision {
  channel: ApplicationChannel
  reason: string
  evidence: Record<string, unknown>
  recipient?: string
  applyUrl?: string
}

export interface DailyMetricsSnapshot {
  date: string
  jobsDiscovered: number
  jobsEligible: number
  jobsIneligible: number
  applicationsDrafted: number
  awaitingApproval: number
  submitted: number
  emailSubmitted: number
  webSubmitted: number
  failed: number
  uncertain: number
  needsHuman: number
  responses: number
  emailsSent: number
  emailsFailed: number
  sourcesFailed: number
  aiFallbacks: number
}

export interface DigestBacklog {
  awaitingApproval: number
  needsHuman: number
  queued: number
  uncertain: number
  failed: number
}

export interface DigestSummary {
  date: string
  headline: string
  metrics: DailyMetricsSnapshot
  backlog: DigestBacklog
  attention: string[]
  highlights: string[]
}

export interface ConnectorMeta {
  id: string
  label: string
  kind: 'ats' | 'aggregator' | 'government' | 'generic'
  requiresCredentials: boolean
  credentialFields: { key: string; label: string; hint?: string }[]
  countries: string[] | 'global'
  canProvideApplicationEmail: boolean
  docsUrl: string
  notes: string
}

export interface NormalizedJob {
  externalId: string
  sourceId: string
  sourceName: string
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
  url: string
  applyUrl: string | null
  applicationEmail: string | null
  applicationEmailEvidence: string | null
  applicationInstructions: string | null
  skills: string[]
  seniority: string | null
  raw: unknown
}
