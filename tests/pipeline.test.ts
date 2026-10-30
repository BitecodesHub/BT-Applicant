import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  computeDedupeKey,
  computeFingerprint,
  normalizeJob,
  repairMojibake,
  stripHtml
} from '@main/pipeline/normalize'
import { extractApplicationEmail, firstEmailInText, parseMailto } from '@main/pipeline/email-extract'
import { detectCountry, detectRemoteType, isWorldwideRemote } from '@main/pipeline/location'
import { parseSalary } from '@main/pipeline/salary'
import { decideApplicationRoute, detectAts, routeRequiresCitizenshipAnswer } from '@main/pipeline/routing'
import { scoreJob } from '@main/pipeline/score'
import { getJob } from '@main/db/repos/jobs'
import { createTestContext, seedJob, UNSTATED_SPONSOR, type TestContext } from './helpers'

describe('text normalization', () => {
  it('repairs UTF-8 text decoded as Windows-1252', () => {
    expect(repairMojibake('Weâ€™ve shipped it.')).toBe('We’ve shipped it.')
    expect(repairMojibake('cafÃ©')).toBe('café')
    expect(repairMojibake('naÃ¯ve rÃ©sumÃ©')).toBe('naïve résumé')
  })

  it('leaves clean text, including non-Latin scripts, untouched', () => {
    expect(repairMojibake('We’ve shipped it.')).toBe('We’ve shipped it.')
    expect(repairMojibake('日本語のテキスト')).toBe('日本語のテキスト')
    expect(repairMojibake('plain ascii text')).toBe('plain ascii text')
  })

  it('strips markup and scripts from HTML', () => {
    const text = stripHtml('<html><head><style>p{color:red}</style></head><body><script>alert(1)</script><p>Hello <strong>world</strong></p><p>Second line</p></body></html>')
    expect(text).toContain('Hello world')
    expect(text).toContain('Second line')
    expect(text).not.toContain('alert')
    expect(text).not.toContain('color:red')
  })

  it('builds stable dedupe keys and fingerprints', () => {
    expect(computeDedupeKey('Acme GmbH', 'Senior Backend Engineer', 'DE')).toBe('acme-gmbh|senior backend engineer|DE')
    expect(computeDedupeKey('Acme GmbH', 'Senior Backend Engineer', null)).toBe('acme-gmbh|senior backend engineer|unknown')
    expect(computeFingerprint('Role', 'Company', 'A description')).toBe(computeFingerprint('Role', 'Company', 'A description'))
    expect(computeFingerprint('Role', 'Company', 'A description')).not.toBe(computeFingerprint('Role', 'Company', 'Other'))
  })
})

describe('job normalization', () => {
  it('produces a normalized job with evidence-backed sponsorship and email', () => {
    const { job, sponsor } = normalizeJob(
      {
        externalId: 'raw-1',
        title: 'Senior Backend Engineer',
        company: 'Acme GmbH',
        locationRaw: 'Berlin, Germany',
        descriptionText:
          'Weâ€™ve been growing fast. We sponsor visas for strong candidates. Apply by email to jobs@acme.test with your CV.',
        url: 'https://acme.test/jobs/raw-1',
        applyUrl: null,
        skills: ['TypeScript']
      },
      { sourceId: 'greenhouse-tech', sourceName: 'Greenhouse — tech employers' }
    )

    expect(job.countryCode).toBe('DE')
    expect(job.title).toBe('Senior Backend Engineer')
    expect(job.descriptionText).toContain('We’ve been growing fast')
    expect(job.applicationEmail).toBe('jobs@acme.test')
    expect(job.applicationEmailEvidence).toContain('Apply by email')
    expect(job.skills).toContain('TypeScript')
    expect(sponsor.signal).toBe('sponsorship_offered')
    expect(sponsor.evidence.quote).toContain('sponsor')
    expect(job.remoteType).toBe('unknown')
  })

  it('treats worldwide remote postings as remote', () => {
    const { job } = normalizeJob(
      {
        externalId: 'raw-2',
        title: 'Platform Engineer',
        company: 'Globex',
        locationRaw: 'Remote — Worldwide',
        descriptionText: 'Build reliable platforms from anywhere. Requirements: Kubernetes, Terraform, Go.',
        url: 'https://globex.test/roles/2'
      },
      { sourceId: 'remotive', sourceName: 'Remotive' }
    )
    expect(job.remoteType).toBe('remote')
    expect(job.skills).toEqual(expect.arrayContaining(['Kubernetes', 'Terraform']))
  })

  it('extracts salary ranges only when currency or pay context exists', () => {
    expect(parseSalary('The salary is €90,000 - €120,000 per year.')).toEqual({
      min: 90_000,
      max: 120_000,
      currency: 'EUR',
      period: 'year'
    })
    expect(parseSalary('Compensation: $100k - $150k')).toEqual({
      min: 100_000,
      max: 150_000,
      currency: 'USD',
      period: 'year'
    })
    expect(parseSalary('Team of 12 engineers')).toBeNull()
  })
})

describe('location and remote detection', () => {
  it('resolves city and country aliases', () => {
    expect(detectCountry('Berlin, Germany')).toBe('DE')
    expect(detectCountry('Bengaluru, India')).toBe('IN')
    expect(detectCountry('London, UK')).toBe('GB')
    expect(detectCountry('Remote - US')).toBe('US')
    expect(detectCountry('Somewhere unknown')).toBeNull()
  })

  it('detects remote type and worldwide scope', () => {
    expect(detectRemoteType('Remote (Europe)', 'Backend Engineer')).toBe('remote')
    expect(detectRemoteType('Berlin', 'Hybrid Backend Engineer')).toBe('hybrid')
    expect(detectRemoteType('On-site in Berlin', 'Engineer')).toBe('onsite')
    expect(detectRemoteType('Berlin', 'Engineer')).toBe('unknown')
    expect(isWorldwideRemote('Remote — Worldwide')).toBe(true)
    expect(isWorldwideRemote('Berlin')).toBe(false)
  })
})

