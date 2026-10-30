import type { Connector, ConnectorContext, RawJob } from './types'
import { requestJson, RateLimiter } from './http'
import { boardEntries, epochMs, isRecord, str, truncate } from './helpers'

interface WorkableJob {
  id?: string
  shortcode?: string
  code?: string
  title?: string
  description?: string
  requirements?: string
  benefits?: string
  employment_type?: string
  department?: string
  industry?: string
  url?: string
  application_url?: string
  published_on?: string
  created_at?: string
  location?: {
    location_str?: string
    country?: string
    country_code?: string
    city?: string
    region?: string
    workplace?: string
  }
}

interface WorkableResponse {
  name?: string
  jobs?: WorkableJob[]
}

/** Workable public widget API for hosted job boards. */
export const workableConnector: Connector = {
  meta: {
    id: 'workable',
    label: 'Workable job boards',
    kind: 'ats',
    requiresCredentials: false,
    credentialFields: [],
    countries: 'global',
    canProvideApplicationEmail: false,
    docsUrl: 'https://workable.readme.io/reference/job-board-widget',
    notes:
      'Public widget feed for employers on Workable. Configure account subdomains from apply.workable.com/<account>. The widget feed is read-only and intended for embedded job boards.'
  },

  async fetch(ctx: ConnectorContext): Promise<RawJob[]> {
    const accounts = boardEntries(ctx.source.config)
    if (accounts.length === 0) throw new Error('No Workable accounts configured.')

    const limiter = new RateLimiter(ctx.source.rateLimitPerMinute)
    const jobs: RawJob[] = []
    const errors: string[] = []

    for (const account of accounts) {
      await limiter.acquire()
      const result = await requestJson<WorkableResponse>(
        `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(account.token)}?details=true`,
        { userAgent: ctx.userAgent, signal: ctx.signal, timeoutMs: 25_000 }
      )
      if (!result.ok || !result.data || !Array.isArray(result.data.jobs)) {
        errors.push(`${account.token}: ${result.error ?? `HTTP ${result.status}`}`)
        continue
      }

      for (const job of result.data.jobs) {
        if (!job.title) continue
        const shortcode = job.shortcode ?? job.code ?? (job.id !== undefined ? String(job.id) : null)
        const url =
          job.url ??
          (shortcode ? `https://apply.workable.com/${encodeURIComponent(account.token)}/j/${encodeURIComponent(shortcode)}/` : null)
        if (!url) continue

        const descriptionHtml = [job.description ?? '', job.requirements ?? '', job.benefits ?? ''].join('\n')
        const location = job.location

        jobs.push({
          externalId: str(job.id) ?? shortcode ?? url,
          title: job.title,
          company: account.label ?? result.data.name ?? account.token,
          locationRaw: location?.location_str ?? null,
          countryCode: normalizeCountryCode(location?.country_code),
          remoteType: workableWorkplace(location?.workplace),
          employmentType: job.employment_type ?? null,
          descriptionHtml: descriptionHtml.trim().length > 0 ? descriptionHtml : null,
          descriptionText: null,
          postedAt: epochMs(job.published_on ?? job.created_at),
          url,
          applyUrl: job.application_url ?? url,
          companyDomain: account.domain,
          raw: { account: account.token, department: job.department ?? null, industry: job.industry ?? null }
        })
      }
    }

    if (jobs.length === 0 && errors.length > 0) {
      throw new Error(`Workable accounts failed: ${errors.join('; ')}`)
    }
    ctx.signal?.throwIfAborted()
    return jobs
  },

  async test(ctx) {
    const accounts = boardEntries(ctx.source.config)
    if (accounts.length === 0) return { ok: false, message: 'No Workable accounts configured.' }
    const account = accounts[0]!
    const started = Date.now()
    const result = await requestJson<WorkableResponse>(
      `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(account.token)}?details=false`,
      { userAgent: ctx.userAgent, timeoutMs: 15_000, retries: 1 }
    )
    const postings = result.data?.jobs ?? []
    return {
      ok: result.ok,
      message: result.ok
        ? `Workable account "${account.token}" responded with ${postings.length} postings.`
        : `Workable account "${account.token}" failed: ${result.error ?? `HTTP ${result.status}`}`,
      sampleCount: postings.length,
      sampleTitles: postings.slice(0, 5).map((job) => job.title ?? 'untitled'),
      latencyMs: Date.now() - started
    }
  }
}

function workableWorkplace(value: string | undefined): RawJob['remoteType'] {
  if (!value) return undefined
  const normalized = value.toLowerCase()
  if (normalized.includes('remote')) return 'remote'
  if (normalized.includes('hybrid')) return 'hybrid'
  if (normalized.includes('office') || normalized.includes('on-site') || normalized.includes('onsite')) return 'onsite'
  return undefined
}

function normalizeCountryCode(value: string | undefined): string | null {
  if (!value || value.length > 2) return null
  return value.toUpperCase()
}

export function workableDescription(text: string | null): string | null {
  return text ? truncate(text, 20_000) : null
}

export function isWorkableJob(value: unknown): value is WorkableJob {
  return isRecord(value) && typeof value.title === 'string'
}
