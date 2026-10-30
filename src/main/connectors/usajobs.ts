import type { Connector, ConnectorContext, RawJob } from './types'
import { requestJson, RateLimiter } from './http'
import { asArray, epochMs, isRecord, maxPages, num, str, titleMatchesTarget } from './helpers'

interface UsaJobsDescriptor {
  PositionID?: string
  PositionTitle?: string
  PositionURI?: string
  ApplyURI?: string[]
  OrganizationName?: string
  DepartmentName?: string
  PositionLocation?: {
    LocationName?: string
    CountryCode?: string
    CitySubdivisionName?: string
    CountrySubDivisionCode?: string
  }[]
  PositionRemuneration?: {
    MinimumRange?: string
    MaximumRange?: string
    RateIntervalCode?: string
    Description?: string
  }[]
  PositionStartDate?: string
  PositionEndDate?: string
  PublicationStartDate?: string
  ApplicationCloseDate?: string
  UserArea?: {
    Details?: {
      JobSummary?: string
      MajorDuties?: string[]
      Qualifications?: string
      Education?: string
      Requirements?: string
      TeleworkEligible?: boolean
      RemoteJob?: boolean
      LowGrade?: string
      HighGrade?: string
      JobCategory?: { Name?: string }[]
      PositionSchedule?: { Name?: string }[]
      PositionOfferingType?: { Name?: string }[]
      WhoMayApply?: { Name?: string }[]
    }
  }
}

interface UsaJobsItem {
  MatchedObjectId?: string
  MatchedObjectDescriptor?: UsaJobsDescriptor
}

interface UsaJobsResponse {
  SearchResult?: {
    SearchResultCount?: number
    SearchResultItems?: UsaJobsItem[]
  }
}

/**
 * USAJOBS Search API: https://developer.usajobs.gov/API-Reference
 * Requires a free API key plus a contact email in the User-Agent header, both
 * mandated by the API terms.
 */
