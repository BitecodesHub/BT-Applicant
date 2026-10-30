import type { Connector, ConnectorContext, RawJob } from './types'
import { requestJson, RateLimiter } from './http'
import { epochMs, num, remoteBoardsRelevant, str, titleMatchesTarget } from './helpers'

interface JobicyJob {
  id?: number | string
  url?: string
  jobTitle?: string
  companyName?: string
  companyLogo?: string
  jobIndustry?: string[]
  jobType?: string[] | string
  jobGeo?: string
  jobLevel?: string
  jobExcerpt?: string
  jobDescription?: string
  pubDate?: string
  annualSalaryMin?: number | string
  annualSalaryMax?: number | string
  salaryCurrency?: string
}

interface JobicyResponse {
  jobCount?: number
  jobs?: JobicyJob[]
}

/** Geo values Jobicy accepts; other targets use the unfiltered global feed. */
const GEO_BY_COUNTRY: Record<string, string> = {
  US: 'usa',
  CA: 'canada',
  GB: 'uk',
  AU: 'australia',
  DE: 'germany',
  FR: 'france',
  NL: 'netherlands',
  ES: 'spain',
  IT: 'italy',
  BR: 'brazil',
  JP: 'japan',
  SG: 'singapore',
  PL: 'poland',
  PT: 'portugal'
}

/** Jobicy public remote jobs API: https://jobicy.com/jobs-rss-feed (v2 API docs). */
export const jobicyConnector: Connector = {
  meta: {
    id: 'jobicy',
    label: 'Jobicy',
    kind: 'aggregator',
    requiresCredentials: false,
    credentialFields: [],
    countries: 'global',
    canProvideApplicationEmail: false,
    docsUrl: 'https://jobicy.com/api/v2/remote-jobs',
    notes:
      'Free remote job API with optional geographic filtering. Remote-only source, so it is skipped when the country target is on-site only.'
  },

  async fetch(ctx: ConnectorContext): Promise<RawJob[]> {
    if (!remoteBoardsRelevant(ctx.target)) return []

    const limiter = new RateLimiter(ctx.source.rateLimitPerMinute)
    await limiter.acquire()
    const params = new URLSearchParams({ count: '50' })
    const geo = GEO_BY_COUNTRY[ctx.target.countryCode.toUpperCase()]
    if (geo) params.set('geo', geo)

    const result = await requestJson<JobicyResponse>(`https://jobicy.com/api/v2/remote-jobs?${params.toString()}`, {
      userAgent: ctx.userAgent,
      signal: ctx.signal,
      timeoutMs: 25_000
    })
    if (!result.ok || !result.data || !Array.isArray(result.data.jobs)) {
      throw new Error(`Jobicy failed: ${result.error ?? `HTTP ${result.status}`}`)
    }

    const jobs: RawJob[] = []
    for (const job of result.data.jobs) {
      if (!job.jobTitle || !job.url) continue
      if (!titleMatchesTarget(job.jobTitle, ctx.target)) continue
      const jobTypes = Array.isArray(job.jobType) ? job.jobType : job.jobType ? [job.jobType] : []
      jobs.push({
        externalId: str(job.id) ?? job.url,
        title: job.jobTitle,
        company: job.companyName ?? 'Unknown company',
        locationRaw: job.jobGeo ?? null,
        remoteType: 'remote',
        employmentType: jobTypes[0] ?? null,
        salaryMin: num(job.annualSalaryMin),
        salaryMax: num(job.annualSalaryMax),
        salaryCurrency: str(job.salaryCurrency),
        salaryPeriod: 'year',
        descriptionHtml: job.jobDescription ?? null,
        descriptionText: job.jobExcerpt ?? null,
        postedAt: epochMs(job.pubDate),
        url: job.url,
        applyUrl: job.url,
        skills: job.jobIndustry ?? [],
        seniority: job.jobLevel ?? null,
        raw: { jobTypes, geo: job.jobGeo ?? null }
      })
    }
    return jobs
  },

  async test(ctx) {
    const started = Date.now()
    const result = await requestJson<JobicyResponse>('https://jobicy.com/api/v2/remote-jobs?count=5', {
      userAgent: ctx.userAgent,
      timeoutMs: 15_000,
      retries: 1
    })
    const postings = result.data?.jobs ?? []
    return {
      ok: result.ok,
      message: result.ok
        ? `Jobicy responded with ${result.data?.jobCount ?? postings.length} jobs.`
        : `Jobicy failed: ${result.error ?? `HTTP ${result.status}`}`,
      sampleCount: postings.length,
      sampleTitles: postings.slice(0, 5).map((job) => job.jobTitle ?? 'untitled'),
      latencyMs: Date.now() - started
    }
  }
}
