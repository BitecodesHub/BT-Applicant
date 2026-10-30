import type { Connector, ConnectorContext, RawJob } from './types'
import { requestJson, RateLimiter } from './http'
import { boardEntries, epochMs, isRecord, num, str } from './helpers'

interface AshbyJob {
  id?: string
  title?: string
  location?: string
  secondaryLocations?: { location?: string }[]
  department?: string
  team?: string
  isListed?: boolean
  isRemote?: boolean
  workplaceType?: string
  employmentType?: string
  descriptionHtml?: string
  descriptionPlain?: string
  publishedAt?: string
  jobUrl?: string
  applyUrl?: string
  compensation?: {
    compensationTierSummary?: string
    scrapeableCompensationSalarySummary?: string
    compensationTiers?: {
      components?: { summary?: string; compensationType?: string; interval?: string; minValue?: number; maxValue?: number; currencyCode?: string }[]
    }[]
  }
}

interface AshbyResponse {
  jobs?: AshbyJob[]
}

/** Ashby public job board API: https://developers.ashbyhq.com/docs/public-job-posting-api */
export const ashbyConnector: Connector = {
  meta: {
    id: 'ashby',
    label: 'Ashby job boards',
    kind: 'ats',
    requiresCredentials: false,
    credentialFields: [],
    countries: 'global',
    canProvideApplicationEmail: false,
    docsUrl: 'https://developers.ashbyhq.com/docs/public-job-posting-api',
    notes: 'Public posting API for employers on Ashby. Configure the organization slug from jobs.ashbyhq.com/<org>.'
  },

  async fetch(ctx: ConnectorContext): Promise<RawJob[]> {
    const boards = boardEntries(ctx.source.config)
    if (boards.length === 0) throw new Error('No Ashby organizations configured.')

    const limiter = new RateLimiter(ctx.source.rateLimitPerMinute)
    const jobs: RawJob[] = []
    const errors: string[] = []

    for (const board of boards) {
      await limiter.acquire()
      const result = await requestJson<AshbyResponse>(
        `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board.token)}?includeCompensation=true`,
        { userAgent: ctx.userAgent, signal: ctx.signal, timeoutMs: 25_000 }
      )
      if (!result.ok || !result.data || !Array.isArray(result.data.jobs)) {
        errors.push(`${board.token}: ${result.error ?? `HTTP ${result.status}`}`)
        continue
      }

      for (const job of result.data.jobs) {
        if (job.isListed === false || !job.title) continue
        const url = job.jobUrl ?? job.applyUrl
        if (!url) continue
        const locations = [job.location ?? '', ...(job.secondaryLocations ?? []).map((entry) => entry.location ?? '')].filter(
          Boolean
        )
        const salary = ashbySalary(job)

        jobs.push({
          externalId: job.id ?? url,
          title: job.title,
          company: board.label ?? board.token,
          locationRaw: locations.length > 0 ? locations.join('; ') : null,
          remoteType: ashbyWorkplace(job),
          employmentType: job.employmentType ?? null,
          salaryMin: salary.min,
          salaryMax: salary.max,
          salaryCurrency: salary.currency,
          salaryPeriod: salary.period,
          descriptionHtml: job.descriptionHtml ?? null,
          descriptionText: job.descriptionPlain ?? null,
          postedAt: epochMs(job.publishedAt),
          url,
          applyUrl: job.applyUrl ?? url,
          companyDomain: board.domain,
          raw: { organization: board.token, department: job.department ?? null, team: job.team ?? null }
        })
      }
    }

    if (jobs.length === 0 && errors.length > 0) {
      throw new Error(`Ashby organizations failed: ${errors.join('; ')}`)
    }
    ctx.signal?.throwIfAborted()
    return jobs
  },

  async test(ctx) {
    const boards = boardEntries(ctx.source.config)
    if (boards.length === 0) return { ok: false, message: 'No Ashby organizations configured.' }
    const board = boards[0]!
    const started = Date.now()
    const result = await requestJson<AshbyResponse>(
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board.token)}`,
      { userAgent: ctx.userAgent, timeoutMs: 15_000, retries: 1 }
    )
    const postings = result.data?.jobs ?? []
    return {
      ok: result.ok,
      message: result.ok
        ? `Ashby organization "${board.token}" responded with ${postings.length} postings.`
        : `Ashby organization "${board.token}" failed: ${result.error ?? `HTTP ${result.status}`}`,
      sampleCount: postings.length,
      sampleTitles: postings.slice(0, 5).map((job) => job.title ?? 'untitled'),
      latencyMs: Date.now() - started
    }
  }
}

function ashbyWorkplace(job: AshbyJob): RawJob['remoteType'] {
  const value = `${job.workplaceType ?? ''} ${job.location ?? ''}`.toLowerCase()
  if (job.isRemote === true || value.includes('remote')) return 'remote'
  if (value.includes('hybrid')) return 'hybrid'
  if (value.includes('on-site') || value.includes('onsite')) return 'onsite'
  return undefined
}

function ashbySalary(job: AshbyJob): { min: number | null; max: number | null; currency: string | null; period: string | null } {
  const tiers = job.compensation?.compensationTiers ?? []
  for (const tier of tiers) {
    for (const component of tier.components ?? []) {
      if (!isRecord(component)) continue
      const min = num(component.minValue)
      const max = num(component.maxValue)
      if (min === null && max === null) continue
      return {
        min,
        max,
        currency: str(component.currencyCode),
        period: str(component.interval)?.toLowerCase() ?? null
      }
    }
  }
  const summary = job.compensation?.scrapeableCompensationSalarySummary ?? job.compensation?.compensationTierSummary ?? ''
  const numbers = summary.match(/\d[\d,.]+/g)?.map((token) => Number(token.replace(/,/g, ''))) ?? []
  if (numbers.length === 0) return { min: null, max: null, currency: null, period: null }
  const currencyMatch = summary.match(/\b(USD|EUR|GBP|CAD|AUD|CHF|SEK|NOK|DKK|PLN|INR|SGD)\b/i)
  return {
    min: numbers[0] ?? null,
    max: numbers[1] ?? numbers[0] ?? null,
    currency: currencyMatch ? currencyMatch[1]!.toUpperCase() : null,
    period: /hour/i.test(summary) ? 'hour' : /month/i.test(summary) ? 'month' : 'year'
  }
}