export const usaJobsConnector: Connector = {
  meta: {
    id: 'usajobs',
    label: 'USAJOBS (US federal)',
    kind: 'government',
    requiresCredentials: true,
    credentialFields: [
      { key: 'apiKey', label: 'API key', hint: 'Request from developer.usajobs.gov' },
      { key: 'email', label: 'Contact email', hint: 'Sent as the User-Agent, required by USAJOBS' }
    ],
    countries: ['US'],
    canProvideApplicationEmail: false,
    docsUrl: 'https://developer.usajobs.gov/API-Reference',
    notes:
      'Official US federal jobs feed. Only covers the United States. Many postings require citizenship; the eligibility engine applies the posting text as written.'
  },

  async fetch(ctx: ConnectorContext): Promise<RawJob[]> {
    if (ctx.target.countryCode.toUpperCase() !== 'US') return []

    const apiKey = str(ctx.credentials.apiKey)
    const email = str(ctx.credentials.email)
    if (!apiKey || !email) throw new Error('USAJOBS requires an API key and a contact email.')

    const limiter = new RateLimiter(ctx.source.rateLimitPerMinute)
    const jobs: RawJob[] = []
    const query = ctx.target.jobTitles.find((title) => title.trim().length > 0) ?? ctx.target.keywords[0] ?? ''

    for (let page = 1; page <= maxPages(ctx.target, 2); page += 1) {
      await limiter.acquire()
      const params = new URLSearchParams({
        ResultsPerPage: '50',
        Page: String(page),
        DatePosted: '30',
        Fields: 'Full'
      })
      if (query) params.set('Keyword', query)

      const result = await requestJson<UsaJobsResponse>(`https://data.usajobs.gov/api/search?${params.toString()}`, {
        userAgent: email,
        headers: { 'authorization-key': apiKey, 'host': 'data.usajobs.gov' },
        signal: ctx.signal,
        timeoutMs: 25_000
      })
      if (!result.ok || !result.data?.SearchResult) {
        if (page === 1) throw new Error(`USAJOBS failed: ${result.error ?? `HTTP ${result.status}`}`)
        break
      }

      const items = result.data.SearchResult.SearchResultItems ?? []
      if (items.length === 0) break

      for (const item of items) {
        const job = item.MatchedObjectDescriptor
        if (!job?.PositionTitle || !job.PositionURI) continue
        if (!titleMatchesTarget(job.PositionTitle, ctx.target)) continue
        const details = job.UserArea?.Details ?? {}
        const locations = (job.PositionLocation ?? [])
          .map((entry) => entry.LocationName ?? '')
          .filter(Boolean)
          .slice(0, 3)
        const pay = job.PositionRemuneration?.[0]
        const descriptionHtml = renderDescription(details)
        const applyUrls = Array.isArray(job.ApplyURI) ? job.ApplyURI.filter(Boolean) : []

        jobs.push({
          externalId: job.PositionID ?? item.MatchedObjectId ?? job.PositionURI,
          title: job.PositionTitle,
          company: job.OrganizationName ?? job.DepartmentName ?? 'US federal agency',
          locationRaw: locations.join('; ') || null,
          countryCode: 'US',
          remoteType: details.RemoteJob ? 'remote' : details.TeleworkEligible ? 'hybrid' : undefined,
          employmentType: details.PositionOfferingType?.[0]?.Name ?? details.PositionSchedule?.[0]?.Name ?? null,
          salaryMin: num(pay?.MinimumRange),
          salaryMax: num(pay?.MaximumRange),
          salaryCurrency: 'USD',
          salaryPeriod: pay?.RateIntervalCode?.toLowerCase().includes('hour') ? 'hour' : 'year',
          descriptionHtml,
          descriptionText: null,
          postedAt: epochMs(job.PublicationStartDate),
          expiresAt: epochMs(job.ApplicationCloseDate ?? job.PositionEndDate),
          url: job.PositionURI,
          applyUrl: applyUrls[0] ?? job.PositionURI,
          skills: (details.JobCategory ?? []).map((entry) => entry.Name ?? '').filter(Boolean),
          seniority: details.LowGrade && details.HighGrade ? `${details.LowGrade}–${details.HighGrade}` : null,
          raw: {
            whoMayApply: (details.WhoMayApply ?? []).map((entry) => entry.Name ?? ''),
            department: job.DepartmentName ?? null
          }
        })
      }

      if (items.length < 50) break
    }

    ctx.signal?.throwIfAborted()
    return jobs
  },

  async test(ctx) {
    const apiKey = str(ctx.credentials.apiKey)
    const email = str(ctx.credentials.email)
    if (!apiKey || !email) return { ok: false, message: 'USAJOBS credentials are missing.' }
    if (ctx.target.countryCode.toUpperCase() !== 'US') {
      return { ok: false, message: 'USAJOBS only covers the United States.' }
    }
    const started = Date.now()
    const params = new URLSearchParams({ ResultsPerPage: '5', Page: '1' })
    const result = await requestJson<UsaJobsResponse>(`https://data.usajobs.gov/api/search?${params.toString()}`, {
      userAgent: email,
      headers: { 'authorization-key': apiKey, host: 'data.usajobs.gov' },
      timeoutMs: 15_000,
      retries: 1
    })
    const items = result.data?.SearchResult?.SearchResultItems ?? []
    return {
      ok: result.ok,
      message: result.ok
        ? `USAJOBS responded with ${result.data?.SearchResult?.SearchResultCount ?? items.length} results.`
        : `USAJOBS failed: ${result.error ?? `HTTP ${result.status}`}`,
      sampleCount: items.length,
      sampleTitles: items
        .slice(0, 5)
        .map((item) => item.MatchedObjectDescriptor?.PositionTitle ?? 'untitled'),
      latencyMs: Date.now() - started
    }
  }
}

function renderDescription(details: NonNullable<UsaJobsDescriptor['UserArea']>['Details']): string | null {
  if (!details) return null
  const parts: string[] = []
  if (details.JobSummary) parts.push(`<h2>Summary</h2><p>${details.JobSummary}</p>`)
  const duties = asArray<string>(details.MajorDuties).filter(Boolean)
  if (duties.length > 0) parts.push(`<h2>Duties</h2><ul>${duties.map((duty) => `<li>${duty}</li>`).join('')}</ul>`)
  if (details.Qualifications) parts.push(`<h2>Qualifications</h2><p>${details.Qualifications}</p>`)
  if (details.Requirements) parts.push(`<h2>Requirements</h2><p>${details.Requirements}</p>`)
  if (details.Education) parts.push(`<h2>Education</h2><p>${details.Education}</p>`)
  const html = parts.join('\n').trim()
  return html.length > 0 ? html : null
}

export function isUsaJobsItem(value: unknown): value is UsaJobsItem {
  return isRecord(value) && isRecord(value.MatchedObjectDescriptor)
}
