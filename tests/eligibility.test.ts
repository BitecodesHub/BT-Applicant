import { describe, expect, it } from 'vitest'
import { evaluateEligibility, isEligibleVerdict, rulesMetadata } from '@main/eligibility/engine'
import type { EligibilityCandidate, EligibilityJob } from '@main/eligibility/engine'
import type { SponsorshipSignal, WorkAuthStatement } from '@shared/types'

const TODAY = '2026-10-29'

function job(
  countryCode: string | null,
  sponsorSignal: SponsorshipSignal = 'unstated',
  statements: WorkAuthStatement[] = []
): EligibilityJob {
  return { countryCode, sponsorSignal, workAuthStatements: statements }
}

function candidate(overrides: Partial<EligibilityCandidate> = {}): EligibilityCandidate {
  return { citizenships: ['IN'], residenceCountry: 'IN', authorizations: [], ...overrides }
}

function codes(result: ReturnType<typeof evaluateEligibility>): string[] {
  return result.reasons.map((reason) => reason.code)
}

describe('eligibility engine', () => {
  it('treats citizenship of the destination as sufficient', () => {
    const result = evaluateEligibility(job('DE'), candidate({ citizenships: ['DE'], residenceCountry: 'DE' }), TODAY)
    expect(result.verdict).toBe('eligible')
    expect(result.authorizationBasis).toBe('citizenship')
    expect(result.requiresSponsorship).toBe(false)
  })

  it('allows EU/EEA free movement across the bloc', () => {
    const result = evaluateEligibility(job('FR'), candidate({ citizenships: ['DE'], residenceCountry: 'DE' }), TODAY)
    expect(result.verdict).toBe('eligible')
    expect(result.authorizationBasis).toBe('visa_free_bloc')
    expect(result.matchedBloc).toBe('eu-eea-ch')
  })

  it('handles the UK–Ireland common travel area', () => {
    const result = evaluateEligibility(job('IE'), candidate({ citizenships: ['GB'], residenceCountry: 'GB' }), TODAY)
    expect(result.verdict).toBe('eligible')
    expect(result.matchedBloc).toBe('uk-ie-cta')
  })

  it('handles trans-Tasman work rights', () => {
    const result = evaluateEligibility(job('NZ'), candidate({ citizenships: ['AU'], residenceCountry: 'AU' }), TODAY)
    expect(result.verdict).toBe('eligible')
    expect(result.matchedBloc).toBe('trans-tasman')
  })

  it('never treats an unknown country as eligible', () => {
    const result = evaluateEligibility(job(null), candidate(), TODAY)
    expect(result.verdict).toBe('needs_review')
    expect(codes(result)).toContain('country_unknown')
  })

  it('never treats missing citizenship as eligible', () => {
    const result = evaluateEligibility(job('DE'), candidate({ citizenships: [] }), TODAY)
    expect(result.verdict).toBe('needs_review')
    expect(codes(result)).toContain('citizenship_missing')
  })

  it('keeps unstated sponsorship at needs_review rather than guessing', () => {
    const result = evaluateEligibility(job('DE'), candidate(), TODAY)
    expect(result.verdict).toBe('needs_review')
    expect(result.requiresSponsorship).toBe(true)
    expect(codes(result)).toContain('authorization_unknown')
    expect(isEligibleVerdict(result.verdict)).toBe(false)
  })

  it('accepts an explicit sponsorship offer', () => {
    const result = evaluateEligibility(job('DE', 'sponsorship_offered'), candidate(), TODAY)
    expect(result.verdict).toBe('eligible_needs_sponsorship_offered')
    expect(result.requiresSponsorship).toBe(true)
    expect(codes(result)).toContain('sponsorship_offered')
    expect(isEligibleVerdict(result.verdict)).toBe(true)
  })

  it('rejects an explicit refusal to sponsor', () => {
    const result = evaluateEligibility(job('DE', 'sponsorship_not_offered'), candidate(), TODAY)
    expect(result.verdict).toBe('ineligible')
    expect(codes(result)).toContain('sponsorship_not_offered')
  })

  it('rejects postings that require existing work authorization', () => {
    const result = evaluateEligibility(job('GB', 'existing_right_to_work_required'), candidate(), TODAY)
    expect(result.verdict).toBe('ineligible')
    expect(codes(result)).toContain('existing_right_to_work_missing')
  })

  it('rejects a citizenship-only requirement the candidate does not meet', () => {
    const result = evaluateEligibility(job('US', 'citizenship_or_clearance_required'), candidate(), TODAY)
    expect(result.verdict).toBe('ineligible')
    expect(codes(result)).toContain('citizenship_requirement_not_met')
  })

  it('routes clearance requirements to human review even for citizens', () => {
    const statements: WorkAuthStatement[] = [
      { quote: 'Applicants must hold an active security clearance.', offset: 0, ruleId: 'clearance.required' }
    ]
    const result = evaluateEligibility(
      job('US', 'citizenship_or_clearance_required', statements),
      candidate({ citizenships: ['US'], residenceCountry: 'US' }),
      TODAY
    )
    expect(result.verdict).toBe('needs_review')
    expect(codes(result)).toContain('clearance_required')
  })

  it('rejects clearance roles for non-citizens', () => {
    const statements: WorkAuthStatement[] = [
      { quote: 'Applicants must hold an active security clearance.', offset: 0, ruleId: 'clearance.sc' }
    ]
    const result = evaluateEligibility(job('US', 'citizenship_or_clearance_required', statements), candidate(), TODAY)
    expect(result.verdict).toBe('ineligible')
    expect(codes(result)).toContain('clearance_without_authorization')
  })

  it('recognizes a valid work permit', () => {
    const result = evaluateEligibility(
      job('DE'),
      candidate({
        authorizations: [
          { countryCode: 'DE', status: 'work_permit', validUntil: '2027-06-30', needsSponsorship: false }
        ]
      }),
      TODAY
    )
    expect(result.verdict).toBe('eligible')
    expect(result.authorizationBasis).toBe('permit')
  })

  it('does not treat an expired permit as authorization', () => {
    const result = evaluateEligibility(
      job('DE'),
      candidate({
        authorizations: [
          { countryCode: 'DE', status: 'work_permit', validUntil: '2025-12-31', needsSponsorship: false }
        ]
      }),
      TODAY
    )
    expect(result.verdict).toBe('needs_review')
    expect(codes(result)).toContain('permit_expired')
    expect(isEligibleVerdict(result.verdict)).toBe(false)
  })

  it('blocks student and dependent permits pending confirmation', () => {
    for (const status of ['student_permit', 'dependent_permit'] as const) {
      const result = evaluateEligibility(
        job('DE'),
        candidate({
          authorizations: [{ countryCode: 'DE', status, validUntil: null, needsSponsorship: false }]
        }),
        TODAY
      )
      expect(result.verdict).toBe('needs_review')
      expect(codes(result)).toContain('permit_restricted')
    }
  })

  it('recognizes permanent residence', () => {
    const result = evaluateEligibility(
      job('CA'),
      candidate({
        authorizations: [
          { countryCode: 'CA', status: 'permanent_resident', validUntil: null, needsSponsorship: false }
        ]
      }),
      TODAY
    )
    expect(result.verdict).toBe('eligible')
    expect(result.authorizationBasis).toBe('permanent_residence')
  })

  it('sends residence-route blocs to review instead of auto-approving', () => {
    const result = evaluateEligibility(
      job('AE'),
      candidate({ citizenships: ['SA'], residenceCountry: 'SA' }),
      TODAY
    )
    expect(result.verdict).toBe('needs_review')
    expect(codes(result)).toContain('residence_route_requires_application')
    expect(result.matchedBloc).toBe('gcc')
  })

  it('identifies bilateral employer-support routes without treating them as automatic', () => {
    const unstated = evaluateEligibility(
      job('US'),
      candidate({ citizenships: ['CA'], residenceCountry: 'CA' }),
      TODAY
    )
    expect(unstated.verdict).toBe('needs_review')
    expect(codes(unstated)).toContain('bilateral_route_requires_employer_support')
    expect(unstated.ruleIds).toContain('us-tn')

    const offered = evaluateEligibility(
      job('US', 'sponsorship_offered'),
      candidate({ citizenships: ['CA'], residenceCountry: 'CA' }),
      TODAY
    )
    expect(offered.verdict).toBe('eligible_needs_sponsorship_offered')
    expect(offered.ruleIds).toContain('us-tn')
    expect(offered.authorizationBasis).toBe('bilateral_route')
  })

  it('exports verified rules metadata', () => {
    const meta = rulesMetadata()
    expect(meta.version).toBeGreaterThanOrEqual(1)
    expect(meta.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(meta.blocCount).toBeGreaterThan(0)
    expect(meta.routeCount).toBeGreaterThan(0)
    expect(meta.disclaimer).toContain('not legal advice')
  })
})
