import type {
  EligibilityReason,
  EligibilityResult,
  SponsorshipSignal,
  WorkAuthStatement,
  WorkAuthorizationStatus
} from '../../shared/types'
import { findBilateralRoutes, findBlocFor, rules } from './rules'
import { hasClearanceRequirement } from './signals'

export interface EligibilityJob {
  countryCode: string | null
  sponsorSignal: SponsorshipSignal
  workAuthStatements: WorkAuthStatement[]
}

export interface CandidateAuthorization {
  countryCode: string
  status: WorkAuthorizationStatus
  validUntil: string | null
  needsSponsorship: boolean
}

export interface EligibilityCandidate {
  citizenships: string[]
  residenceCountry: string | null
  authorizations: CandidateAuthorization[]
}

const VERDICT_ELIGIBLE: EligibilityResult['verdict'][] = ['eligible', 'eligible_needs_sponsorship_offered']

function reason(code: string, message: string, ruleId?: string, evidence?: string): EligibilityReason {
  return { code, message, ...(ruleId ? { ruleId } : {}), ...(evidence ? { evidence } : {}) }
}

/**
 * Deterministic eligibility engine. AI never overrides the verdict.
 *
 * Invariants:
 *  - Unknown authorization never resolves to eligible.
 *  - Living in a country is not treated as authorization to work there.
 *  - Citizenship of the job's country is sufficient.
 */
