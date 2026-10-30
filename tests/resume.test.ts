import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { extractResumeText, ResumeTextError } from '@main/resume/text'
import { parseResumeText } from '@main/resume/parse'
import { analyzeStoredResume, importResumeIntoProfile } from '@main/services/resume'
import { addResume, getProfile, setDefaultResume } from '@main/db/repos/profile'
import { getResumeExtraction, saveResumeExtraction } from '@main/db/repos/resume-extractions'
import { createTestContext, seedProfile } from './helpers'

const RICH_RESUME = `Jordan Vale
Platform Engineer
jordan.vale@example.com | +49 30 1234 5678 | Berlin, Germany | linkedin.com/in/jordanvale | github.com/jordanvale

Summary
Platform engineer with nine years building reliable internal infrastructure and developer tooling for product teams.

Skills
Kubernetes, Terraform, AWS, Go, Docker, CI/CD, Python, Linux, Prometheus, Grafana

Experience
Senior Platform Engineer | Northwind Cloud | Berlin, Germany
Jan 2021 – Present
- Built the internal developer platform used by 120 engineers.
- Cut deployment lead time from 45 minutes to 6 minutes with Terraform and GitHub Actions.
- Operated Kubernetes clusters across three regions.

DevOps Engineer | Cloudline | Munich, Germany
Mar 2018 – Dec 2020
- Automated release pipelines and infrastructure with Terraform.
- Ran Prometheus and Grafana observability for 40 services.

Education
BSc Computer Science | Technical University of Munich | 2014 – 2017

Certifications
AWS Certified Solutions Architect — Amazon Web Services, 2022
Certified Kubernetes Administrator (CKA) — Cloud Native Computing Foundation, 2021

Languages
English (Native), German (B2)

Projects
Developer portal | TypeScript, Kubernetes
- Built a self-service portal used by 120 engineers.
CLI tool — Python
- Automated release checks for every service.

Awards
Engineering Excellence Award — Northwind Cloud, 2023
`

