import * as cheerio from 'cheerio'
import type { NormalizedJob } from '../../shared/types'
import type { RawJob } from '../connectors/types'
import { companySlug, normalizeText, sha256 } from '../core/hash'
import { extractSponsorshipSignals, type SignalExtraction } from '../eligibility/signals'
import { extractApplicationEmail, parseMailto } from './email-extract'
import { detectCountry, detectRemoteType, isWorldwideRemote, normalizeEmploymentType } from './location'
import { parseSalary } from './salary'
import { extractSeniority, extractSkills } from './skills'

export function stripHtml(html: string | null | undefined): string {
  if (!html) return ''
  const $ = cheerio.load(html)
  $('script, style, noscript').remove()
  const text = $('body').text() || $.root().text()
  return text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim()
}

export interface NormalizeContext {
  sourceId: string
  sourceName: string
  fallbackCountry?: string | null
}

const CP1252_BYTES: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
  'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91,
  '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98,
  '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f
}

function cp1252Byte(char: string): number | null {
  const code = char.codePointAt(0)
  if (code === undefined) return null
  if (code >= 0x80 && code <= 0xff) return code
  return CP1252_BYTES[char] ?? null
}

/**
 * Repairs UTF-8 text that a feed has decoded as Windows-1252 (for example
 * `Weâ€™ve`). Only byte runs that decode to valid UTF-8 are rewritten, so
 * ordinary non-Latin text is left untouched.
 */
export function repairMojibake(text: string): string {
  if (!text.includes('Ã') && !text.includes('Â') && !text.includes('â')) return text
  let result = ''
  let index = 0
  while (index < text.length) {
    const lead = text.charCodeAt(index)
    const length = lead >= 0xc2 && lead <= 0xdf ? 2 : lead >= 0xe0 && lead <= 0xef ? 3 : lead >= 0xf0 && lead <= 0xf4 ? 4 : 0
    if (length > 1 && index + length <= text.length) {
      const bytes: number[] = []
      for (let offset = 0; offset < length; offset += 1) {
        const byte = cp1252Byte(text[index + offset])
        if (byte === null) break
        bytes.push(byte)
      }
      if (bytes.length === length) {
        try {
          const decoded = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes))
          if (decoded && !decoded.includes('\uFFFD')) {
            result += decoded
            index += length
            continue
          }
        } catch {
          // Not a valid UTF-8 run; keep the original characters.
        }
      }
    }
    result += text[index]
    index += 1
  }
  return result
}

export interface NormalizeResult {
  job: NormalizedJob
  sponsor: SignalExtraction
}