export function evaluateEligibility(
  job: EligibilityJob,
  candidate: EligibilityCandidate,
  todayIso: string = new Date().toISOString().slice(0, 10)
): EligibilityResult {
  const reasons: EligibilityReason[] = []
  const ruleIds: string[] = []
  const destination = job.countryCode?.toUpperCase() ?? null
  const citizenships = candidate.citizenships.map((code) => code.toUpperCase())
  const primaryEvidence = job.workAuthStatements[0]?.quote

  if (!destination) {
    return {
      verdict: 'needs_review',
      reasons: [
        reason('country_unknown', 'The job location does not resolve to a country, so work authorization cannot be assessed.')
      ],
      ruleIds: [],
      authorizationBasis: 'none',
      matchedBloc: null,
      requiresSponsorship: false,
      sponsorSignal: job.sponsorSignal
    }
  }

  if (citizenships.length === 0) {
    return {
      verdict: 'needs_review',
      reasons: [
        reason('citizenship_missing', 'No citizenship is recorded in the candidate profile. Work authorization cannot be assessed.')
      ],
      ruleIds: [],
      authorizationBasis: 'none',
      matchedBloc: null,
      requiresSponsorship: false,
      sponsorSignal: job.sponsorSignal
    }
  }

  const authorization = candidate.authorizations.find(
    (item) => item.countryCode.toUpperCase() === destination
  )

  let authorized = false
  let authorizationBasis: EligibilityResult['authorizationBasis'] = 'none'
  let matchedBloc: string | null = null
  let blocked = false

  if (citizenships.includes(destination) || authorization?.status === 'citizen') {
    authorized = true
    authorizationBasis = 'citizenship'
    reasons.push(reason('authorized_citizen', `You are a citizen of ${destination}, so you can work there without sponsorship.`))
  } else if (authorization?.status === 'permanent_resident') {
    authorized = true
    authorizationBasis = 'permanent_residence'
    reasons.push(reason('authorized_permanent_resident', `You hold permanent residence in ${destination}.`))
  } else if (authorization?.status === 'work_permit') {
    const expired = Boolean(authorization.validUntil && authorization.validUntil < todayIso)
    if (expired) {
      blocked = true
      reasons.push(
        reason(
          'permit_expired',
          `Your work permit for ${destination} expired on ${authorization.validUntil}. Update it or mark it as expired before applying.`
        )
      )
    } else {
      authorized = true
      authorizationBasis = 'permit'
      reasons.push(
        reason(
          'authorized_permit',
          `You hold a valid work permit for ${destination}${authorization.validUntil ? ` until ${authorization.validUntil}` : ''}.`
        )
      )
    }
  } else if (authorization?.status === 'student_permit' || authorization?.status === 'dependent_permit') {
    blocked = true
    reasons.push(
      reason(
        'permit_restricted',
        `Your ${authorization.status === 'student_permit' ? 'student' : 'dependent'} permit in ${destination} may restrict full-time work. Confirm your work rights before applying.`
      )
    )
  }

  if (!authorized && !blocked) {
    const bloc = findBlocFor(destination, citizenships)
    if (bloc && bloc.effect === 'work_without_sponsorship') {
      authorized = true
      authorizationBasis = 'visa_free_bloc'
      matchedBloc = bloc.id
      ruleIds.push(bloc.id)
      reasons.push(
        reason('authorized_bloc', `${bloc.name} lets citizens of your country work in ${destination} without employer sponsorship.`, bloc.id)
      )
    } else if (bloc && bloc.effect === 'residence_route') {
      blocked = true
      matchedBloc = bloc.id
      ruleIds.push(bloc.id)
      reasons.push(
        reason(
          'residence_route_requires_application',
          `${bloc.name} gives a residence route rather than automatic work rights. This needs review before applying.`,
          bloc.id
        )
      )
    }
  }

  const citizenshipRoutes = findBilateralRoutes(destination, citizenships).filter((route) => route.citizenships.length > 0)
  const hasEmployerSupportRoute = citizenshipRoutes.some((route) => route.effect === 'employer_support_required')
  const matchingRoute = citizenshipRoutes.find((route) => route.effect === 'employer_support_required')

  if (authorized) {
    if (job.sponsorSignal === 'citizenship_or_clearance_required') {
      if (hasClearanceRequirement(job.workAuthStatements)) {
        return {
          verdict: 'needs_review',
          reasons: [
            ...reasons,
            reason(
              'clearance_required',
              'This posting requires a security clearance. Clearance status is not stored in your profile, so this needs a human decision.',
              undefined,
              primaryEvidence
            )
          ],
          ruleIds,
          authorizationBasis,
          matchedBloc,
          requiresSponsorship: false,
          sponsorSignal: job.sponsorSignal
        }
      }
      reasons.push(reason('citizenship_requirement_met', 'The posting restricts applications by citizenship, and you meet that requirement.'))
    } else if (job.sponsorSignal === 'sponsorship_not_offered' || job.sponsorSignal === 'existing_right_to_work_required') {
      reasons.push(
        reason(
          'right_to_work_met',
          'The posting requires existing work authorization, and your profile shows you have it.',
          undefined,
          primaryEvidence
        )
      )
    }
    return {
      verdict: 'eligible',
      reasons,
      ruleIds,
      authorizationBasis,
      matchedBloc,
      requiresSponsorship: false,
      sponsorSignal: job.sponsorSignal
    }
  }

  const requiresSponsorship = true

  if (hasClearanceRequirement(job.workAuthStatements)) {
    return {
      verdict: 'ineligible',
      reasons: [
        ...reasons,
        reason(
          'clearance_without_authorization',
          'This role requires a security clearance tied to a country where you are not a citizen.',
          undefined,
          primaryEvidence
        )
      ],
      ruleIds,
      authorizationBasis: 'sponsorship_required',
      matchedBloc,
      requiresSponsorship,
      sponsorSignal: job.sponsorSignal
    }
  }

  switch (job.sponsorSignal) {
    case 'sponsorship_offered':
      if (hasEmployerSupportRoute && matchingRoute) {
        ruleIds.push(matchingRoute.id)
        matchedBloc = matchingRoute.id
      }
      return {
        verdict: 'eligible_needs_sponsorship_offered',
        reasons: [
          ...reasons,
          reason(
            'sponsorship_offered',
            matchingRoute
              ? `You are not authorized in ${destination}, but the employer offers sponsorship and you may qualify through ${matchingRoute.name}.`
              : `You are not authorized in ${destination}, and the employer explicitly offers sponsorship.`,
            matchingRoute?.id,
            primaryEvidence
          )
        ],
        ruleIds,
        authorizationBasis: matchingRoute ? 'bilateral_route' : 'sponsorship_required',
        matchedBloc,
        requiresSponsorship,
        sponsorSignal: job.sponsorSignal
      }

    case 'sponsorship_not_offered':
      return {
        verdict: 'ineligible',
        reasons: [
          ...reasons,
          reason(
            'sponsorship_not_offered',
            `You are not authorized to work in ${destination}, and the posting explicitly says sponsorship is not offered.`,
            undefined,
            primaryEvidence
          )
        ],
        ruleIds,
        authorizationBasis: 'none',
        matchedBloc,
        requiresSponsorship,
        sponsorSignal: job.sponsorSignal
      }

    case 'existing_right_to_work_required':
      return {
        verdict: 'ineligible',
        reasons: [
          ...reasons,
          reason(
            'existing_right_to_work_missing',
            `The posting requires an existing right to work in ${destination}, which your profile does not show.`,
            undefined,
            primaryEvidence
          )
        ],
        ruleIds,
        authorizationBasis: 'none',
        matchedBloc,
        requiresSponsorship,
        sponsorSignal: job.sponsorSignal
      }

    case 'citizenship_or_clearance_required':
      return {
        verdict: 'ineligible',
        reasons: [
          ...reasons,
          reason(
            'citizenship_requirement_not_met',
            `The posting requires citizenship or clearance you do not hold for ${destination}.`,
            undefined,
            primaryEvidence
          )
        ],
        ruleIds,
        authorizationBasis: 'none',
        matchedBloc,
        requiresSponsorship,
        sponsorSignal: job.sponsorSignal
      }

    case 'unstated':
    default:
      if (hasEmployerSupportRoute && matchingRoute) {
        ruleIds.push(matchingRoute.id)
        return {
          verdict: 'needs_review',
          reasons: [
            ...reasons,
            reason(
              'bilateral_route_requires_employer_support',
              `You may qualify through ${matchingRoute.name}, but the posting does not confirm visa support and this route needs employer action. Review before applying.`,
              matchingRoute.id,
              primaryEvidence
            )
          ],
          ruleIds,
          authorizationBasis: 'bilateral_route',
          matchedBloc: matchingRoute.id,
          requiresSponsorship,
          sponsorSignal: job.sponsorSignal
        }
      }
      return {
        verdict: 'needs_review',
        reasons: [
          ...reasons,
          reason(
            'authorization_unknown',
            `You are not authorized to work in ${destination}, and the posting does not state whether it offers sponsorship. Unknown is not treated as eligible.`
          )
        ],
        ruleIds,
        authorizationBasis: 'none',
        matchedBloc,
        requiresSponsorship,
        sponsorSignal: job.sponsorSignal
      }
  }
}

export function isEligibleVerdict(verdict: EligibilityResult['verdict']): boolean {
  return VERDICT_ELIGIBLE.includes(verdict)
}

export function rulesMetadata(): { version: number; lastVerified: string; disclaimer: string; blocCount: number; routeCount: number } {
  return {
    version: rules.version,
    lastVerified: rules.lastVerified,
    disclaimer: rules.disclaimer,
    blocCount: rules.blocs.length,
    routeCount: rules.bilateralRoutes.length
  }
}
