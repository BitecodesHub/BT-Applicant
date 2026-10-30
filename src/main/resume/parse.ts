import type {
  ResumeCertification,
  ResumeEducation,
  ResumeExperience,
  ResumeExtractedData,
  ResumeLanguage,
  ResumeProject
} from '../../shared/resume'
import { canonicalSkill, extractSkills } from '../pipeline/skills'

export const RESUME_PARSER_VERSION = '2'

export interface ParsedResume {
  data: ResumeExtractedData
  confidence: number
  warnings: string[]
  sectionsFound: string[]
}

type SectionKey = 'summary' | 'skills' | 'experience' | 'education' | 'certifications' | 'languages' | 'projects' | 'awards'

const SECTION_ALIASES: Record<SectionKey, string[]> = {
  summary: ['summary', 'professional summary', 'profile', 'professional profile', 'objective', 'about', 'about me', 'career summary'],
  skills: [
    'skills',
    'technical skills',
    'core skills',
    'key skills',
    'competencies',
    'technical competencies',
    'expertise',
    'technologies',
    'tech stack',
    'tools and technologies'
  ],
  experience: [
    'experience',
    'work experience',
    'professional experience',
    'employment',
    'employment history',
    'work history',
    'career history',
    'relevant experience'
  ],
  education: ['education', 'academic background', 'qualifications', 'education and training'],
  certifications: [
    'certifications',
    'certificates',
    'licenses',
    'licenses and certifications',
    'certifications and licenses',
    'credentials',
    'professional certifications'
  ],
  languages: ['languages', 'language skills'],
  projects: ['projects', 'selected projects', 'personal projects', 'key projects'],
  awards: ['awards', 'honors', 'honours', 'achievements']
}

const HEADING_BY_ALIAS = new Map<string, SectionKey>()
for (const [key, aliases] of Object.entries(SECTION_ALIASES) as [SectionKey, string[]][]) {
  for (const alias of aliases) HEADING_BY_ALIAS.set(alias, key)
}

const ROLE_WORDS =
  /\b(engineer|developer|manager|designer|analyst|consultant|architect|specialist|scientist|writer|recruiter|director|lead|intern|administrator|technician|coordinator|officer|assistant|associate|founder|cto|ceo|coo|vp|president)\b/i

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december'
]
const MONTH_PATTERN = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'
const DATE_TOKEN = `(?:(?:(?:${MONTH_PATTERN})\\.?\\s+)?(?:19|20)\\d{2}|(?:0?[1-9]|1[0-2])/(?:19|20)\\d{2})`
const RANGE_PATTERN = new RegExp(`(${DATE_TOKEN})\\s*(?:-|–|—|to)\\s*(${DATE_TOKEN}|present|current|now)`, 'i')

const INSTITUTION_WORDS = /\b(university|college|institute|school|academy|polytechnic|hochschule)\b/i
const DEGREE_WORDS = /\b(bachelor|master|b\.?\s?sc|m\.?\s?sc|b\.?\s?tech|m\.?\s?tech|b\.?\s?e\.?|m\.?\s?e\.?|mba|ph\.?\s?d|doctorate|diploma|associate degree|degree)\b/i
const CERT_ISSUERS =
  /(amazon|aws|microsoft|azure|google|oracle|cisco|hashicorp|linux foundation|scrum alliance|pmi|isaca|isc2|comptia|meta|apple|databricks|iiba|axelos|peoplecert|red hat|kubernetes|cloud native)/i

const SKILL_NOISE = new Set([
  'proficient',
  'advanced',
  'expert',
  'intermediate',
  'beginner',
  'fluent',
  'native',
  'professional',
  'conversational',
  'basic',
  'tools',
  'technologies',
  'languages',
  'frameworks',
  'databases',
  'platforms',
  'other',
  'miscellaneous'
])

