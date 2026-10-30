import type { JobRecord } from '../db/repos/jobs'
import type { RouteDecision } from '../../shared/types'
import { hasCitizenshipOnlyRequirement } from '../eligibility/signals'

const ATS_PROVIDERS: { pattern: RegExp; id: string; label: string }[] = [
  { pattern: /greenhouse\.io/i, id: 'greenhouse', label: 'Greenhouse' },
  { pattern: /lever\.co/i, id: 'lever', label: 'Lever' },
  { pattern: /ashbyhq\.com/i, id: 'ashby', label: 'Ashby' },
  { pattern: /smartrecruiters\.com/i, id: 'smartrecruiters', label: 'SmartRecruiters' },
  { pattern: /workable\.com/i, id: 'workable', label: 'Workable' },
  { pattern: /myworkdayjobs\.com|workday\.com/i, id: 'workday', label: 'Workday' },
  { pattern: /recruitee\.com/i, id: 'recruitee', label: 'Recruitee' },
  { pattern: /teamtailor\.com/i, id: 'teamtailor', label: 'Teamtailor' },
  { pattern: /bamboohr\.com/i, id: 'bamboohr', label: 'BambooHR' },
  { pattern: /jobvite\.com/i, id: 'jobvite', label: 'Jobvite' },
  { pattern: /icims\.com/i, id: 'icims', label: 'iCIMS' },
  { pattern: /successfactors\.com/i, id: 'successfactors', label: 'SAP SuccessFactors' }
]

export function detectAts(url: string | null | undefined): { id: string; label: string } | null {
  if (!url) return null
  for (const provider of ATS_PROVIDERS) {
    if (provider.pattern.test(url)) return { id: provider.id, label: provider.label }
  }
  return null
}

function isHttpUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Chooses the application channel from verified evidence only.
 * A guessed or generic email address is never used.
 */
export function decideApplicationRoute(job: JobRecord): RouteDecision {
  if (job.applicationEmail) {
    if (!job.applicationEmailEvidence) {
      return {
        channel: 'manual',
        reason:
          'An email address exists but no evidence shows it is the application destination. Review before using it.',
        evidence: { applicationEmail: job.applicationEmail, hasEvidence: false }
      }
    }
    return {
      channel: 'email',
      reason: 'The posting explicitly directs applications to a published email address.',
      recipient: job.applicationEmail,
      evidence: {
        matchedRule: 'email.published_application_address',
        applicationEmail: job.applicationEmail,
        quote: job.applicationEmailEvidence
      }
    }
  }

  if (isHttpUrl(job.applyUrl)) {
    const ats = detectAts(job.applyUrl)
    return {
      channel: 'web',
      reason: ats
        ? `The posting uses ${ats.label} for applications.`
        : 'The posting provides a direct application URL.',
      applyUrl: job.applyUrl!,
      evidence: {
        matchedRule: ats ? 'web.ats_provider' : 'web.direct_application_url',
        atsProvider: ats?.id ?? null,
        applyUrl: job.applyUrl
      }
    }
  }

  if (isHttpUrl(job.url)) {
    const ats = detectAts(job.url)
    return {
      channel: 'web',
      reason: ats
        ? `The canonical listing is hosted on ${ats.label}.`
        : 'No separate application URL exists, so the original listing is the documented destination.',
      applyUrl: job.url,
      evidence: {
        matchedRule: ats ? 'web.listing_ats' : 'web.listing_url',
        atsProvider: ats?.id ?? null,
        applyUrl: job.url
      }
    }
  }

  return {
    channel: 'manual',
    reason: 'No usable application URL or verified email address was found in the posting.',
    evidence: { matchedRule: 'manual.no_destination' }
  }
}

export function routeRequiresCitizenshipAnswer(job: JobRecord): boolean {
  return job.sponsorSignal === 'citizenship_or_clearance_required' || hasCitizenshipOnlyRequirement(job.workAuthStatements)
}
