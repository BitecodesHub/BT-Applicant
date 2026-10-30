import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { addResume, setDefaultResume, upsertTargetCountry, profileFingerprint } from '@main/db/repos/profile'
import { effectiveRoleTitles, listRoleSelections } from '@main/db/repos/roles'
import { saveResumeExtraction } from '@main/db/repos/resume-extractions'
import { parseResumeText } from '@main/resume/parse'
import { recommendRoles, roleSelectionPage, saveRoleSelections } from '@main/services/roles'
import { createTestContext, seedJob, seedProfile } from './helpers'

const RESUME_TEXT = `Jordan Vale
Platform Engineer
jordan.vale@example.com | +49 30 1234 5678 | Berlin, Germany

Summary
Platform engineer building self-service infrastructure for product teams.

Skills
Kubernetes, Terraform, AWS, Go, Docker, CI/CD, Python, Linux, Prometheus, Grafana

Experience
Senior Platform Engineer | Northwind Cloud | Berlin, Germany
Jan 2021 – Present
- Built the internal developer platform used by 120 engineers.
- Operated Kubernetes clusters across three regions.

Education
BSc Computer Science | Technical University of Munich | 2014 – 2017

Certifications
AWS Certified Solutions Architect — Amazon Web Services, 2022
Certified Kubernetes Administrator (CKA) — Cloud Native Computing Foundation, 2021
`

function seedResumeEvidence(db: ReturnType<typeof createTestContext>['db'], dir: string): number {
  const path = join(dir, 'jordan-platform.txt')
  writeFileSync(path, RESUME_TEXT)
  const resume = addResume(db, {
    label: 'Jordan platform resume',
    fileName: 'jordan-platform.txt',
    storedPath: path,
    mimeType: 'text/plain',
    sizeBytes: RESUME_TEXT.length,
    sha256: 'roles-resume-sha',
    notes: null
  })
  const parsed = parseResumeText(RESUME_TEXT)
  saveResumeExtraction(db, {
    resumeId: resume.id,
    parserVersion: '1',
    text: RESUME_TEXT,
    textChars: RESUME_TEXT.length,
    data: parsed.data,
    confidence: parsed.confidence,
    warnings: parsed.warnings,
    sectionsFound: parsed.sectionsFound
  })
  setDefaultResume(db, resume.id)
  return resume.id
}

function setVerdict(db: ReturnType<typeof createTestContext>['db'], jobId: number, verdict: string): void {
  db.run(
    `INSERT INTO job_evaluations (job_id, verdict, score, score_breakdown, reasons, rule_ids, authorization_basis,
       matched_bloc, requires_sponsorship, profile_hash, evaluated_at)
     VALUES (?, ?, 60, '{}', '[]', '[]', 'none', NULL, 0, 'test', ?)
     ON CONFLICT(job_id) DO UPDATE SET verdict = excluded.verdict`,
    jobId,
    verdict,
    Date.now()
  )
}

describe('role selection', () => {
  it('starts empty and persists catalog and custom choices', () => {
    const ctx = createTestContext()
    try {
      const initial = roleSelectionPage(ctx.db)
      expect(initial.effectiveTitles).toEqual([])
      expect(initial.catalog.every((role) => !role.selected)).toBe(true)

      const saved = saveRoleSelections(ctx.db, {
        selectedKeys: ['platform_engineer', 'site_reliability_engineer'],
        customTitles: ['Developer Productivity Lead']
      })
      expect(saved.catalog.filter((role) => role.selected)).toHaveLength(2)
      expect(saved.customSelections.map((item) => item.title)).toEqual(['Developer Productivity Lead'])
      expect(saved.effectiveTitles).toEqual(expect.arrayContaining(['Platform Engineer', 'SRE', 'Site Reliability Engineer', 'Developer Productivity Lead']))
      expect(listRoleSelections(ctx.db)).toHaveLength(3)
    } finally {
      ctx.close()
    }
  })

  it('maps a custom title that matches a catalog alias onto the catalog role', () => {
    const ctx = createTestContext()
    try {
      const saved = saveRoleSelections(ctx.db, { selectedKeys: [], customTitles: ['SRE'] })
      expect(saved.customSelections).toEqual([])
      expect(saved.catalog.find((role) => role.key === 'site_reliability_engineer')?.selected).toBe(true)
    } finally {
      ctx.close()
    }
  })

  it('rejects unknown keys and more than eight roles', () => {
    const ctx = createTestContext()
    try {
      expect(() => saveRoleSelections(ctx.db, { selectedKeys: ['not_a_role'], customTitles: [] })).toThrow(/Unknown role/)
      expect(() =>
        saveRoleSelections(ctx.db, {
          selectedKeys: roleSelectionPage(ctx.db).catalog.slice(0, 9).map((role) => role.key),
          customTitles: []
        })
      ).toThrow(/at most 8/i)
    } finally {
      ctx.close()
    }
  })

  it('changes the profile fingerprint so saved evaluations are recalculated', () => {
    const ctx = createTestContext()
    try {
      seedProfile(ctx.db)
      const before = profileFingerprint(ctx.db)
      saveRoleSelections(ctx.db, { selectedKeys: ['platform_engineer'], customTitles: [] })
      expect(profileFingerprint(ctx.db)).not.toBe(before)
      expect(effectiveRoleTitles(ctx.db)).toContain('DevEx Engineer')
    } finally {
      ctx.close()
    }
  })
})