export function parseResumeText(text: string): ParsedResume {
  const lines = text
    .split('\n')
    .map((line) => line.replace(/\u0000/g, '').trim())
    .filter((line) => line.length > 0)

  const sections: Record<SectionKey, string[]> = {
    summary: [],
    skills: [],
    experience: [],
    education: [],
    certifications: [],
    languages: [],
    projects: [],
    awards: []
  }
  const header: string[] = []
  let current: SectionKey | 'header' = 'header'

  for (const line of lines) {
    const heading = matchHeading(line)
    if (heading) {
      current = heading.key
      if (heading.remainder) sections[current].push(heading.remainder)
      continue
    }
    if (current === 'header') header.push(line)
    else sections[current].push(line)
  }

  const contact = extractContact(header.length > 0 ? header : lines.slice(0, 20), text)
  const name = guessName(header)
  const headline = guessHeadline(header, name)
  const summary = extractSummary(sections.summary, header, name, headline, contact)
  const skills = extractResumeSkills(sections.skills, text)
  const experience = extractExperience(sections.experience)
  const education = extractEducation(sections.education)
  const certifications = extractCertifications(sections.certifications)
  const languages = extractLanguages(sections.languages)
  const projects = extractProjects(sections.projects)
  const awards = extractAwards(sections.awards)
  const yearsExperience = calculateYears(experience)

  const sectionsFound = (Object.keys(sections) as SectionKey[]).filter((key) => sections[key].length > 0)
  const warnings: string[] = []
  if (text.length < 300) {
    warnings.push('Only a small amount of text was read. The document may be short, scanned, or image-heavy.')
  }
  if (!contact.email) warnings.push('No email address was found. Check the file or add the email in your profile.')
  if (skills.length === 0) warnings.push('No skills were recognised. The skills section may use unusual formatting.')
  if (experience.length === 0) warnings.push('No dated work experience was recognised. Bullet formats without dates are not inferred.')
  if (yearsExperience !== null && yearsExperience > 50) warnings.push('The computed experience total is unusually high. Check the extracted date ranges.')
  if (sections.experience.length === 0) warnings.push('No experience heading was found, so work history may be incomplete.')

  const data: ResumeExtractedData = {
    name,
    headline,
    email: contact.email,
    phone: contact.phone,
    location: contact.location,
    linkedin: contact.linkedin,
    github: contact.github,
    website: contact.website,
    summary,
    skills,
    yearsExperience,
    experience,
    education,
    certifications,
    languages,
    projects,
    awards
  }

  const confidence = scoreConfidence(data, header, text)
  return { data, confidence, warnings, sectionsFound }
}

function matchHeading(line: string): { key: SectionKey; remainder: string } | null {
  if (line.length > 90) return null
  const colon = line.indexOf(':')
  const candidate = (colon >= 0 ? line.slice(0, colon) : line)
    .toLowerCase()
    .replace(/^[•*\-–—\s]+/, '')
    .replace(/[:\s]+$/, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*&\s*/g, ' and ')
  const key = HEADING_BY_ALIAS.get(candidate)
  if (!key) return null
  const remainder = colon >= 0 ? line.slice(colon + 1).trim() : ''
  return { key, remainder }
}

interface ContactDetails {
  email: string | null
  phone: string | null
  location: string | null
  linkedin: string | null
  github: string | null
  website: string | null
}

