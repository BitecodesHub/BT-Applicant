import type { Connector, ConnectorContext, RawJob } from './types'
import { requestJson, RateLimiter } from './http'
import { epochMs, maxPages, titleMatchesTarget } from './helpers'

interface ArbeitnowJob {
  slug?: string
  company_name?: string
  title?: string
  description?: string
  remote?: boolean
  url?: string
  tags?: string[]
  job_types?: string[]
  location?: string
  created_at?: number
}

interface ArbeitnowResponse {
  data?: ArbeitnowJob[]
  links?: { next?: string | null }
}

/** Arbeitnow job board API: https://www.arbeitnow.com/api/job-board-api */
export const arbeitnowConnector: Connector = {
  meta: {
    id: 'arbeitnow',
    label: 'Arbeitnow',
    kind: 'aggregator',
    requiresCredentials: false,
    credentialFields: [],
    countries: 'global',
    canProvideApplicationEmail: false,
    docsUrl: 'https://www.arbeitnow.com/api/job-board-api',
    notes:
      'Free public job board API with strong German and European coverage. Paginated; public attribution appreciated.'
  },

  async fetch(ctx: ConnectorContext): Promise<RawJob[]> {
    const limiter = new RateLimiter(ctx.source.rateLimitPerMinute)
    const jobs: RawJob[] = []
    const pages = maxPages(ctx.target, 2)

    for (let page = 1; page <= pages; page += 1) {
      await limiter.acquire()
      const result = await requestJson<ArbeitnowResponse>(`https://www.arbeitnow.com/api/job-board-api?page=${page}`, {
        userAgent: ctx.userAgent,
        signal: ctx.signal,
        timeoutMs: 25_000
      })
      if (!result.ok || !result.data || !Array.isArray(result.data.data)) {
        if (page === 1) throw new Error(`Arbeitnow failed: ${result.error ?? `HTTP ${result.status}`}`)
        break
      }

      for (const job of result.data.data) {
        if (!job.title || !job.url) continue
        if (!titleMatchesTarget(job.title, ctx.target)) continue
        jobs.push({
          externalId: job.slug ?? job.url,
          title: job.title,
          company: job.company_name ?? 'Unknown company',
          locationRaw: job.location ?? null,
          remoteType: job.remote ? 'remote' : undefined,
          employmentType: job.job_types?.[0] ?? null,
          descriptionHtml: job.description ?? null,
          descriptionText: null,
          postedAt: epochMs(job.created_at),
          url: job.url,
          applyUrl: job.url,
          skills: job.tags ?? [],
          raw: { jobTypes: job.job_types ?? [] }
        })
      }

      if (!result.data.links?.next && (result.data.data?.length ?? 0) < 100) break
    }

    ctx.signal?.throwIfAborted()
    return jobs
  },

  async test(ctx) {
    const started = Date.now()
    const result = await requestJson<ArbeitnowResponse>('https://www.arbeitnow.com/api/job-board-api', {
      userAgent: ctx.userAgent,
      timeoutMs: 15_000,
      retries: 1
    })
    const postings = result.data?.data ?? []
    return {
      ok: result.ok,
      message: result.ok
        ? `Arbeitnow responded with ${postings.length} jobs on page 1.`
        : `Arbeitnow failed: ${result.error ?? `HTTP ${result.status}`}`,
      sampleCount: postings.length,
      sampleTitles: postings.slice(0, 5).map((job) => job.title ?? 'untitled'),
      latencyMs: Date.now() - started
    }
  }
}