describe('role recommendations', () => {
  it('ranks the catalog from resume evidence and discovered market jobs', () => {
    const ctx = createTestContext()
    try {
      seedProfile(ctx.db, {
        fullName: 'Jordan Vale',
        email: 'jordan.vale@example.com',
        yearsExperience: 8,
        skills: ['Kubernetes', 'Terraform', 'AWS'],
        languages: []
      })
      seedResumeEvidence(ctx.db, ctx.dir)
      upsertTargetCountry(ctx.db, {
        countryCode: 'DE',
        enabled: true,
        remotePreference: 'any',
        employmentTypes: ['full_time'],
        jobTitles: ['Platform Engineer'],
        keywords: [],
        excludeKeywords: [],
        minSalary: null,
        currency: 'EUR',
        seniority: [],
        scheduleCron: '0 8 * * *',
        timezone: 'Europe/Berlin',
        sources: []
      })

      for (let index = 0; index < 5; index += 1) {
        const jobId = seedJob(ctx.db, {
          externalId: `sre-${index}`,
          title: 'Site Reliability Engineer',
          company: `Reliable ${index}`,
          dedupeKey: `reliable-${index}|sre|de`,
          fingerprint: `sre-${index}`
        })
        setVerdict(ctx.db, jobId, index < 3 ? 'eligible' : 'needs_review')
      }
      const designerJob = seedJob(ctx.db, {
        externalId: 'design-1',
        title: 'Product Designer',
        company: 'Design Co',
        dedupeKey: 'design|product-designer|de',
        fingerprint: 'design-1'
      })
      setVerdict(ctx.db, designerJob, 'eligible')

      const result = recommendRoles(ctx.db)
      expect(result.usedProfileOnly).toBe(false)
      expect(result.resumeLabel).toBe('Jordan platform resume')
      expect(result.recommendations).toHaveLength(8)

      const sre = result.recommendations.find((item) => item.key === 'site_reliability_engineer')!
      const platform = result.recommendations.find((item) => item.key === 'platform_engineer')!
      const designer = result.recommendations.find((item) => item.key === 'product_designer')
      expect(sre.market.activeJobs).toBe(5)
      expect(sre.market.evaluatedJobs).toBe(5)
      expect(sre.market.eligibleJobs).toBe(3)
      expect(sre.score).toBeGreaterThanOrEqual(platform.score - 5)
      expect(sre.matchedSkills).toEqual(expect.arrayContaining(['Kubernetes', 'Prometheus', 'Terraform']))
      expect(sre.evidence.join(' ')).toContain('active')
      expect(sre.confidence).toBeGreaterThan(60)
      if (designer) expect(designer.score).toBeLessThan(platform.score)
    } finally {
      ctx.close()
    }
  })

  it('falls back to profile-only evidence and explains the lower confidence', () => {
    const ctx = createTestContext()
    try {
      seedProfile(ctx.db, {
        fullName: 'Profile Only',
        email: 'profile@example.com',
        yearsExperience: 4,
        skills: ['React', 'TypeScript', 'CSS'],
        languages: []
      })
      const result = recommendRoles(ctx.db)
      expect(result.usedProfileOnly).toBe(true)
      expect(result.resumeId).toBeNull()
      expect(result.recommendations[0]?.confidence).toBeLessThan(70)
      expect(result.recommendations[0]?.evidence.join(' ')).toMatch(/No work titles|No close title match|active/i)
    } finally {
      ctx.close()
    }
  })
})