function extractContact(headerLines: string[], fullText: string): ContactDetails {
  const headerText = headerLines.join('\n')
  const fallbackText = fullText.slice(0, 8000)
  const email =
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.exec(headerText)?.[0] ??
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.exec(fallbackText)?.[0] ??
    null

  let phone: string | null = null
  for (const search of [headerText, fallbackText]) {
    for (const match of search.matchAll(/(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d[\d\s.-]{5,}\d/g)) {
      const candidate = match[0].trim()
      const digits = candidate.replace(/\D/g, '')
      if (digits.length < 7 || digits.length > 15) continue
      if (/^(19|20)\d{2}\s*[-–—]\s*(19|20)\d{2}$/.test(candidate)) continue
      phone = candidate.replace(/[ \t]+/g, ' ').trim()
      break
    }
    if (phone) break
  }

  const urls = [headerText, fallbackText]
    .flatMap((search) =>
      [...search.matchAll(/(?:https?:\/\/|www\.)[^\s<>()]+|(?:linkedin|github)\.com\/[^\s<>()]+/gi)].map((match) =>
        cleanUrl(match[0])
      )
    )
  const linkedin = urls.find((url) => /linkedin\.com/i.test(url)) ?? null
  const github = urls.find((url) => /github\.com/i.test(url)) ?? null
  const website = urls.find((url) => url !== linkedin && url !== github) ?? null

  const location = extractLocation(headerLines)
  return { email, phone, location, linkedin, github, website }
}

function cleanUrl(value: string): string {
  const trimmed = value.replace(/[.,;:)\]}]+$/, '')
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed.replace(/^\/+/, '')}`
}

function extractLocation(lines: string[]): string | null {
  for (const line of lines.slice(0, 12)) {
    const parts = line.split(/\s*[|·•]\s*/)
    for (const part of parts) {
      const cleaned = part.replace(/^[•*\-–—\s]+/, '').trim()
      if (isLocation(cleaned)) return cleaned
    }
  }
  return null
}

function isLocation(value: string): boolean {
  if (!value || value.length > 80 || /\d|@|http/i.test(value)) return false
  if (ROLE_WORDS.test(value)) return false
  if (/^remote$/i.test(value)) return true
  const parts = value.split(',').map((part) => part.trim())
  if (parts.length < 2 || parts.length > 3) return false
  return parts.every((part) => /^[\p{L}][\p{L} .'-]{1,39}$/u.test(part))
}

function guessName(header: string[]): string | null {
  for (const line of header.slice(0, 8)) {
    const segments = line.split(/\s*[|·•]\s*/)
    for (const segment of segments) {
      const first = segment.split(/\s+[-–—]\s+/)[0]!.trim()
      if (looksLikeName(first)) return first.replace(/\s+/g, ' ')
    }
  }
  return null
}

function looksLikeName(value: string): boolean {
  if (!value || value.length < 2 || value.length > 60) return false
  if (/[@\d/:]|https?/i.test(value)) return false
  if (ROLE_WORDS.test(value)) return false
  if (/\b(resume|curriculum vitae|cv|profile)\b/i.test(value)) return false
  const words = value.split(/\s+/).filter(Boolean)
  if (words.length < 1 || words.length > 5) return false
  return words.every((word) => /^[\p{L}][\p{L}.'-]*$/u.test(word))
}

function guessHeadline(header: string[], name: string | null): string | null {
  for (const line of header.slice(0, 10)) {
    const segments = line.split(/\s*[|·•]\s*|\s+[-–—]\s+/)
    for (const segment of segments) {
      const cleaned = segment.trim()
      if (!cleaned || cleaned === name || cleaned.length > 100) continue
      if (/[@\d]|https?/i.test(cleaned)) continue
      if (!ROLE_WORDS.test(cleaned)) continue
      if (isLocation(cleaned)) continue
      return cleaned
    }
  }
  return null
}

function extractSummary(
  section: string[],
  header: string[],
  name: string | null,
  headline: string | null,
  contact: ContactDetails
): string | null {
  const fromSection = section
    .map((line) => line.replace(/^[•*\-–—]\s*/, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (fromSection.length > 20) return fromSection.slice(0, 1500)

  const headerText = header
    .filter((line) => line !== name && line !== headline)
    .filter((line) => !contact.email || !line.includes(contact.email))
    .filter((line) => !contact.phone || !line.includes(contact.phone))
    .filter((line) => !/https?|linkedin|github/i.test(line))
    .filter((line) => line.length > 60 && line.split(/\s+/).length > 8)
    .slice(0, 2)
    .join(' ')
  return headerText.length > 20 ? headerText.slice(0, 1500) : null
}

function extractResumeSkills(section: string[], fullText: string): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  const add = (value: string) => {
    const canonical = canonicalSkill(value)
    const label = canonical ?? value.trim()
    if (!label || label.length > 50) return
    const key = label.toLowerCase()
    if (seen.has(key) || SKILL_NOISE.has(key)) return
    seen.add(key)
    found.push(label)
  }

  const raw = section.join('\n')
  for (const token of raw.split(/\n|[,;|•·\t]|\s{2,}|\s+\/\s+/)) {
    const cleaned = token
      .replace(/^[•*\-–—\s]+/, '')
      .replace(/^[A-Za-z ]{2,30}:\s*/, '')
      .trim()
    if (!cleaned || cleaned.length < 2 || cleaned.split(/\s+/).length > 6) continue
    if (!/[\p{L}]/u.test(cleaned)) continue
    add(cleaned)
    if (found.length >= 60) break
  }

  for (const skill of extractSkills(fullText, 80)) {
    add(skill)
    if (found.length >= 60) break
  }
  return found
}

function extractExperience(lines: string[]): ResumeExperience[] {
  const entries: ResumeExperience[] = []
  const used = new Set<number>()
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    const range = RANGE_PATTERN.exec(line)
    if (!range) continue
    const startToken = range[1]!
    const endToken = range[2]!
    const before = line.slice(0, range.index).replace(/^[•*\-–—\s]+/, '').trim()
    const after = line.slice(range.index + range[0].length).replace(/^[•*\-–—|·\s]+/, '').replace(/[|·•,;\s]+$/, '').trim()

    let roleText = before
    const usedLines: number[] = []
    if (!roleText) {
      const previous = previousRoleLines(lines, index, used)
      if (previous.lines.length > 0) {
        roleText = previous.lines.join(' | ')
        usedLines.push(...previous.indexes)
      }
    }
    if (!roleText && after) roleText = after
    if (!roleText) continue

    const parsed = parseRoleLine(roleText)
    if (!parsed.title) continue
    if (used.has(index)) continue
    used.add(index)
    for (const usedIndex of usedLines) used.add(usedIndex)

    const bullets: string[] = []
    for (let next = index + 1; next < lines.length && bullets.length < 8; next += 1) {
      const candidate = lines[next]!
      if (RANGE_PATTERN.test(candidate)) break
      if (looksLikeRoleHeader(lines, next)) break
      const cleaned = candidate.replace(/^[•*\-–—]\s*/, '').trim()
      if (!cleaned) continue
      if (cleaned.length < 4) continue
      bullets.push(cleaned.slice(0, 500))
    }

    const dates = parseDateRange(startToken, endToken)
    entries.push({
      title: parsed.title.slice(0, 160),
      company: parsed.company?.slice(0, 160) ?? null,
      location: parsed.location?.slice(0, 120) ?? null,
      startDate: dates.startDate,
      endDate: dates.endDate,
      current: dates.current,
      bullets,
      technologies: extractSkills(`${parsed.title} ${bullets.join(' ')}`, 12)
    })
    if (entries.length >= 15) break
  }
  return entries
}

function previousRoleLines(lines: string[], index: number, used: Set<number>): { lines: string[]; indexes: number[] } {
  const indexes: number[] = []
  const collected: string[] = []
  for (let offset = 1; offset <= 2 && index - offset >= 0; offset += 1) {
    const candidateIndex = index - offset
    if (used.has(candidateIndex)) break
    const candidate = lines[candidateIndex]!
    if (!candidate || RANGE_PATTERN.test(candidate) || candidate.length > 140) break
    if (candidate.split(/\s+/).length > 16) break
    indexes.unshift(candidateIndex)
    collected.unshift(candidate.replace(/^[•*\-–—\s]+/, '').trim())
    if (ROLE_WORDS.test(candidate) && collected.length >= 1) break
  }
  return { lines: collected, indexes }
}

function looksLikeRoleHeader(lines: string[], index: number): boolean {
  const line = lines[index]!
  if (/^[•*\-–—]/.test(line) || /[.!?]$/.test(line.trim())) return false
  if (!ROLE_WORDS.test(line) || line.split(/\s+/).length > 14) return false
  if (RANGE_PATTERN.test(line)) return true
  const nextLine = lines[index + 1] ?? ''
  return RANGE_PATTERN.test(nextLine) || RANGE_PATTERN.test(lines[index + 2] ?? '')
}

function parseRoleLine(value: string): { title: string; company: string | null; location: string | null } {
  let text = value
    .replace(/^[•*\-–—\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return { title: '', company: null, location: null }

  let parts = text.split(/\s*[|·•]\s*/).filter(Boolean)
  if (parts.length === 1) parts = text.split(/\s+[—–]\s+|\s+-\s+|\s+at\s+/i).filter(Boolean)
  if (parts.length === 1) {
    const comma = text.split(/\s*,\s*/)
    if (comma.length === 2) parts = comma
  }

  let title = ''
  let company: string | null = null
  let location: string | null = null
  const remaining: string[] = []
  for (const part of parts) {
    if (!title && ROLE_WORDS.test(part)) {
      title = part.trim()
      continue
    }
    remaining.push(part.trim())
  }
  if (!title) title = parts[0]?.trim() ?? ''
  const extras = remaining.filter((part) => part && part !== title)
  for (const part of extras) {
    if (!location && isLocation(part)) location = part
    else if (!company) company = part.replace(/^at\s+/i, '').trim()
  }

  return { title: title.slice(0, 160), company: company?.slice(0, 160) ?? null, location: location?.slice(0, 120) ?? null }
}

function parseDateRange(startToken: string, endToken: string): { startDate: string | null; endDate: string | null; current: boolean } {
  const start = parseDateToken(startToken)
  const current = /^(present|current|now)$/i.test(endToken.trim())
  const end = current ? null : parseDateToken(endToken, true)
  return {
    startDate: start ? formatYearMonth(start) : null,
    endDate: end ? formatYearMonth(end) : null,
    current
  }
}

function parseDateToken(token: string, endOfPeriod = false): { year: number; month: number } | null {
  const value = token.trim().toLowerCase().replace(/\./g, '')
  const slash = /^(\d{1,2})\/((?:19|20)\d{2})$/.exec(value)
  if (slash) return { year: Number(slash[2]), month: Number(slash[1]) }
  const monthYear = /^([a-z]+)\s+((?:19|20)\d{2})$/.exec(value)
  if (monthYear) {
    const monthIndex = MONTHS.findIndex((month) => month.startsWith(monthYear[1]!))
    if (monthIndex >= 0) return { year: Number(monthYear[2]), month: monthIndex + 1 }
  }
  const yearOnly = /^((?:19|20)\d{2})$/.exec(value)
  if (yearOnly) return { year: Number(yearOnly[1]), month: endOfPeriod ? 12 : 1 }
  return null
}

function formatYearMonth(date: { year: number; month: number }): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}`
}

