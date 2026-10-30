import type { ConnectorMeta, NormalizedJob } from '../../shared/types'
import type { SourceRecord } from '../db/repos/sources'

export interface RawJob {
  externalId: string
  title: string
  company: string
  locationRaw?: string | null
  countryCode?: string | null
  remoteType?: NormalizedJob['remoteType']
  employmentType?: string | null
  salaryMin?: number | null
  salaryMax?: number | null
  salaryCurrency?: string | null
  salaryPeriod?: string | null
  descriptionHtml?: string | null
  descriptionText?: string | null
  postedAt?: number | null
  expiresAt?: number | null
  url: string
  applyUrl?: string | null
  applicationEmail?: string | null
  applicationEmailEvidence?: string | null
  applicationInstructions?: string | null
  skills?: string[]
  seniority?: string | null
  companyDomain?: string | null
  raw?: unknown
}

export interface FetchTarget {
  countryCode: string
  jobTitles: string[]
  keywords: string[]
  remotePreference: string
  pageLimit: number
}

export interface ConnectorContext {
  source: SourceRecord
  credentials: Record<string, string>
  target: FetchTarget
  fetchImpl: typeof fetch
  signal?: AbortSignal
  userAgent: string
}

export interface ConnectorTestResult {
  ok: boolean
  message: string
  sampleCount?: number
  sampleTitles?: string[]
  latencyMs?: number
}

export interface Connector {
  meta: ConnectorMeta
  fetch(ctx: ConnectorContext): Promise<RawJob[]>
  test?(ctx: ConnectorContext): Promise<ConnectorTestResult>
}
