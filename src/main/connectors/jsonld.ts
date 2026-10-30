import * as cheerio from 'cheerio'
import type { Connector, ConnectorContext, RawJob } from './types'
import { requestText, RateLimiter } from './http'
import { asArray, epochMs, isRecord, num, str, titleMatchesTarget } from './helpers'
import { detectCountry } from '../pipeline/location'
import { sha256 } from '../core/hash'

/**
 * Generic schema.org JobPosting connector. Works on employer career pages that
 * publish structured data (JSON-LD), which is the machine-readable format
 * Google Jobs requires and many ATS-hosted pages emit automatically.
 */
export const jsonLdConnector: Connector = {
  meta: {
    id: 'jsonld',
    label: 'Career pages (schema.org JSON-LD)',
    kind: 'generic',
    requiresCredentials: false,
    credentialFields: [],
    countries: 'global',
    canProvideApplicationEmail: true,
    docsUrl: 'https://schema.org/JobPosting',
    notes:
      'Reads schema.org JobPosting structured data from public career pages you configure. Only pages that publish JSON-LD are supported; no HTML scraping heuristics or anti-bot bypassing.'
  },

  async fetch(ctx: ConnectorContext): Promise<RawJob[]> {
    const urls = asArray(ctx.source.config.urls)
      .map((value) => str(value))
      .filter((value): value is string => Boolean(value))
    if (urls.length === 0) throw new Error('No career page URLs configured.')

    const limiter = new RateLimiter(ctx.source.rateLimitPerMinute)
    const jobs: RawJob[] = []
    const errors: string[] = []

    for (const url of urls) {
      await limiter.acquire()
      const page = await requestText(url, { userAgent: ctx.userAgent, signal: ctx.signal, timeoutMs: 25_000 })
      if (!page.ok || !page.data) {
        errors.push(`${url}: ${page.error ?? `HTTP ${page.status}`}`)
        continue
      }

      const postings = extractJsonLdPostings(page.data)
      for (const posting of postings) {
        const job = mapPosting(posting, url)
        if (!job) continue
        if (!titleMatchesTarget(job.title, ctx.target)) continue
        jobs.push(job)
      }
    }

    if (jobs.length === 0 && errors.length > 0) {
      throw new Error(`Career pages failed: ${errors.join('; ')}`)
    }
    ctx.signal?.throwIfAborted()
    return jobs
  },

  async test(ctx) {
    const urls = asArray(ctx.source.config.urls)
      .map((value) => str(value))
      .filter((value): value is string => Boolean(value))
    if (urls.length === 0) return { ok: false, message: 'No career page URLs configured.' }
    const started = Date.now()
    const page = await requestText(urls[0]!, { userAgent: ctx.userAgent, timeoutMs: 15_000, retries: 1 })
    if (!page.ok || !page.data) {
      return { ok: false, message: `Career page failed: ${page.error ?? `HTTP ${page.status}`}`, latencyMs: Date.now() - started }
    }
    const postings = extractJsonLdPostings(page.data)
    return {
      ok: postings.length > 0,
      message:
        postings.length > 0
          ? `Found ${postings.length} schema.org JobPosting entries on ${urls[0]}.`
          : `The page loaded but no schema.org JobPosting JSON-LD was found on ${urls[0]}.`,
      sampleCount: postings.length,
      sampleTitles: postings.slice(0, 5).map((posting) => str(posting.title) ?? 'untitled'),
      latencyMs: Date.now() - started
    }
  }
}

export function extractJsonLdPostings(html: string): Record<string, unknown>[] {
  const $ = cheerio.load(html)
  const found: Record<string, unknown>[] = []

  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).text().trim()
    if (!raw) return
    for (const document of parseJsonDocuments(raw)) {
      collectPostings(document, found, 0)
    }
  })

  return dedupePostings(found)
}