function calculateYears(experience: ResumeExperience[]): number | null {
  const intervals: { start: number; end: number }[] = []
  const now = Date.now()
  for (const entry of experience) {
    const start = parseStoredDate(entry.startDate, false)
    const end = entry.current ? now : parseStoredDate(entry.endDate, true)
    if (start === null || end === null || end <= start) continue
    intervals.push({ start, end })
  }
  if (intervals.length === 0) return null
  intervals.sort((a, b) => a.start - b.start)
  let months = 0
  let currentStart = intervals[0]!.start
  let currentEnd = intervals[0]!.end
  for (const interval of intervals.slice(1)) {
    if (interval.start <= currentEnd) currentEnd = Math.max(currentEnd, interval.end)
    else {
      months += (currentEnd - currentStart) / (1000 * 60 * 60 * 24 * 30.4375)
      currentStart = interval.start
      currentEnd = interval.end
    }
  }
  months += (currentEnd - currentStart) / (1000 * 60 * 60 * 24 * 30.4375)
  const years = Math.round((months / 12) * 10) / 10
  return years > 0 ? years : null
}

function parseStoredDate(value: string | null, endOfMonth: boolean): number | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  if (!match) return null
  return endOfMonth
    ? Date.UTC(Number(match[1]), Number(match[2]), 0)
    : Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)
}

