import type { RawJob } from './types'
import type { Connector, ConnectorContext } from './types'
import { requestJson, RateLimiter } from './http'
import { boardEntries, decodeHtmlEntities, epochMs, isRecord, str, truncate } from './helpers'

interface GreenhouseJob {
  id?: number | string
  title?: string
  updated_at?: string
  absolute_url?: string
  company_name?: string
  content?: string
  location?: { name?: string }
  metadata?: { name?: string; value?: string | null }[]
  departments?: { name?: string }[]
  offices?: { name?: string }[]
}

interface GreenhouseResponse {
  jobs?: GreenhouseJob[]
}

/**
 * Greenhouse job board API. Public, documented at
 * https://developers.greenhouse.io/job-board.html and intended for job boards
 * that surface an employer's own listings. No scraping is involved.
 */
export const greenhouseConnector: Connector = {
  meta: {
    id: 'greenhouse',
    label: 'Greenhouse job boards',
    kind: 'ats',
    requiresCredentials: false,
    credentialFields: [],
    countries: 'global',
    canProvideApplicationEmail: false,
    docsUrl: 'https://developers.greenhouse.io/job-board.html',
    notes:
      'Public board API for employers hosted on Greenhouse. Configure one or more board tokens (the slug in boards.greenhouse.io/<token>).'
  },

  async fetch(ctx: ConnectorContext): Promise<RawJob[]> {
    const boards = boardEntries(ctx.source.config)
    if (boards.length === 0) {
      throw new Error('No greenhouse boards configured. Add board tokens or company slugs.')
    }

    const limiter = new RateLimiter(ctx.source.rateLimitPerMinute)
    const jobs: RawJob[] = []
    const errors: string[] = []

    for (const board of boards) {
      await limiter.acquire()
      const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.token)}/jobs?content=true`
      const result = await requestJson<GreenhouseResponse>(url, {
        userAgent: ctx.userAgent,
        signal: ctx.signal,
        timeoutMs: 25_000
      })

      if (!result.ok || !result.data) {
        errors.push(`${board.token}: ${result.error ?? `HTTP ${result.status}`}`)
        continue
      }

      for (const job of result.data.jobs ?? []) {
        if (!job.title || !job.absolute_url) continue
        const externalId = job.id !== undefined ? String(job.id) : job.absolute_url
        const content = typeof job.content === 'string' ? decodeHtmlEntities(job.content) : null
        const salary = greenhouseSalary(job.metadata)
        jobs.push({
          externalId,
          title: job.title,
          company: board.label ?? job.company_name ?? board.token,
          locationRaw: job.location?.name ?? null,
          descriptionHtml: content,
          descriptionText: null,
          url: job.absolute_url,
          applyUrl: job.absolute_url,
          postedAt: epochMs(job.updated_at),
          salaryMin: salary.min,
          salaryMax: salary.max,
          salaryCurrency: salary.currency,
          salaryPeriod: salary.period,
          companyDomain: board.domain,
          raw: { board: board.token, metadata: job.metadata, departments: job.departments, offices: job.offices }
        })
      }
    }

    if (jobs.length === 0 && errors.length > 0) {
      throw new Error(`Greenhouse boards failed: ${errors.join('; ')}`)
    }
    ctx.signal?.throwIfAborted()
    return jobs
  },

  async test(ctx) {
    const boards = boardEntries(ctx.source.config)
    if (boards.length === 0) return { ok: false, message: 'No greenhouse boards configured.' }
    const board = boards[0]!
    const started = Date.now()
    const result = await requestJson<GreenhouseResponse>(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.token)}/jobs?content=false`,
      { userAgent: ctx.userAgent, timeoutMs: 15_000, retries: 1 }
    )
    const titles = (result.data?.jobs ?? []).slice(0, 5).map((job) => job.title ?? 'untitled')
    return {
      ok: result.ok,
      message: result.ok
        ? `Greenhouse board "${board.token}" responded with ${result.data?.jobs?.length ?? 0} postings.`
        : `Greenhouse board "${board.token}" failed: ${result.error ?? `HTTP ${result.status}`}`,
      sampleCount: result.data?.jobs?.length ?? 0,
      sampleTitles: titles,
      latencyMs: Date.now() - started
    }
  }
}

function greenhouseSalary(metadata: GreenhouseJob['metadata']): {
  min: number | null
  max: number | null
  currency: string | null
  period: string | null
} {
  if (!metadata) return { min: null, max: null, currency: null, period: null }
  const pay = metadata.find((entry) => /salary|pay range|compensation/i.test(entry.name ?? ''))
  const value = str(pay?.value)
  if (!value) return { min: null, max: null, currency: null, period: null }
  const numbers = value.match(/\d[\d,.]*/g)?.map((token) => Number(token.replace(/[^\d.]/g, ''))) ?? []
  const currencyMatch = value.match(/\b(USD|EUR|GBP|CAD|AUD|CHF|SEK|NOK|DKK|PLN|INR|SGD|JPY)\b/i)
  const period = /hour|hr\b/i.test(value) ? 'hour' : /month/i.test(value) ? 'month' : 'year'
  return {
    min: numbers[0] ?? null,
    max: numbers[1] ?? numbers[0] ?? null,
    currency: currencyMatch ? currencyMatch[1]!.toUpperCase() : null,
    period
  }
}

export function greenhouseJobSummary(raw: GreenhouseJob): string {
  const parts = [
    ...(raw.departments ?? []).map((entry) => entry.name ?? ''),
    ...(raw.offices ?? []).map((entry) => entry.name ?? '')
  ].filter(Boolean)
  return truncate(parts.join(' · '), 500)
}

export function isGreenhouseJob(value: unknown): value is GreenhouseJob {
  return isRecord(value) && typeof value.title === 'string'
}
