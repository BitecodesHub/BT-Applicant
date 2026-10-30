import type { NormalizedJob, ScoreBreakdown } from '../../shared/types'
import { normalizeText, tokenSetSimilarity } from '../core/hash'
import { plural } from '../core/text'

export interface ScoreProfile {
  skills: string[]
  yearsExperience: number | null
}

export interface ScoreTarget {
  countryCode: string
  jobTitles: string[]
  minSalary: number | null
  currency: string | null
  remotePreference: string
}

export function scoreJob(
  job: Pick<NormalizedJob, 'title' | 'descriptionText' | 'countryCode' | 'remoteType' | 'salaryMin' | 'salaryMax' | 'postedAt' | 'skills' | 'applicationEmail' | 'applyUrl'>,
  target: ScoreTarget | null,
  profile: ScoreProfile,
  sourceKind: 'ats' | 'aggregator' | 'government' | 'generic'
): ScoreBreakdown {
  const notes: string[] = []

  let titleMatch = 15
  if (target && target.jobTitles.length > 0) {
    const best = Math.max(...target.jobTitles.map((title) => tokenSetSimilarity(job.title, title)))
    titleMatch = Math.round(Math.min(1, best) * 30)
    notes.push(`Title similarity to your target roles: ${(best * 100).toFixed(0)}%.`)
  } else {
    notes.push('No target job titles configured; title match is neutral.')
  }

  let skillMatch = 15
  if (job.skills.length > 0) {
    const profileSkills = new Set(profile.skills.map((skill) => normalizeText(skill)))
    const matched = job.skills.filter((skill) => profileSkills.has(normalizeText(skill)))
    const ratio = matched.length / job.skills.length
    skillMatch = Math.round(ratio * 30)
    notes.push(
      matched.length > 0
        ? `Matched skills: ${matched.slice(0, 6).join(', ')}.`
        : 'No overlap with the skills recorded in your profile.'
    )
  } else {
    notes.push('No skills could be extracted from the posting; skill match is neutral.')
  }

  let locationFit = 8
  if (!target) {
    locationFit = 8
    notes.push('No target country configured; location fit is neutral.')
  } else if (!job.countryCode) {
    locationFit = 8
    notes.push('The job location did not resolve to a country.')
  } else if (job.countryCode === target.countryCode) {
    locationFit = job.remoteType === target.remotePreference || target.remotePreference === 'any' ? 15 : 12
    notes.push(`Job is in your target country (${job.countryCode}).`)
  } else {
    locationFit = 0
    notes.push(`Job country ${job.countryCode} differs from target ${target.countryCode}.`)
  }

  let salaryFit = 6
  if (target?.minSalary) {
    if (job.salaryMin === null) {
      salaryFit = 6
      notes.push('Salary is not stated, so it cannot be compared with your minimum.')
    } else if (job.salaryMin >= target.minSalary) {
      salaryFit = 10
      notes.push('Stated salary meets your minimum.')
    } else if (job.salaryMin >= target.minSalary * 0.85) {
      salaryFit = 5
      notes.push('Stated salary is slightly below your minimum.')
    } else {
      salaryFit = 0
      notes.push('Stated salary is well below your minimum.')
    }
  } else {
    notes.push('No salary minimum configured.')
  }

  let freshness = 5
  if (job.postedAt) {
    const days = (Date.now() - job.postedAt) / 86_400_000
    if (days <= 7) freshness = 10
    else if (days <= 30) freshness = 6
    else if (days <= 90) freshness = 3
    else freshness = 1
    notes.push(`Posted ${plural(Math.max(0, Math.round(days)), 'day')} ago.`)
  } else {
    notes.push('Posting date is unknown.')
  }

  const sourceQuality = sourceKind === 'ats' ? 5 : sourceKind === 'government' ? 4 : sourceKind === 'aggregator' ? 3 : 2

  let penalties = 0
  if (job.descriptionText.length < 200) {
    penalties -= 10
    notes.push('The job description is very short, which reduces confidence.')
  }
  if (!job.applicationEmail && !job.applyUrl) {
    penalties -= 15
    notes.push('No direct application destination was found.')
  }

  const total = Math.max(0, Math.min(100, Math.round(titleMatch + skillMatch + locationFit + salaryFit + freshness + sourceQuality + penalties)))
  return { titleMatch, skillMatch, locationFit, salaryFit, freshness, sourceQuality, penalties, total, notes }
}