describe('application email extraction', () => {
  it('accepts an address only with application context', () => {
    const found = extractApplicationEmail('To apply, send your CV and cover letter to talent@example.com before Friday.')
    expect(found?.email).toBe('talent@example.com')
    expect(found?.evidence).toContain('To apply')
  })

  it('rejects generic addresses without application context', () => {
    expect(extractApplicationEmail('Our office is at 12 Market Street. Facilities: office@example.com')).toBeNull()
  })

  it('rejects no-reply and privacy addresses', () => {
    expect(extractApplicationEmail('Applications are handled by noreply@example.com.')).toBeNull()
    expect(extractApplicationEmail('For privacy requests contact privacy@example.com.')).toBeNull()
  })

  it('rejects explicit do-not-contact instructions', () => {
    expect(extractApplicationEmail('Do not email recruiters@example.com about this role.')).toBeNull()
  })

  it('parses mailto links and finds the first address', () => {
    expect(parseMailto('mailto:jobs@example.com?subject=Application')).toEqual({
      email: 'jobs@example.com',
      subject: 'Application'
    })
    expect(parseMailto('https://example.com')).toBeNull()
    expect(firstEmailInText('Write to talent@example.com today')).toBe('talent@example.com')
  })
})

describe('routing decisions', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  afterEach(() => {
    ctx.close()
  })

  it('uses a published email with quoted evidence', () => {
    const job = getJob(ctx.db, seedJob(ctx.db))!
    const decision = decideApplicationRoute(job)
    expect(decision.channel).toBe('email')
    expect(decision.recipient).toBe('jobs@acme.test')
  })

  it('refuses an email address that lacks evidence', () => {
    const job = getJob(
      ctx.db,
      seedJob(ctx.db, {
        applicationEmail: 'jobs@acme.test',
        applicationEmailEvidence: null,
        applyUrl: null
      })
    )!
    const decision = decideApplicationRoute(job)
    expect(decision.channel).toBe('manual')
  })

  it('routes ATS application URLs to the web channel', () => {
    const job = getJob(
      ctx.db,
      seedJob(ctx.db, {
        externalId: 'ext-ats',
        applicationEmail: null,
        applicationEmailEvidence: null,
        applyUrl: 'https://boards.greenhouse.io/acme/jobs/123'
      })
    )!
    const decision = decideApplicationRoute(job)
    expect(decision.channel).toBe('web')
    expect((decision.evidence as { atsProvider?: string }).atsProvider).toBe('greenhouse')
    expect(detectAts('https://jobs.lever.co/acme/123')?.label).toBe('Lever')
  })

  it('falls back to manual when no destination exists', () => {
    const job = getJob(
      ctx.db,
      seedJob(ctx.db, {
        externalId: 'ext-manual',
        applicationEmail: null,
        applicationEmailEvidence: null,
        url: 'not-a-url'
      })
    )!
    expect(decideApplicationRoute(job).channel).toBe('manual')
  })

  it('flags citizenship-gated postings', () => {
    const job = getJob(
      ctx.db,
      seedJob(ctx.db, {
        externalId: 'ext-citizen',
        sponsor: { ...UNSTATED_SPONSOR, signal: 'citizenship_or_clearance_required', quote: 'US citizens only.' },
        statements: [{ quote: 'US citizens only.', offset: 0, ruleId: 'citizenship.only' }]
      })
    )!
    expect(routeRequiresCitizenshipAnswer(job)).toBe(true)
  })
})

describe('job scoring', () => {
  const job = {
    title: 'Senior Backend Engineer',
    descriptionText:
      'We are hiring a senior backend engineer to build reliable TypeScript services with Node.js, PostgreSQL and AWS. '.repeat(4),
    countryCode: 'DE',
    remoteType: 'remote' as const,
    salaryMin: 95_000,
    salaryMax: 120_000,
    postedAt: Date.now() - 2 * 86_400_000,
    skills: ['TypeScript', 'Node.js', 'PostgreSQL'],
    applicationEmail: 'jobs@acme.test',
    applyUrl: null
  }

  it('rewards a strong match', () => {
    const score = scoreJob(
      job,
      { countryCode: 'DE', jobTitles: ['Senior Backend Engineer'], minSalary: 90_000, currency: 'EUR', remotePreference: 'remote' },
      { skills: ['TypeScript', 'Node.js', 'PostgreSQL'], yearsExperience: 6 },
      'ats'
    )
    expect(score.titleMatch).toBe(30)
    expect(score.skillMatch).toBe(30)
    expect(score.locationFit).toBe(15)
    expect(score.salaryFit).toBe(10)
    expect(score.penalties).toBe(0)
    expect(score.total).toBeGreaterThanOrEqual(90)
    expect(score.notes.length).toBeGreaterThan(0)
  })

  it('penalizes a missing application destination and short descriptions', () => {
    const score = scoreJob(
      { ...job, descriptionText: 'Short post.', skills: [], applicationEmail: null, applyUrl: null },
      null,
      { skills: [], yearsExperience: null },
      'generic'
    )
    expect(score.penalties).toBe(-25)
    expect(score.total).toBeLessThan(50)
  })

  it('penalizes a country mismatch', () => {
    const score = scoreJob(
      job,
      { countryCode: 'IN', jobTitles: ['Senior Backend Engineer'], minSalary: null, currency: null, remotePreference: 'any' },
      { skills: ['TypeScript'], yearsExperience: 6 },
      'ats'
    )
    expect(score.locationFit).toBe(0)
  })
})
