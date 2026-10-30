import { countryName } from '../../shared/countries'
import type { Connector, ConnectorContext, RawJob } from './types'
import { requestJson, RateLimiter } from './http'
import { epochMs, maxPages, titleMatchesTarget } from './helpers'

interface MuseJob {
  id?: number
  short_name?: string
  name?: string
  type?: string
  publication_date?: string
  model_type?: string
  locations?: { name?: string }[]
  categories?: { name?: string }[]
  levels?: { name?: string; short_name?: string }[]
  refs?: { landing_page?: string }
  company?: { id?: number; short_name?: string; name?: string }
  contents?: string
}

interface MuseListResponse {
  page?: number
  page_count?: number
  total?: number
  results?: MuseJob[]
}

/** The Muse public jobs API: https://www.themuse.com/developers/api/v2 */
export const museConnector: Connector = {
  meta: {
    id: 'themuse',
    label: 'The Muse',
    kind: 'aggregator',
    requiresCredentials: false,
    credentialFields: [],
    countries: 'global',
    canProvideApplicationEmail: false,
    docsUrl: 'https://www.themuse.com/developers/api/v2',
    notes:
      'Public jobs API with global listings and company profiles. Listing pages omit full descriptions, so the connector enriches a capped number of relevant postings.'
  },

  async fetch(ctx: ConnectorContext): Promise<RawJob[]> {
    const limiter = new RateLimiter(ctx.source.rateLimitPerMinute)
    const jobs: RawJob[] = []
    const pages = Math.min(maxPages(ctx.target, 2), 5)
    const enrichBudget = Math.max(5, Math.min(30, ctx.target.pageLimit * 10))
    let enriched = 0

    for (let page = 0; page < pages; page += 1) {
      await limiter.acquire()
      const params = new URLSearchParams({ page: String(page), desc: 'true' })
      const location = countryName(ctx.target.countryCode)
      if (location !== ctx.target.countryCode) params.set('location', location)

      const list = await requestJson<MuseListResponse>(`https://www.themuse.com/api/public/jobs?${params.toString()}`, {
        userAgent: ctx.userAgent,
        signal: ctx.signal,
        timeoutMs: 25_000
      })
      if (!list.ok || !list.data || !Array.isArray(list.data.results)) {
        if (page === 0) throw new Error(`The Muse failed: ${list.error ?? `HTTP ${list.status}`}`)
        break
      }

      for (const job of list.data.results) {
        if (!job.name || !job.id) continue
        if (!titleMatchesTarget(job.name, ctx.target)) continue
        const url = job.refs?.landing_page ?? null
        if (!url) continue

        let contents = job.contents ?? null
        if (!contents && enriched < enrichBudget) {
          enriched += 1
          await limiter.acquire()
          const detail = await requestJson<MuseJob>(`https://www.themuse.com/api/public/jobs/${job.id}`, {
            userAgent: ctx.userAgent,
            signal: ctx.signal,
            timeoutMs: 20_000,
            retries: 1
          })
          if (detail.ok && detail.data) {
            contents = detail.data.contents ?? null
            if (!contents && detail.data.locations) job.locations = detail.data.locations
          }
        }

        const locations = (job.locations ?? []).map((entry) => entry.name ?? '').filter(Boolean)
        const categories = (job.categories ?? []).map((entry) => entry.name ?? '').filter(Boolean)
        const level = job.levels?.[0]

        jobs.push({
          externalId: String(job.id),
          title: job.name,
          company: job.company?.name ?? 'Unknown company',
          locationRaw: locations.length > 0 ? locations.join('; ') : null,
          employmentType: job.type ?? null,
          descriptionHtml: contents,
          descriptionText: null,
          postedAt: epochMs(job.publication_date),
          url,
          applyUrl: url,
          skills: categories,
          seniority: level?.name ?? null,
          raw: { shortName: job.short_name ?? null, level: level?.short_name ?? null }
        })
      }

      const pageCount = list.data.page_count ?? 1
      if (page + 1 >= pageCount) break
    }

    ctx.signal?.throwIfAborted()
    return jobs
  },

  async test(ctx) {
    const started = Date.now()
    const result = await requestJson<MuseListResponse>('https://www.themuse.com/api/public/jobs?page=0&desc=true', {
      userAgent: ctx.userAgent,
      timeoutMs: 15_000,
      retries: 1
    })
    const postings = result.data?.results ?? []
    return {
      ok: result.ok,
      message: result.ok
        ? `The Muse responded with ${result.data?.total ?? postings.length} jobs.`
        : `The Muse failed: ${result.error ?? `HTTP ${result.status}`}`,
      sampleCount: postings.length,
      sampleTitles: postings.slice(0, 5).map((job) => job.name ?? 'untitled'),
      latencyMs: Date.now() - started
    }
  }
}
