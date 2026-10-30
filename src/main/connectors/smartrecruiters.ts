import type { Connector, ConnectorContext, RawJob } from './types'
import { requestJson, RateLimiter } from './http'
import { boardEntries, epochMs, isRecord, str, truncate } from './helpers'

interface SmartRecruitersPosting {
  id?: string
  name?: string
  ref?: string
  releasedDate?: string
  location?: { city?: string; region?: string; country?: string; remote?: boolean; fullLocation?: string }
  company?: { identifier?: string; name?: string }
  typeOfEmployment?: { label?: string }
  experienceLevel?: { label?: string }
  department?: { label?: string }
  industry?: { label?: string }
}

interface SmartRecruitersListResponse {
  totalFound?: number
  content?: SmartRecruitersPosting[]
}

interface SmartRecruitersDetail {
  id?: string
  jobAd?: {
    sections?: Record<string, { title?: string; text?: string } | undefined>
  }
  postingUrl?: string
  applyUrl?: string
}

/** SmartRecruiters public postings API: https://developers.smartrecruiters.com/ */
export const smartRecruitersConnector: Connector = {
  meta: {
    id: 'smartrecruiters',
    label: 'SmartRecruiters',
    kind: 'ats',
    requiresCredentials: false,
    credentialFields: [],
    countries: 'global',
    canProvideApplicationEmail: false,
    docsUrl: 'https://developers.smartrecruiters.com/',
    notes:
      'Public company postings API. Configure company identifiers from jobs.smartrecruiters.com/<company>. Job descriptions are fetched per posting, so item volume is capped.'
  },

  async fetch(ctx: ConnectorContext): Promise<RawJob[]> {
    const companies = boardEntries(ctx.source.config)
    if (companies.length === 0) throw new Error('No SmartRecruiters companies configured.')

    const limiter = new RateLimiter(ctx.source.rateLimitPerMinute)
    const jobs: RawJob[] = []
    const errors: string[] = []
    const detailBudget = Math.max(10, Math.min(60, ctx.target.pageLimit * 20))
    let detailsFetched = 0

    for (const company of companies) {
      for (let page = 0; page < Math.max(1, ctx.target.pageLimit); page += 1) {
        await limiter.acquire()
        const params = new URLSearchParams({ limit: '100', offset: String(page * 100) })
        if (ctx.target.countryCode) params.set('country', ctx.target.countryCode)
        const query = ctx.target.jobTitles.find((title) => title.trim().length > 0)
        if (query) params.set('q', query)

        const list = await requestJson<SmartRecruitersListResponse>(
          `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company.token)}/postings?${params.toString()}`,
          { userAgent: ctx.userAgent, signal: ctx.signal, timeoutMs: 25_000 }
        )
        if (!list.ok || !list.data) {
          errors.push(`${company.token}: ${list.error ?? `HTTP ${list.status}`}`)
          break
        }

        const postings = list.data.content ?? []
        if (postings.length === 0) break

        for (const posting of postings) {
          if (!posting.name || !posting.id) continue
          const detail = detailsFetched < detailBudget ? await fetchDetail(ctx, limiter, company.token, posting.id) : null
          if (detail) detailsFetched += 1

          const descriptionHtml = renderSections(detail)
          const location = posting.location
          const joinedLocation = [location?.city, location?.region, location?.country].filter(Boolean).join(', ')
          const url = `https://jobs.smartrecruiters.com/${encodeURIComponent(company.token)}/${encodeURIComponent(posting.id)}`

          jobs.push({
            externalId: posting.id,
            title: posting.name,
            company: company.label ?? posting.company?.name ?? company.token,
            locationRaw: location?.fullLocation ?? (joinedLocation.length > 0 ? joinedLocation : null),
            countryCode: location?.country ?? null,
            remoteType: location?.remote ? 'remote' : undefined,
            employmentType: posting.typeOfEmployment?.label ?? null,
            descriptionHtml,
            descriptionText: descriptionHtml ? truncate(htmlToText(descriptionHtml), 200_000) : null,
            postedAt: epochMs(posting.releasedDate),
            url,
            applyUrl: url,
            companyDomain: company.domain,
            seniority: posting.experienceLevel?.label ?? null,
            raw: { company: company.token, department: posting.department?.label ?? null }
          })
        }

        if (postings.length < 100) break
      }
    }

    if (jobs.length === 0 && errors.length > 0) {
      throw new Error(`SmartRecruiters companies failed: ${errors.join('; ')}`)
    }
    ctx.signal?.throwIfAborted()
    return jobs
  },

  async test(ctx) {
    const companies = boardEntries(ctx.source.config)
    if (companies.length === 0) return { ok: false, message: 'No SmartRecruiters companies configured.' }
    const company = companies[0]!
    const started = Date.now()
    const result = await requestJson<SmartRecruitersListResponse>(
      `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company.token)}/postings?limit=5`,
      { userAgent: ctx.userAgent, timeoutMs: 15_000, retries: 1 }
    )
    const postings = result.data?.content ?? []
    return {
      ok: result.ok,
      message: result.ok
        ? `SmartRecruiters company "${company.token}" responded with ${postings.length} postings.`
        : `SmartRecruiters company "${company.token}" failed: ${result.error ?? `HTTP ${result.status}`}`,
      sampleCount: postings.length,
      sampleTitles: postings.slice(0, 5).map((posting) => posting.name ?? 'untitled'),
      latencyMs: Date.now() - started
    }
  }
}

async function fetchDetail(
  ctx: ConnectorContext,
  limiter: RateLimiter,
  company: string,
  id: string
): Promise<SmartRecruitersDetail | null> {
  await limiter.acquire()
  const result = await requestJson<SmartRecruitersDetail>(
    `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings/${encodeURIComponent(id)}`,
    { userAgent: ctx.userAgent, signal: ctx.signal, timeoutMs: 20_000, retries: 1 }
  )
  return result.ok && isRecord(result.data) ? result.data : null
}

function renderSections(detail: SmartRecruitersDetail | null): string | null {
  const sections = detail?.jobAd?.sections
  if (!sections) return null
  const parts: string[] = []
  for (const key of ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation']) {
    const section = sections[key]
    if (!section || typeof section.text !== 'string' || section.text.trim().length === 0) continue
    parts.push(`<h2>${section.title ?? key}</h2>${section.text}`)
  }
  const html = parts.join('\n').trim()
  return html.length > 0 ? html : null
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function smartRecruitersApplyUrl(company: string, id: string): string {
  const slug = str(company) ?? 'company'
  return `https://jobs.smartrecruiters.com/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`
}