function parseJsonDocuments(raw: string): unknown[] {
  const cleaned = raw.replace(/^\uFEFF/, '').replace(/^<!--/, '').replace(/-->$/, '').trim()
  try {
    return [JSON.parse(cleaned)]
  } catch {
    const documents: unknown[] = []
    for (const line of cleaned.split(/\n(?=\{)/)) {
      try {
        documents.push(JSON.parse(line))
      } catch {
        // Ignore malformed fragments; a single broken script must not hide the rest.
      }
    }
    return documents
  }
}

function collectPostings(value: unknown, found: Record<string, unknown>[], depth: number): void {
  if (depth > 6 || !value) return
  if (Array.isArray(value)) {
    for (const entry of value) collectPostings(entry, found, depth + 1)
    return
  }
  if (!isRecord(value)) return

  if (hasJobPostingType(value['@type'])) {
    found.push(value)
    return
  }
  for (const key of ['@graph', 'itemListElement', 'mainEntity', 'item', 'items']) {
    if (key in value) collectPostings(value[key], found, depth + 1)
  }
}

function hasJobPostingType(value: unknown): boolean {
  if (typeof value === 'string') return value === 'JobPosting'
  if (Array.isArray(value)) return value.some((entry) => entry === 'JobPosting')
  return false
}

function dedupePostings(postings: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>()
  const unique: Record<string, unknown>[] = []
  for (const posting of postings) {
    const key = `${str(posting.title) ?? ''}|${str(posting.url) ?? ''}|${str(posting.datePosted) ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(posting)
  }
  return unique
}

function mapPosting(posting: Record<string, unknown>, fallbackUrl: string): RawJob | null {
  const title = str(posting.title) ?? str(posting.name)
  if (!title) return null

  const url = str(posting.url) ?? str(posting.sameAs) ?? fallbackUrl
  const descriptionHtml = str(posting.description)
  const organization = isRecord(posting.hiringOrganization) ? posting.hiringOrganization : null
  const company = str(organization?.name) ?? new URL(fallbackUrl).hostname.replace(/^www\./, '')

  const locations = asArray(posting.jobLocation)
  const locationNames: string[] = []
  let countryCode: string | null = null
  for (const entry of locations) {
    if (!isRecord(entry)) {
      const text = str(entry)
      if (text) locationNames.push(text)
      continue
    }
    const address = isRecord(entry.address) ? entry.address : null
    const country = address ? countryValue(address.addressCountry) : null
    const locality = address ? str(address.addressLocality) : null
    const region = address ? str(address.addressRegion) : null
    if (country && !countryCode) countryCode = country
    const parts = [locality, region, address ? str(address.addressCountry) : null].filter(Boolean)
    if (parts.length > 0) locationNames.push(parts.join(', '))
    else if (str(entry.name)) locationNames.push(str(entry.name)!)
  }

  const telecommute = str(posting.jobLocationType)?.toUpperCase() === 'TELECOMMUTE'
  if (locationNames.length === 0 && telecommute) locationNames.push('Remote')
  const locationRaw = locationNames.length > 0 ? [...new Set(locationNames)].slice(0, 3).join('; ') : null
  if (!countryCode) countryCode = detectCountry(locationRaw)

  const employmentTypes = asArray(posting.employmentType)
    .map((entry) => str(entry))
    .filter((entry): entry is string => Boolean(entry))

  const salary = parseBaseSalary(posting.baseSalary)
  const externalId = str(posting.identifier) ?? sha256(`${url}|${title}`)

  return {
    externalId,
    title,
    company,
    locationRaw,
    countryCode,
    remoteType: telecommute ? 'remote' : undefined,
    employmentType: employmentTypes[0] ?? null,
    salaryMin: salary.min,
    salaryMax: salary.max,
    salaryCurrency: salary.currency,
    salaryPeriod: salary.period,
    descriptionHtml,
    descriptionText: null,
    postedAt: epochMs(posting.datePosted),
    expiresAt: epochMs(posting.validThrough),
    url,
    applyUrl: url,
    companyDomain: str(organization?.sameAs) ?? null,
    raw: {
      directApply: posting.directApply === true,
      jobLocationType: posting.jobLocationType ?? null,
      applicantLocationRequirements: posting.applicantLocationRequirements ?? null,
      experienceRequirements: posting.experienceRequirements ?? null
    }
  }
}

function countryValue(value: unknown): string | null {
  if (typeof value === 'string') {
    if (/^[A-Za-z]{2}$/.test(value)) return value.toUpperCase()
    return detectCountry(value)
  }
  if (isRecord(value)) {
    const name = str(value.name)
    if (name) {
      if (/^[A-Za-z]{2}$/.test(name)) return name.toUpperCase()
      return detectCountry(name)
    }
  }
  return null
}

function parseBaseSalary(value: unknown): { min: number | null; max: number | null; currency: string | null; period: string | null } {
  if (!isRecord(value)) return { min: null, max: null, currency: null, period: null }
  const currency = str(value.currency)
  const inner = isRecord(value.value) ? value.value : null
  const min = num(inner?.minValue) ?? num(inner?.value)
  const max = num(inner?.maxValue) ?? num(inner?.value)
  const unit = str(inner?.unitText)?.toLowerCase() ?? null
  return { min, max, currency, period: unit }
}
