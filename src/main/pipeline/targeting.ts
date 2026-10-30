import type { NormalizedJob } from '../../shared/types'
import { normalizeText, tokenSetSimilarity } from '../core/hash'

export interface TargetMatchJob {
  title: string
  company: string
  descriptionText: string
  countryCode: string | null
  remoteType: NormalizedJob['remoteType']
  salaryMin: number | null
  salaryCurrency: string | null
}

export interface TargetMatchConfig {
  countryCode: string
  jobTitles: string[]
  keywords: string[]
  excludeKeywords: string[]
  remotePreference: string
  minSalary: number | null
  currency: string | null
}

export interface TargetMatchResult {
  keep: boolean
  reason: string
}

export function evaluateTargetMatch(
  job: TargetMatchJob,
  target: TargetMatchConfig,
  globalExcludeCompanies: string[]
): TargetMatchResult {
  const haystack = normalizeText(`${job.title} ${job.descriptionText.slice(0, 20_000)}`)

  if (job.countryCode && job.countryCode !== target.countryCode) {
    return { keep: false, reason: `country ${job.countryCode} does not match target ${target.countryCode}` }
  }

  for (const excluded of [...target.excludeKeywords, ...globalExcludeCompanies]) {
    const needle = normalizeText(excluded)
    if (needle.length > 0 && haystack.includes(needle)) {
      return { keep: false, reason: `excluded keyword: ${excluded}` }
    }
  }

  const excludedCompany = globalExcludeCompanies.some(
    (company) => normalizeText(company) === normalizeText(job.company)
  )
  if (excludedCompany) return { keep: false, reason: `excluded company: ${job.company}` }

  if (target.remotePreference !== 'any' && job.remoteType !== 'unknown' && job.remoteType !== target.remotePreference) {
    return { keep: false, reason: `remote preference ${target.remotePreference} does not match ${job.remoteType}` }
  }

  if (target.minSalary !== null && job.salaryMin !== null) {
    const sameCurrency = !job.salaryCurrency || !target.currency || job.salaryCurrency === target.currency
    if (sameCurrency && job.salaryMin < target.minSalary * 0.9) {
      return { keep: false, reason: `salary ${job.salaryMin} is below target minimum ${target.minSalary}` }
    }
  }

  const hasTitles = target.jobTitles.some((title) => title.trim().length > 0)
  const hasKeywords = target.keywords.some((keyword) => keyword.trim().length > 0)

  if (!hasTitles && !hasKeywords) return { keep: true, reason: 'no title or keyword filter configured' }

  if (hasTitles) {
    const best = Math.max(...target.jobTitles.map((title) => tokenSetSimilarity(job.title, title)))
    if (best >= 0.45) return { keep: true, reason: `title match ${(best * 100).toFixed(0)}%` }
  }

  if (hasKeywords) {
    const keywordMatch = target.keywords.some((keyword) => {
      const needle = normalizeText(keyword)
      return needle.length > 0 && haystack.includes(needle)
    })
    if (keywordMatch) return { keep: true, reason: 'keyword match' }
  }

  return { keep: false, reason: 'no configured title or keyword matched' }
}
