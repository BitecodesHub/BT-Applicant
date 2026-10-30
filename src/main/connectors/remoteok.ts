import type { Connector, ConnectorContext, RawJob } from './types'
import { requestJson, RateLimiter } from './http'
import { asArray, epochMs, isRecord, num, remoteBoardsRelevant, str, titleMatchesTarget } from './helpers'

interface RemoteOkJob {
  legal?: string
  id?: string | number
  slug?: string
  epoch?: number
  date?: string
  company?: string
  position?: string
  tags?: string[]
  description?: string
  location?: string
  salary_min?: number
  salary_max?: number
  url?: string
  apply_url?: string
}

/**
 * Remote OK public API: https://remoteok.com/api
 * The first element of the array is a legal notice, not a job.
 */
export const remoteOkConnector: Connector = {
  meta: {
    id: 'remoteok',
    label: 'Remote OK',
    kind: 'aggregator',
    requiresCredentials: false,
    credentialFields: [],
    countries: 'global',
    canProvideApplicationEmail: false,
    docsUrl: 'https://remoteok.com/api',
    notes:
      'Public remote jobs feed. Remote-only source; skipped when the target is on-site only. The API asks consumers to link back to the original posting.'
  },

  async fetch(ctx: ConnectorContext): Promise<RawJob[]> {
    if (!remoteBoardsRelevant(ctx.target)) return []

    const limiter = new RateLimiter(ctx.source.rateLimitPerMinute)
    await limiter.acquire()
    const result = await requestJson<RemoteOkJob[]>('https://remoteok.com/api', {
      userAgent: ctx.userAgent,
      signal: ctx.signal,
      timeoutMs: 25_000
    })
    if (!result.ok || !Array.isArray(result.data)) {
      throw new Error(`Remote OK failed: ${result.error ?? `HTTP ${result.status}`}`)
    }

    const jobs: RawJob[] = []
    for (const job of result.data) {
      if (!isRecord(job) || job.legal) continue
      const title = str(job.position) ?? str(job.title)
      const url = str(job.url)
      if (!title || !url) continue
      if (!titleMatchesTarget(title, ctx.target)) continue
      const company = str(job.company) ?? 'Unknown company'
      jobs.push({
        externalId: str(job.id) ?? str(job.slug) ?? url,
        title,
        company,
        locationRaw: str(job.location) ?? 'Remote',
        remoteType: 'remote',
        salaryMin: num(job.salary_min),
        salaryMax: num(job.salary_max),
        salaryCurrency: 'USD',
        salaryPeriod: 'year',
        descriptionHtml: str(job.description),
        descriptionText: null,
        postedAt: epochMs(job.epoch ?? job.date),
        url,
        applyUrl: str(job.apply_url) ?? url,
        skills: asArray<string>(job.tags),
        raw: { slug: job.slug ?? null }
      })
    }
    return jobs
  },

  async test(ctx) {
    const started = Date.now()
    const result = await requestJson<RemoteOkJob[]>('https://remoteok.com/api', {
      userAgent: ctx.userAgent,
      timeoutMs: 15_000,
      retries: 1
    })
    const postings = Array.isArray(result.data) ? result.data.filter((job) => isRecord(job) && !job.legal) : []
    return {
      ok: result.ok,
      message: result.ok
        ? `Remote OK responded with ${postings.length} jobs.`
        : `Remote OK failed: ${result.error ?? `HTTP ${result.status}`}`,
      sampleCount: postings.length,
      sampleTitles: postings.slice(0, 5).map((job) => str(job.position) ?? 'untitled'),
      latencyMs: Date.now() - started
    }
  }
}