function extractEducation(lines: string[]): ResumeEducation[] {
  const entries: ResumeEducation[] = []
  let block: string[] = []
  const push = () => {
    if (block.length === 0) return
    const text = block.join(' | ')
    const range = RANGE_PATTERN.exec(text)
    const dates = range ? parseDateRange(range[1]!, range[2]!) : { startDate: null, endDate: null, current: false }
    const yearOnly = /(?:19|20)\d{2}/.exec(text)?.[0] ?? null
    const degreeLine = block.find((line) => DEGREE_WORDS.test(line)) ?? null
    const institutionLine = block.find((line) => INSTITUTION_WORDS.test(line)) ?? null
    const degreeParts = degreeLine?.split(/\s*[|·•—–]\s*|\s*,\s*/).filter(Boolean) ?? []
    const institutionParts = institutionLine?.split(/\s*[|·•—–]\s*|\s*,\s*/).filter(Boolean) ?? []
    const degree = degreeParts.find((part) => DEGREE_WORDS.test(part)) ?? degreeLine
    const institution = institutionParts.find((part) => INSTITUTION_WORDS.test(part)) ?? institutionLine
    entries.push({
      degree: degree?.slice(0, 160) ?? null,
      institution: institution?.slice(0, 160) ?? null,
      startDate: dates.startDate ?? (yearOnly && !dates.endDate ? `${yearOnly}-01` : null),
      endDate: dates.endDate ?? (yearOnly && !dates.startDate ? `${yearOnly}-01` : null),
      details: block.slice(0, 4).map((line) => line.slice(0, 400))
    })
    block = []
  }
  for (const line of lines) {
    const cleaned = line.replace(/^[•*\-–—]\s*/, '').trim()
    if (!cleaned) continue
    if (DEGREE_WORDS.test(cleaned) && block.some((item) => DEGREE_WORDS.test(item))) push()
    block.push(cleaned)
    if (entries.length >= 10) break
  }
  push()
  return entries.slice(0, 10)
}

