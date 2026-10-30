import { countryByCode } from '../../shared/countries'
import type { Connector, ConnectorContext, RawJob } from './types'
import { requestJson, RateLimiter } from './http'
import { epochMs, maxPages, num, str, titleMatchesTarget } from './helpers'

interface AdzunaResult {
  id?: string
  title?: string
  company?: { display_name?: string }
  location?: { display_name?: string; area?: string[] }
  description?: string
  redirect_url?: string
  created?: string
  salary_min?: number
  salary_max?: number
  contract_time?: string
  contract_type?: string
  category?: { label?: string; tag?: string }
}

interface AdzunaResponse {
  results?: AdzunaResult[]
  count?: number
}

/** Adzuna markets with a public jobs API (https://developer.adzuna.com/). */
const ADZUNA_MARKETS = new Set([
  'gb',
  'us',
  'at',
  'au',
  'be',
  'br',
  'ca',
  'ch',
  'de',
  'es',
  'fr',
  'in',
  'it',
  'mx',
  'nl',
  'nz',
  'pl',
  'sg',
  'za'
])

export const adzunaConnector: Connector = {
  meta: {
    id: 'adzuna',
    label: 'Adzuna',
    kind: 'aggregator',
    requiresCredentials: true,
    credentialFields: [
      { key: 'appId', label: 'App ID', hint: 'From developer.adzuna.com' },
      { key: 'appKey', label: 'App key', hint: 'From developer.adzuna.com' }
    ],
    countries: 'global',
    canProvideApplicationEmail: false,
    docsUrl: 'https://developer.adzuna.com/docs/search',
    notes:
      'Country-specific aggregated listings with salary data. Requires a free Adzuna developer account. Attribution to Adzuna is required by their terms.'
  },

  async fetch(ctx: ConnectorContext): Promise<RawJob[]> {
    const appId = str(ctx.credentials.appId)
    const appKey = str(ctx.credentials.appKey)
    if (!appId || !appKey) throw new Error('Adzuna requires an app ID and app key.')

    const market = ctx.target.countryCode.toLowerCase()
    if (!ADZUNA_MARKETS.has(market)) {
      throw new Error(`Adzuna does not publish a job market for country ${ctx.target.countryCode}.`)
    }

    const limiter = new RateLimiter(ctx.source.rateLimitPerMinute)
    const jobs: RawJob[] = []
    const query = ctx.target.jobTitles.find((title) => title.trim().length > 0) ?? ctx.target.keywords[0] ?? ''
    const pages = maxPages(ctx.target, 3)

    for (let page = 1; page <= pages; page += 1) {
      await limiter.acquire()
      const params = new URLSearchParams({
        'content-type': 'application/json',
        results_per_page: '50',
        max_days_old: '30',
        sort_by: 'date'
      })
      if (query) params.set('what', query)
      params.set('app_id', appId)
      params.set('app_key', appKey)

      const result = await requestJson<AdzunaResponse>(
        `https://api.adzuna.com/v1/api/jobs/${market}/search/${page}?${params.toString()}`,
        { userAgent: ctx.userAgent, signal: ctx.signal, timeoutMs: 25_000 }
      )
      if (!result.ok || !result.data || !Array.isArray(result.data.results)) {
        if (page === 1) throw new Error(`Adzuna failed: ${result.error ?? `HTTP ${result.status}`}`)
        break
      }

      for (const job of result.data.results) {
        if (!job.title || !job.redirect_url) continue
        if (!titleMatchesTarget(job.title, ctx.target)) continue
        const locationParts = [job.location?.display_name, ...(job.location?.area ?? []).slice(-2)].filter(Boolean)
        const employmentType = [job.contract_time, job.contract_type].filter(Boolean).join(' ')

        jobs.push({
          externalId: job.id ?? job.redirect_url,
          title: job.title.replace(/<[^>]+>/g, '').trim(),
          company: job.company?.display_name ?? 'Unknown company',
          locationRaw: locationParts.join(', ') || null,
          countryCode: ctx.target.countryCode,
          employmentType: employmentType.length > 0 ? employmentType : null,
          salaryMin: num(job.salary_min),
          salaryMax: num(job.salary_max),
          salaryCurrency: currencyForMarket(market),
          salaryPeriod: 'year',
          descriptionHtml: null,
          descriptionText: job.description ?? null,
          postedAt: epochMs(job.created),
          url: job.redirect_url,
          applyUrl: job.redirect_url,
          skills: job.category?.label ? [job.category.label] : [],
          raw: { market, category: job.category?.tag ?? null }
        })
      }

      if ((result.data.results?.length ?? 0) < 50) break
    }

    ctx.signal?.throwIfAborted()
    return jobs
  },

  async test(ctx) {
    const appId = str(ctx.credentials.appId)
    const appKey = str(ctx.credentials.appKey)
    if (!appId || !appKey) return { ok: false, message: 'Adzuna credentials are missing.' }
    const country = countryByCode(ctx.target.countryCode)
    const market = ctx.target.countryCode.toLowerCase()
    if (!ADZUNA_MARKETS.has(market)) {
      return { ok: false, message: `Adzuna has no market for ${country?.name ?? ctx.target.countryCode}.` }
    }
    const started = Date.now()
    const params = new URLSearchParams({ 'content-type': 'application/json', results_per_page: '5', app_id: appId, app_key: appKey })
    const result = await requestJson<AdzunaResponse>(`https://api.adzuna.com/v1/api/jobs/${market}/search/1?${params.toString()}`, {
      userAgent: ctx.userAgent,
      timeoutMs: 15_000,
      retries: 1
    })
    const postings = result.data?.results ?? []
    return {
      ok: result.ok,
      message: result.ok
        ? `Adzuna market ${market} responded with ${result.data?.count ?? postings.length} matches.`
        : `Adzuna failed: ${result.error ?? `HTTP ${result.status}`}`,
      sampleCount: postings.length,
      sampleTitles: postings.slice(0, 5).map((job) => job.title ?? 'untitled'),
      latencyMs: Date.now() - started
    }
  }
}

function currencyForMarket(market: string): string | null {
  const map: Record<string, string> = {
    gb: 'GBP',
    us: 'USD',
    at: 'EUR',
    au: 'AUD',
    be: 'EUR',
    br: 'BRL',
    ca: 'CAD',
    ch: 'CHF',
    de: 'EUR',
    es: 'EUR',
    fr: 'EUR',
    in: 'INR',
    it: 'EUR',
    mx: 'MXN',
    nl: 'EUR',
    nz: 'NZD',
    pl: 'PLN',
    sg: 'SGD',
    za: 'ZAR'
  }
  return map[market] ?? null
}
