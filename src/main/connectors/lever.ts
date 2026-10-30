import type { Connector, ConnectorContext, RawJob } from './types'
import { requestJson, RateLimiter } from './http'
import { boardEntries, epochMs, num, str, truncate } from './helpers'

interface LeverPosting {
  id?: string
  text?: string
  hostedUrl?: string
  applyUrl?: string
  createdAt?: number
  description?: string
  descriptionPlain?: string
  additional?: string
  additionalPlain?: string
  lists?: { text?: string; content?: string }[]
  categories?: {
    location?: string
    allLocations?: string[]
    team?: string
    department?: string
    commitment?: string
  }
  workplaceType?: string
  country?: string
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string }
}

/**
 * Lever public postings API, documented at
 * https://github.com/lever/postings-api. `mode=json` returns the employer's
 * public postings without authentication.
 */
export const leverConnector: Connector = {
  meta: {
    id: 'lever',
    label: 'Lever job boards',
    kind: 'ats',
    requiresCredentials: false,
    credentialFields: [],
    countries: 'global',
    canProvideApplicationEmail: false,
    docsUrl: 'https://github.com/lever/postings-api',
    notes:
      'Public postings API for employers hosted on Lever. Configure company slugs (the first path segment of jobs.lever.co/<company>).'
  },

  async fetch(ctx: ConnectorContext): Promise<RawJob[]> {
    const boards = boardEntries(ctx.source.config)
    if (boards.length === 0) throw new Error('No Lever companies configured.')

    const limiter = new RateLimiter(ctx.source.rateLimitPerMinute)
    const jobs: RawJob[] = []
    const errors: string[] = []

    for (const board of boards) {
      await limiter.acquire()
      const result = await requestJson<LeverPosting[]>(
        `https://api.lever.co/v0/postings/${encodeURIComponent(board.token)}?mode=json&limit=200`,
        { userAgent: ctx.userAgent, signal: ctx.signal, timeoutMs: 25_000 }
      )
      if (!result.ok || !Array.isArray(result.data)) {
        errors.push(`${board.token}: ${result.error ?? `HTTP ${result.status}`}`)
        continue
      }

      for (const posting of result.data) {
        if (!posting.text || !posting.hostedUrl) continue
        const lists = posting.lists ?? []
        const listHtml = lists.map((list) => `<h3>${list.text ?? ''}</h3>${list.content ?? ''}`).join('\n')
        const descriptionHtml = [posting.description ?? '', listHtml, posting.additional ?? ''].join('\n')
        const descriptionText = [
          posting.descriptionPlain ?? '',
          lists.map((list) => `${list.text ?? ''}\n${stripTags(list.content ?? '')}`).join('\n'),
          posting.additionalPlain ?? ''
        ]
          .join('\n')
          .trim()
        const locations = posting.categories?.allLocations ?? []
        const locationRaw = locations.length > 0 ? locations.join('; ') : posting.categories?.location ?? null

        jobs.push({
          externalId: posting.id ?? posting.hostedUrl,
          title: posting.text,
          company: board.label ?? board.token,
          locationRaw,
          countryCode: posting.country ?? null,
          remoteType: leverWorkplace(posting.workplaceType),
          employmentType: posting.categories?.commitment ?? null,
          salaryMin: num(posting.salaryRange?.min),
          salaryMax: num(posting.salaryRange?.max),
          salaryCurrency: str(posting.salaryRange?.currency),
          salaryPeriod: str(posting.salaryRange?.interval),
          descriptionHtml,
          descriptionText: descriptionText.length > 0 ? descriptionText : null,
          postedAt: epochMs(posting.createdAt),
          url: posting.hostedUrl,
          applyUrl: posting.applyUrl ?? posting.hostedUrl,
          companyDomain: board.domain,
          raw: {
            company: board.token,
            team: posting.categories?.team ?? null,
            department: posting.categories?.department ?? null
          }
        })
      }
    }

    if (jobs.length === 0 && errors.length > 0) {
      throw new Error(`Lever companies failed: ${errors.join('; ')}`)
    }
    ctx.signal?.throwIfAborted()
    return jobs
  },

  async test(ctx) {
    const boards = boardEntries(ctx.source.config)
    if (boards.length === 0) return { ok: false, message: 'No Lever companies configured.' }
    const board = boards[0]!
    const started = Date.now()
    const result = await requestJson<LeverPosting[]>(
      `https://api.lever.co/v0/postings/${encodeURIComponent(board.token)}?mode=json&limit=5`,
      { userAgent: ctx.userAgent, timeoutMs: 15_000, retries: 1 }
    )
    const postings = Array.isArray(result.data) ? result.data : []
    return {
      ok: result.ok,
      message: result.ok
        ? `Lever company "${board.token}" responded with ${postings.length} postings.`
        : `Lever company "${board.token}" failed: ${result.error ?? `HTTP ${result.status}`}`,
      sampleCount: postings.length,
      sampleTitles: postings.slice(0, 5).map((posting) => posting.text ?? 'untitled'),
      latencyMs: Date.now() - started
    }
  }
}

function leverWorkplace(value: string | undefined): RawJob['remoteType'] {
  if (!value) return undefined
  const normalized = value.toLowerCase()
  if (normalized.includes('remote')) return 'remote'
  if (normalized.includes('hybrid')) return 'hybrid'
  if (normalized.includes('on')) return 'onsite'
  return undefined
}

function stripTags(html: string): string {
  return truncate(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), 20_000)
}