function extractCertifications(lines: string[]): ResumeCertification[] {
  const found: ResumeCertification[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    for (const part of line.split(/\n|•|·|\s\|\s/)) {
      const cleaned = part.replace(/^[•*\-–—\s]+/, '').trim()
      if (cleaned.length < 3 || cleaned.length > 200) continue
      const key = cleaned.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      const yearMatch = /(?:19|20)\d{2}/g
      const years = [...cleaned.matchAll(yearMatch)]
      const year = years.length > 0 ? Number(years[years.length - 1]![0]) : null
      let segments = cleaned.split(/\s*[|—–]\s*|\s+by\s+/i).filter(Boolean)
      if (segments.length === 1 && /\s+-\s+/.test(cleaned)) segments = cleaned.split(/\s+-\s+/).filter(Boolean)
      // The first segment is normally the certificate name, and names such as
      // "AWS Certified..." would otherwise match the issuer lexicon.
      const issuerSegment = segments.length > 1 ? [...segments.slice(1)].reverse().find((segment) => CERT_ISSUERS.test(segment)) : undefined
      const issuer = issuerSegment
        ?.replace(/[,(]?\s*(?:19|20)\d{2}\)?/g, '')
        .replace(/[,|—–\s]+$/, '')
        .trim() ?? null
      let name = cleaned
        .replace(/\((?:19|20)\d{2}\)/, '')
        .replace(/\b(?:19|20)\d{2}\b/, '')
        .trim()
      if (issuer) name = name.replace(new RegExp(escapeRegExp(issuer), 'i'), '').replace(/^[|—–,\s-]+|[|—–,\s-]+$/g, '').trim()
      if (!name) continue
      found.push({ name: name.slice(0, 200), issuer: issuer?.slice(0, 160) ?? null, year })
      if (found.length >= 20) break
    }
  }
  return found
}

