import type { Connector, ConnectorContext, RawJob } from './types'
import { requestJson, RateLimiter } from './http'
import { epochMs, isRecord, maxPages, num, remoteBoardsRelevant, str, titleMatchesTarget } from './helpers'

interface HimalayasJob {
  title?: string
  companyName?: string
  companyLogo?: string
  description?: string
  excerpt?: string
  applicationLink?: string
  guid?: string
  pubDate?: number | string
  expiryDate?: number | string
  locationRestrictions?: string[]
  timezones?: string[]
  seniority?: string[] | string
  categories?: string[] | string
  employmentType?: string
  minSalary?: number | string
  maxSalary?: number | string
  salaryCurrency?: string
  salaryPeriod?: string
}

interface HimalayasResponse {
  jobs?: HimalayasJob[]
  totalCount?: number
}

/** Himalayas public jobs API: https://himalayas.app/jobs/api */
export const himalayasConnector: Connector = {
  meta: {
    id: 'himalayas',
    label: 'Himalayas',
    kind: 'aggregator',
    requiresCredentials: false,
    credentialFields: [],
    countries: 'global',
    canProvideApplicationEmail: false,
    docsUrl: 'https://himalayas.app/jobs/api',
    notes: 'Public remote job feed. Remote-only source; skipped when the target is on-site only.'
  },

  async fetch(ctx: ConnectorContext): Promise<RawJob[]> {
    if (!remoteBoardsRelevant(ctx.target)) return []

    const limiter = new RateLimiter(ctx.source.rateLimitPerMinute)
    const jobs: RawJob[] = []
    const pages = maxPages(ctx.target, 2)

    for (let page = 0; page < pages; page += 1) {
      await limiter.acquire()
      const offset = page * 100
      const result = await requestJson<HimalayasResponse>(`https://himalayas.app/jobs/api?limit=100&offset=${offset}`, {
        userAgent: ctx.userAgent,
        signal: ctx.signal,
        timeoutMs: 25_000
      })
      if (!result.ok || !result.data || !Array.isArray(result.data.jobs)) {
        if (page === 0) throw new Error(`Himalayas failed: ${result.error ?? `HTTP ${result.status}`}`)
        break
      }

      for (const job of result.data.jobs) {
        if (!job.title) continue
        if (!titleMatchesTarget(job.title, ctx.target)) continue
        const url = job.applicationLink ?? job.guid ?? null
        if (!url) continue
        const restrictions = Array.isArray(job.locationRestrictions) ? job.locationRestrictions.filter(Boolean) : []
        const categories = Array.isArray(job.categories) ? job.categories : job.categories ? [job.categories] : []
        const seniority = Array.isArray(job.seniority) ? job.seniority : job.seniority ? [job.seniority] : []

        jobs.push({
          externalId: job.guid ?? url,
          title: job.title,
          company: job.companyName ?? 'Unknown company',
          locationRaw: restrictions.length > 0 ? restrictions.join(', ') : 'Remote',
          remoteType: 'remote',
          employmentType: job.employmentType ?? null,
          salaryMin: num(job.minSalary),
          salaryMax: num(job.maxSalary),
          salaryCurrency: str(job.salaryCurrency),
          salaryPeriod: str(job.salaryPeriod)?.toLowerCase() ?? 'year',
          descriptionHtml: job.description ?? null,
          descriptionText: job.excerpt ?? null,
          postedAt: epochMs(job.pubDate),
          expiresAt: epochMs(job.expiryDate),
          url,
          applyUrl: url,
          skills: categories,
          seniority: seniority[0] ?? null,
          raw: { restrictions, timezones: job.timezones ?? [] }
        })
      }

      if ((result.data.jobs?.length ?? 0) < 100) break
    }

    ctx.signal?.throwIfAborted()
    return jobs
  },

  async test(ctx) {
    const started = Date.now()
    const result = await requestJson<HimalayasResponse>('https://himalayas.app/jobs/api?limit=5&offset=0', {
      userAgent: ctx.userAgent,
      timeoutMs: 15_000,
      retries: 1
    })
    const postings = result.data?.jobs ?? []
    return {
      ok: result.ok,
      message: result.ok
        ? `Himalayas responded with ${result.data?.totalCount ?? postings.length} jobs.`
        : `Himalayas failed: ${result.error ?? `HTTP ${result.status}`}`,
      sampleCount: postings.length,
      sampleTitles: postings.slice(0, 5).map((job) => (isRecord(job) ? str(job.title) ?? 'untitled' : 'untitled')),
      latencyMs: Date.now() - started
    }
  }
}
