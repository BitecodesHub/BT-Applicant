import type { Connector, ConnectorContext, RawJob } from './types'
import { requestJson, RateLimiter } from './http'
import { epochMs, maxPages, remoteBoardsRelevant, str, titleMatchesTarget } from './helpers'

interface RemotiveJob {
  id?: number
  url?: string
  title?: string
  company_name?: string
  company_logo?: string
  category?: string
  tags?: string[]
  job_type?: string
  publication_date?: string
  candidate_required_location?: string
  salary?: string
  description?: string
}

interface RemotiveResponse {
  'job-count'?: number
  jobs?: RemotiveJob[]
}

/**
 * Remotive public API: https://remotive.com/api/remote-jobs
 * Remote-only listings, free for job seekers with attribution requested.
 */
export const remotiveConnector: Connector = {
  meta: {
    id: 'remotive',
    label: 'Remotive',
    kind: 'aggregator',
    requiresCredentials: false,
    credentialFields: [],
    countries: 'global',
    canProvideApplicationEmail: false,
    docsUrl: 'https://remotive.com/api/remote-jobs',
    notes:
      'Curated remote jobs. Remote-only source; skipped automatically when the target country prefers on-site work. Attribution to Remotive is required when displaying results externally.'
  },

  async fetch(ctx: ConnectorContext): Promise<RawJob[]> {
    if (!remoteBoardsRelevant(ctx.target)) return []

    const limiter = new RateLimiter(ctx.source.rateLimitPerMinute)
    const jobs: RawJob[] = []
    const query = ctx.target.jobTitles.find((title) => title.trim().length > 0) ?? ctx.target.keywords[0] ?? ''
    const pages = maxPages(ctx.target, 2)

    for (let page = 0; page < pages; page += 1) {
      await limiter.acquire()
      const params = new URLSearchParams({ limit: '100' })
      if (query) params.set('search', query)
      const result = await requestJson<RemotiveResponse>(`https://remotive.com/api/remote-jobs?${params.toString()}`, {
        userAgent: ctx.userAgent,
        signal: ctx.signal,
        timeoutMs: 25_000
      })
      if (!result.ok || !result.data || !Array.isArray(result.data.jobs)) {
        if (page === 0) throw new Error(`Remotive failed: ${result.error ?? `HTTP ${result.status}`}`)
        break
      }

      for (const job of result.data.jobs) {
        if (!job.title || !job.url) continue
        if (!titleMatchesTarget(job.title, ctx.target)) continue
        jobs.push({
          externalId: str(job.id) ?? job.url,
          title: job.title,
          company: job.company_name ?? 'Unknown company',
          locationRaw: job.candidate_required_location ?? null,
          remoteType: 'remote',
          employmentType: job.job_type ?? null,
          descriptionHtml: job.description ?? null,
          descriptionText: null,
          postedAt: epochMs(job.publication_date),
          url: job.url,
          applyUrl: job.url,
          skills: job.tags ?? [],
          salaryMin: null,
          salaryMax: null,
          salaryCurrency: null,
          salaryPeriod: null,
          raw: { category: job.category ?? null, salary: job.salary ?? null }
        })
      }

      if ((result.data.jobs?.length ?? 0) < 100) break
    }

    ctx.signal?.throwIfAborted()
    return jobs
  },

  async test(ctx) {
    const started = Date.now()
    const result = await requestJson<RemotiveResponse>('https://remotive.com/api/remote-jobs?limit=5', {
      userAgent: ctx.userAgent,
      timeoutMs: 15_000,
      retries: 1
    })
    const postings = result.data?.jobs ?? []
    return {
      ok: result.ok,
      message: result.ok
        ? `Remotive responded with ${result.data?.['job-count'] ?? postings.length} jobs.`
        : `Remotive failed: ${result.error ?? `HTTP ${result.status}`}`,
      sampleCount: postings.length,
      sampleTitles: postings.slice(0, 5).map((job) => job.title ?? 'untitled'),
      latencyMs: Date.now() - started
    }
  }
}