function makePdf(lines: string[]): Uint8Array {
  const content = ['BT', '/F1 12 Tf', '72 720 Td', ...lines.flatMap((line, index) => [index === 0 ? '0 0 Td' : '0 -18 Td', `(${line.replace(/([()\\])/g, '\\$1')}) Tj`]), 'ET'].join('\n')
  const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length ${Buffer.byteLength(content)} >> stream
${content}
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
trailer << /Root 1 0 R >>
%%EOF`
  return new Uint8Array(Buffer.from(pdf, 'utf8'))
}

function makeDocx(paragraphs: string[]): Uint8Array {
  const body = paragraphs
    .map((text) => `<w:p><w:r><w:t xml:space="preserve">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`)
    .join('')
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
  return zipSync({ 'word/document.xml': strToU8(xml) })
}

describe('resume text extraction', () => {
  it('reads plain text and Markdown', async () => {
    const plain = await extractResumeText(new Uint8Array(Buffer.from('Jordan Vale\nPlatform Engineer\n')), '.txt')
    expect(plain.format).toBe('txt')
    expect(plain.text).toContain('Jordan Vale')

    const markdown = await extractResumeText(new Uint8Array(Buffer.from('# Jordan Vale\n\n**Platform Engineer**\n\n- Kubernetes\n')), '.md')
    expect(markdown.text).toContain('Jordan Vale')
    expect(markdown.text).toContain('Kubernetes')
    expect(markdown.text).not.toContain('**')
  })

  it('reads a PDF', async () => {
    const result = await extractResumeText(makePdf(['Jordan Vale', 'Platform Engineer', 'jordan.vale@example.com']), '.pdf')
    expect(result.format).toBe('pdf')
    expect(result.text).toContain('Jordan Vale')
    expect(result.text).toContain('jordan.vale@example.com')
  })

  it('reads a DOCX body without a network or office suite', async () => {
    const result = await extractResumeText(makeDocx(['Jordan Vale', 'Platform Engineer', 'Kubernetes and Terraform']), '.docx')
    expect(result.format).toBe('docx')
    expect(result.text).toContain('Jordan Vale')
    expect(result.text).toContain('Kubernetes and Terraform')
  })

  it('reads RTF control words and escapes', async () => {
    const rtf = String.raw`{\rtf1\ansi\deff0 {\fonttbl{\f0 Helvetica;}}\f0\fs24 Jordan Vale\par Platform Engineer\par Kubernetes\tab Terraform\par}`
    const result = await extractResumeText(new Uint8Array(Buffer.from(rtf)), '.rtf')
    expect(result.text).toContain('Jordan Vale')
    expect(result.text).toContain('Platform Engineer')
    expect(result.text).toContain('Kubernetes')
  })

  it('rejects legacy .doc files and empty documents with a clear message', async () => {
    await expect(extractResumeText(new Uint8Array(Buffer.from('binary')), '.doc')).rejects.toBeInstanceOf(ResumeTextError)
    await expect(extractResumeText(new Uint8Array(Buffer.from('   \n  ')), '.txt')).rejects.toThrow(/No readable text/i)
  })
})

describe('deterministic resume parsing', () => {
  const parsed = parseResumeText(RICH_RESUME)

  it('extracts identity, contact details, and a summary', () => {
    expect(parsed.data.name).toBe('Jordan Vale')
    expect(parsed.data.headline).toBe('Platform Engineer')
    expect(parsed.data.email).toBe('jordan.vale@example.com')
    expect(parsed.data.phone).toBe('+49 30 1234 5678')
    expect(parsed.data.location).toBe('Berlin, Germany')
    expect(parsed.data.linkedin).toBe('https://linkedin.com/in/jordanvale')
    expect(parsed.data.github).toBe('https://github.com/jordanvale')
    expect(parsed.data.summary).toContain('Platform engineer')
  })

  it('extracts and canonicalises skills without duplicates', () => {
    expect(parsed.data.skills).toEqual(expect.arrayContaining(['Kubernetes', 'Terraform', 'AWS']))
    expect(new Set(parsed.data.skills).size).toBe(parsed.data.skills.length)
  })

  it('extracts dated roles, companies, bullets, and total experience', () => {
    expect(parsed.data.experience).toHaveLength(2)
    const current = parsed.data.experience[0]!
    expect(current.title).toBe('Senior Platform Engineer')
    expect(current.company).toBe('Northwind Cloud')
    expect(current.location).toBe('Berlin, Germany')
    expect(current.startDate).toBe('2021-01')
    expect(current.current).toBe(true)
    expect(current.bullets.length).toBeGreaterThanOrEqual(2)
    expect(current.technologies).toEqual(expect.arrayContaining(['Terraform']))
    expect(parsed.data.experience[1]!.title).toBe('DevOps Engineer')
    expect(parsed.data.experience[1]!.endDate).toBe('2020-12')
    expect(parsed.data.yearsExperience).toBeGreaterThan(7)
    expect(parsed.data.yearsExperience).toBeLessThan(11)
  })

  it('extracts education, certifications, languages, and confidence', () => {
    expect(parsed.data.education.length).toBeGreaterThan(0)
    expect(parsed.data.education[0]!.degree).toContain('BSc')
    expect(parsed.data.education[0]!.institution).toContain('Technical University')
    expect(parsed.data.certifications.map((item) => item.name).join(' ')).toContain('Kubernetes')
    expect(parsed.data.certifications.map((item) => item.year)).toEqual(expect.arrayContaining([2021, 2022]))
    expect(parsed.data.languages).toEqual(
      expect.arrayContaining([
        { language: 'English', level: 'Native' },
        { language: 'German', level: 'Professional' }
      ])
    )
    expect(parsed.sectionsFound).toEqual(expect.arrayContaining(['summary', 'skills', 'experience', 'education', 'certifications', 'languages']))
    expect(parsed.confidence).toBeGreaterThanOrEqual(60)
  })

  it('extracts projects and awards from their sections', () => {
    expect(parsed.data.projects).toHaveLength(2)
    expect(parsed.data.projects[0]!.name).toBe('Developer portal')
    expect(parsed.data.projects[0]!.detail).toContain('Kubernetes — Built a self-service portal')
    expect(parsed.data.projects[0]!.technologies).toEqual(expect.arrayContaining(['Kubernetes']))
    expect(parsed.data.projects[1]!.name).toBe('CLI tool')
    expect(parsed.data.projects[1]!.technologies).toEqual(expect.arrayContaining(['Python']))
    expect(parsed.data.awards[0]).toContain('Engineering Excellence Award')
    expect(parsed.sectionsFound).toEqual(expect.arrayContaining(['projects', 'awards']))
  })

  it('finds contact details outside a header line and flags missing evidence', () => {
    const sparse = parseResumeText('Jordan Vale\n\nExperience\nSome work without dates.\n\nContact\njordan@example.com\n')
    expect(sparse.data.email).toBe('jordan@example.com')
    expect(sparse.warnings.join(' ')).toMatch(/No dated work experience/i)
  })
})

describe('stored resume analysis and import', () => {
  it('stores extraction results for a managed text resume', async () => {
    const ctx = createTestContext()
    try {
      const path = join(ctx.dir, 'jordan-resume.txt')
      writeFileSync(path, RICH_RESUME)
      const resume = addResume(ctx.db, {
        label: 'Jordan resume',
        fileName: 'jordan-resume.txt',
        storedPath: path,
        mimeType: 'text/plain',
        sizeBytes: Buffer.byteLength(RICH_RESUME),
        sha256: 'resume-txt-sha',
        notes: null
      })
      const extraction = await analyzeStoredResume(ctx.db, resume.id)
      expect(extraction.data.name).toBe('Jordan Vale')
      expect(extraction.textChars).toBeGreaterThan(300)
      expect(getResumeExtraction(ctx.db, resume.id)?.data.skills.length).toBeGreaterThan(5)

      const stored = saveResumeExtraction(ctx.db, {
        resumeId: resume.id,
        parserVersion: '2',
        text: RICH_RESUME,
        textChars: RICH_RESUME.length,
        data: extraction.data,
        confidence: extraction.confidence,
        warnings: [],
        sectionsFound: extraction.sectionsFound
      })
      expect(stored.extractedAt).toBeGreaterThan(0)
    } finally {
      ctx.close()
    }
  })

  it('fills blanks and merges lists without overwriting existing profile values', () => {
    const ctx = createTestContext()
    try {
      seedProfile(ctx.db, {
        fullName: 'Existing Name',
        email: 'existing@example.com',
        phone: null,
        city: null,
        summary: null,
        yearsExperience: 6,
        skills: ['Kubernetes'],
        languages: []
      })
      const path = join(ctx.dir, 'merge-resume.txt')
      writeFileSync(path, RICH_RESUME)
      const resume = addResume(ctx.db, {
        label: 'Merge resume',
        fileName: 'merge-resume.txt',
        storedPath: path,
        mimeType: 'text/plain',
        sizeBytes: RICH_RESUME.length,
        sha256: 'merge-sha',
        notes: null
      })
      setDefaultResume(ctx.db, resume.id)
      const parsed = parseResumeText(RICH_RESUME)
      saveResumeExtraction(ctx.db, {
        resumeId: resume.id,
        parserVersion: '2',
        text: RICH_RESUME,
        textChars: RICH_RESUME.length,
        data: parsed.data,
        confidence: parsed.confidence,
        warnings: parsed.warnings,
        sectionsFound: parsed.sectionsFound
      })

      const result = importResumeIntoProfile(ctx.db, resume.id)
      expect(result.profile.fullName).toBe('Existing Name')
      expect(result.profile.email).toBe('existing@example.com')
      expect(result.profile.phone).toBe('+49 30 1234 5678')
      expect(result.profile.city).toBe('Berlin')
      expect(result.profile.yearsExperience).toBe(6)
      expect(result.profile.skills).toEqual(expect.arrayContaining(['Kubernetes', 'Terraform', 'AWS']))
      expect(new Set(result.profile.skills.map((skill) => skill.toLowerCase())).size).toBe(result.profile.skills.length)
      expect(result.profile.languages.length).toBe(2)
      expect(result.keptExisting).toEqual(expect.arrayContaining(['Full name', 'Email', 'Years of experience']))
      expect(result.imported).toEqual(expect.arrayContaining(['Phone', 'City']))
    } finally {
      ctx.close()
    }
  })

  it('imports into an empty profile including years of experience', () => {
    const ctx = createTestContext()
    try {
      const path = join(ctx.dir, 'empty-profile-resume.txt')
      writeFileSync(path, RICH_RESUME)
      const resume = addResume(ctx.db, {
        label: 'Fresh resume',
        fileName: 'fresh-resume.txt',
        storedPath: path,
        mimeType: 'text/plain',
        sizeBytes: RICH_RESUME.length,
        sha256: 'fresh-sha',
        notes: null
      })
      const parsed = parseResumeText(RICH_RESUME)
      saveResumeExtraction(ctx.db, {
        resumeId: resume.id,
        parserVersion: '2',
        text: RICH_RESUME,
        textChars: RICH_RESUME.length,
        data: parsed.data,
        confidence: parsed.confidence,
        warnings: [],
        sectionsFound: parsed.sectionsFound
      })
      const result = importResumeIntoProfile(ctx.db, resume.id)
      expect(getProfile(ctx.db).fullName).toBe('Jordan Vale')
      expect(result.profile.email).toBe('jordan.vale@example.com')
      expect(result.profile.yearsExperience).toBeGreaterThan(7)
    } finally {
      ctx.close()
    }
  })
})