export function normalizeJob(raw: RawJob, context: NormalizeContext): NormalizeResult {
  const descriptionText = repairMojibake(raw.descriptionText?.trim() || stripHtml(raw.descriptionHtml)).slice(0, 200_000)
  const descriptionHtml = raw.descriptionHtml ? repairMojibake(raw.descriptionHtml) : null

  const providedCountry = raw.countryCode?.toUpperCase() ?? null
  const countryCode =
    (providedCountry && /^[A-Z]{2}$/.test(providedCountry) ? providedCountry : null) ??
    detectCountry(raw.locationRaw) ??
    (context.fallbackCountry ? context.fallbackCountry.toUpperCase() : null)

  const remoteType = raw.remoteType ?? detectRemoteType(raw.locationRaw, raw.title)

  const worldwide = isWorldwideRemote(raw.locationRaw)
  const resolvedRemote = worldwide && (raw.remoteType === undefined || raw.remoteType === 'unknown') ? 'remote' : remoteType

  const parsedSalary = parseSalary(`${raw.title}\n${descriptionText}`)
  const salaryMin = raw.salaryMin ?? parsedSalary?.min ?? null
  const salaryMax = raw.salaryMax ?? parsedSalary?.max ?? null
  const salaryCurrency = raw.salaryCurrency ?? parsedSalary?.currency ?? null
  const salaryPeriod = raw.salaryPeriod ?? parsedSalary?.period ?? null

  const mailto = parseMailto(raw.applyUrl)
  const extractedEmail = raw.applicationEmail
    ? {
        email: raw.applicationEmail,
        evidence: raw.applicationEmailEvidence ?? 'Published by the job source as the application address.'
      }
    : mailto
      ? { email: mailto.email, evidence: 'The application link is a mailto address published with the posting.' }
      : extractApplicationEmail(descriptionText)

  const combinedSkills = [...new Set([...(raw.skills ?? []), ...extractSkills(`${raw.title}\n${descriptionText}`)])].slice(0, 30)

  const { text: instructions } = findInstructionSentence(descriptionText)

  const sponsor = extractSponsorshipSignals(descriptionText)

  const job: NormalizedJob = {
    externalId: raw.externalId || sha256(raw.url),
    sourceId: context.sourceId,
    sourceName: context.sourceName,
    title: repairMojibake(raw.title).trim().slice(0, 300),
    company: repairMojibake(raw.company).trim().slice(0, 200),
    companyDomain: raw.companyDomain ?? null,
    countryCode: countryCode ?? null,
    locationRaw: raw.locationRaw ? repairMojibake(raw.locationRaw).trim().slice(0, 300) : null,
    remoteType: resolvedRemote,
    employmentType: normalizeEmploymentType(raw.employmentType),
    salaryMin,
    salaryMax,
    salaryCurrency,
    salaryPeriod,
    descriptionHtml,
    descriptionText,
    requirements: extractRequirements(descriptionText),
    postedAt: normalizeTimestamp(raw.postedAt),
    expiresAt: normalizeTimestamp(raw.expiresAt),
    url: raw.url,
    applyUrl: raw.applyUrl ?? null,
    applicationEmail: extractedEmail?.email ?? null,
    applicationEmailEvidence: extractedEmail?.evidence ?? null,
    applicationInstructions: raw.applicationInstructions ?? instructions,
    skills: combinedSkills,
    seniority: raw.seniority ?? extractSeniority(raw.title, descriptionText),
    raw: raw.raw ?? null
  }

  return { job, sponsor }
}

function normalizeTimestamp(value: number | null | undefined): number | null {
  if (!value) return null
  if (value > 10_000_000_000) return value
  if (value > 1_000_000_000) return value * 1000
  return null
}

function findInstructionSentence(text: string): { text: string | null } {
  const index = text.search(/\b(how to apply|to apply|application instructions|please send|submit your application)\b/i)
  if (index === -1) return { text: null }
  let end = text.length
  for (const separator of ['.', '\n', '!', '?']) {
    const found = text.indexOf(separator, index)
    if (found !== -1 && found + 1 < end) end = found + 1
  }
  const sentence = text.slice(index, end).replace(/\s+/g, ' ').trim()
  return { text: sentence.slice(0, 500) }
}

function extractRequirements(text: string): string[] {
  const requirements: string[] = []
  const marker = text.search(/\b(requirements|qualifications|what you(?:'| wi)ll need|you have|must have|required skills)\b/i)
  if (marker === -1) return requirements
  const section = text.slice(marker, marker + 3000)
  for (const line of section.split(/\n|•|·|\u2022/)) {
    const cleaned = line.replace(/^[\s\-*–—]+/, '').trim()
    if (cleaned.length > 20 && cleaned.length < 300) requirements.push(cleaned)
    if (requirements.length >= 12) break
  }
  return requirements
}

export function computeDedupeKey(company: string, title: string, countryCode: string | null): string {
  return `${companySlug(company)}|${normalizeText(title)}|${countryCode?.toUpperCase() ?? 'unknown'}`
}

export function computeFingerprint(title: string, company: string, descriptionText: string): string {
  return sha256(
    `${normalizeText(title)}|${normalizeText(company)}|${normalizeText(descriptionText).slice(0, 4000)}`
  )
}