function extractLanguages(lines: string[]): ResumeLanguage[] {
  const found: ResumeLanguage[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    for (const part of line.split(/\n|[,;|•·]/)) {
      const cleaned = part.replace(/^[•*\-–—\s]+/, '').trim()
      if (!cleaned || cleaned.length > 80) continue
      const match = /^([\p{L}][\p{L} .'-]{1,30}?)(?:\s*[(\-–—:]\s*([^)]+)\)?)?$/u.exec(cleaned)
      if (!match) continue
      const language = titleCase(match[1]!.trim())
      if (SKILL_NOISE.has(language.toLowerCase())) continue
      const key = language.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      found.push({ language, level: normalizeLanguageLevel(match[2] ?? '') })
      if (found.length >= 10) break
    }
  }
  return found
}

function extractProjects(lines: string[]): ResumeProject[] {
  const found: ResumeProject[] = []
  const seen = new Set<string>()
  let current: { name: string; detail: string[]; technologies: Set<string> } | null = null

  const flush = () => {
    if (!current) return
    const key = current.name.toLowerCase()
    if (current.name.length >= 2 && !seen.has(key)) {
      seen.add(key)
      const [header, ...bullets] = current.detail
      const detail = header ? [header, bullets.join(' ')].filter(Boolean).join(' — ') : bullets.join(' ')
      found.push({
        name: current.name.slice(0, 160),
        detail: detail.slice(0, 1000) || null,
        technologies: [...current.technologies].slice(0, 10)
      })
    }
    current = null
  }

  for (const raw of lines) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    const bullet = /^[•*\-–—]/.test(trimmed)
    const cleaned = trimmed.replace(/^[•*\-–—\s]+/, '').trim()
    if (!cleaned) continue
    if (!bullet || !current) {
      flush()
      const parts = cleaned.split(/\s*[|—–]\s*|\s+-\s+|\s*:\s*/).filter(Boolean)
      const name = (parts.shift() ?? cleaned).trim()
      const detail = parts.join(' — ').trim()
      current = {
        name,
        detail: detail ? [detail] : [],
        technologies: new Set(extractSkills(cleaned, 8))
      }
    } else {
      current.detail.push(cleaned)
      for (const skill of extractSkills(cleaned, 8)) current.technologies.add(skill)
    }
    if (found.length >= 10) break
  }
  flush()
  return found.slice(0, 10)
}

function extractAwards(lines: string[]): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    for (const part of line.split(/\n|•|·|\s\|\s/)) {
      const cleaned = part.replace(/^[•*\-–—\s]+/, '').trim()
      if (cleaned.length < 2 || cleaned.length > 300) continue
      const key = cleaned.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      found.push(cleaned)
      if (found.length >= 10) return found
    }
  }
  return found
}

function normalizeLanguageLevel(value: string): string {
  const normalized = value.trim()
  if (!normalized) return 'Not stated'
  if (/native|mother/i.test(normalized)) return 'Native'
  if (/\b(c2|c1)\b|fluent/i.test(normalized)) return 'Fluent'
  if (/\bb2\b|professional/i.test(normalized)) return 'Professional'
  if (/\bb1\b|\ba2\b|conversational/i.test(normalized)) return 'Conversational'
  if (/\ba1\b|basic/i.test(normalized)) return 'Basic'
  return normalized.slice(0, 40)
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((word) => (word.length > 2 ? word[0]!.toUpperCase() + word.slice(1).toLowerCase() : word.toLowerCase()))
    .join(' ')
    .replace(/^([a-z])/, (letter) => letter.toUpperCase())
}

function scoreConfidence(data: ResumeExtractedData, header: string[], text: string): number {
  let score = 20
  if (data.name) score += 8
  if (data.email) score += 12
  if (data.phone || data.location) score += 6
  if (data.headline) score += 4
  if (data.summary) score += 8
  if (data.skills.length >= 5) score += 14
  else if (data.skills.length > 0) score += 7
  if (data.experience.length >= 2) score += 18
  else if (data.experience.length === 1) score += 10
  if (data.education.length > 0) score += 4
  if (data.certifications.length > 0) score += 4
  if (text.length < 300) score -= 15
  if (header.length === 0) score -= 10
  return Math.max(0, Math.min(100, score))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
