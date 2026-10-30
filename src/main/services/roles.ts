import type {
  RoleRecommendationDTO,
  RoleRecommendationsDTO,
  RoleSelectionPageDTO
} from '../../shared/api'
import { MAX_SELECTED_ROLES, ROLE_BY_KEY, ROLE_CATALOG, type RoleDefinition } from '../../shared/roles'
import type { Db } from '../db/database'
import { normalizeText, tokenSetSimilarity, tokens } from '../core/hash'
import { canonicalSkill } from '../pipeline/skills'
import { listResumes, getResume, getProfile, listTargetCountries } from '../db/repos/profile'
import { getResumeExtraction, listResumeExtractions, type ResumeExtractionRecord } from '../db/repos/resume-extractions'
import { effectiveRoleTitles, listRoleSelections, replaceRoleSelections } from '../db/repos/roles'

const MARKET_WINDOW_DAYS = 120
const MARKET_JOB_LIMIT = 5000

const CATALOG_BY_TITLE = new Map<string, RoleDefinition>()
for (const role of ROLE_CATALOG) {
  CATALOG_BY_TITLE.set(normalizeText(role.title), role)
  for (const alias of role.titleAliases) CATALOG_BY_TITLE.set(normalizeText(alias), role)
}

export function roleSelectionPage(db: Db): RoleSelectionPageDTO {
  const selections = listRoleSelections(db)
  const selectedKeys = new Set(selections.filter((item) => item.source === 'catalog').map((item) => item.roleKey))
  return {
    catalog: ROLE_CATALOG.map((role) => ({ ...role, selected: selectedKeys.has(role.key) })),
    customSelections: selections
      .filter((item) => item.source === 'custom')
      .map((item) => ({ roleKey: item.roleKey, title: item.title, source: 'custom' })),
    effectiveTitles: effectiveRoleTitles(db)
  }
}

export interface SaveRolesInput {
  selectedKeys: string[]
  customTitles: string[]
}

export function saveRoleSelections(db: Db, input: SaveRolesInput): RoleSelectionPageDTO {
  const chosen = new Map<string, { roleKey: string; title: string; source: 'catalog' | 'custom' }>()
  for (const key of input.selectedKeys) {
    const role = ROLE_BY_KEY.get(key)
    if (!role) throw new Error(`Unknown role "${key}"`)
    chosen.set(role.key, { roleKey: role.key, title: role.title, source: 'catalog' })
  }

  for (const rawTitle of input.customTitles) {
    const title = rawTitle.replace(/\s+/g, ' ').trim()
    if (title.length < 2 || title.length > 80) throw new Error('Custom role titles must be between 2 and 80 characters')
    if (/[\n\r]/.test(rawTitle)) throw new Error('Custom role titles must be a single line')
    const catalogMatch = CATALOG_BY_TITLE.get(normalizeText(title))
    if (catalogMatch) {
      chosen.set(catalogMatch.key, { roleKey: catalogMatch.key, title: catalogMatch.title, source: 'catalog' })
      continue
    }
    const key = `custom:${normalizeText(title).replace(/\s+/g, '-')}`
    chosen.set(key, { roleKey: key, title, source: 'custom' })
  }

  if (chosen.size > MAX_SELECTED_ROLES) {
    throw new Error(`Select at most ${MAX_SELECTED_ROLES} roles. Extra roles make discovery and scoring too broad.`)
  }

  replaceRoleSelections(db, [...chosen.values()])
  return roleSelectionPage(db)
}

export function recommendRoles(db: Db): RoleRecommendationsDTO {
  const profile = getProfile(db)
  const resumes = listResumes(db)
  const defaultResume = resumes.find((resume) => resume.isDefault) ?? null
  let extraction = defaultResume ? getResumeExtraction(db, defaultResume.id) : undefined
  let extractionResumeId = extraction ? defaultResume!.id : null
  if (!extraction) {
    const latest = listResumeExtractions(db)[0]
    if (latest) {
      extraction = latest
      extractionResumeId = latest.resumeId
    }
  }
  const usedResume = extractionResumeId ? getResume(db, extractionResumeId) : null
  const data = extraction?.data ?? null

  const skillKeys = new Set<string>()
  const skills: string[] = []
  const addSkill = (value: string) => {
    const label = canonicalSkill(value) ?? value.trim()
    const key = label.toLowerCase()
    if (!label || skillKeys.has(key)) return
    skillKeys.add(key)
    skills.push(label)
  }
  for (const skill of [...(data?.skills ?? []), ...profile.skills]) addSkill(skill)

  const titles: string[] = []
  if (data?.headline) titles.push(data.headline)
  for (const experience of data?.experience ?? []) titles.push(experience.title)
  const certifications = data?.certifications.map((cert) => cert.name) ?? []
  const years = profile.yearsExperience ?? data?.yearsExperience ?? null
  const selectedKeys = new Set(listRoleSelections(db).filter((item) => item.source === 'catalog').map((item) => item.roleKey))
  const market = loadMarket(db)

  const recommendations = ROLE_CATALOG.map((role) =>
    scoreRole(role, {
      skills,
      titles,
      certifications,
      years,
      selected: selectedKeys.has(role.key),
      market: market.filter((job) => titleMatchesRole(job.title, role) >= 0.6)
    })
  )
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, 8)

  return {
    generatedAt: Date.now(),
    resumeId: extractionResumeId,
    resumeLabel: usedResume ? usedResume.label : null,
    resumeConfidence: extraction?.confidence ?? null,
    usedProfileOnly: !extraction,
    recommendations
  }
}

interface MarketJob {
  title: string
  countryCode: string | null
  verdict: string | null
}

function loadMarket(db: Db): MarketJob[] {
  const targets = listTargetCountries(db).filter((target) => target.enabled)
  const since = Date.now() - MARKET_WINDOW_DAYS * 86_400_000
  const args: (string | number)[] = [since]
  let countryFilter = ''
  if (targets.length > 0) {
    countryFilter = ` AND j.country_code IN (${targets.map(() => '?').join(', ')})`
    args.push(...targets.map((target) => target.countryCode))
  }
  return db.all<{ title: string; country_code: string | null; verdict: string | null }>(
    `SELECT j.title, j.country_code, e.verdict
     FROM jobs j
     LEFT JOIN job_evaluations e ON e.job_id = j.id
     WHERE j.status = 'active' AND j.last_verified_at >= ?${countryFilter}
     ORDER BY j.last_verified_at DESC
     LIMIT ${MARKET_JOB_LIMIT}`,
    ...args
  ).map((row) => ({ title: row.title, countryCode: row.country_code, verdict: row.verdict }))
}

function titleMatchesRole(title: string, role: RoleDefinition): number {
  let best = 0
  const aliases = [role.title, ...role.titleAliases]
  for (const alias of aliases) {
    best = Math.max(best, tokenSetSimilarity(title, alias))
    const aliasTokens = tokens(alias)
    if (aliasTokens.length === 1 && aliasTokens[0]!.length >= 3 && tokens(title).includes(aliasTokens[0]!)) {
      best = Math.max(best, 0.65)
    }
  }
  return best
}

interface ScoreInput {
  skills: string[]
  titles: string[]
  certifications: string[]
  years: number | null
  selected: boolean
  market: MarketJob[]
}

function scoreRole(role: RoleDefinition, input: ScoreInput): RoleRecommendationDTO {
  const skillKeys = new Set(input.skills.map((skill) => (canonicalSkill(skill) ?? skill).toLowerCase()))
  const matchedSkills = role.coreSkills.filter((skill) => skillKeys.has(skill.toLowerCase()))
  const missingSkills = role.coreSkills.filter((skill) => !skillKeys.has(skill.toLowerCase()))
  const matchedBonus = role.bonusSkills.filter((skill) => skillKeys.has(skill.toLowerCase()))
  const coreRatio = role.coreSkills.length > 0 ? matchedSkills.length / role.coreSkills.length : 0
  const skillsScore = Math.round(coreRatio * 30 + Math.min(10, matchedBonus.length * 2.5))

  const titleMatches = input.titles.map((title) => ({
    title,
    similarity: titleMatchesRole(title, role)
  }))
  const bestTitle = titleMatches.sort((a, b) => b.similarity - a.similarity)[0] ?? null
  const titleScore = bestTitle ? Math.round(Math.min(1, bestTitle.similarity) * 15) : 0
  const yearsScore = experienceScore(input.years, role)
  const experienceScoreTotal = titleScore + yearsScore

  const certMatches = role.certifications.filter((cert) =>
    input.certifications.some((held) => certificationMatches(held, cert))
  )
  const certScore = role.certifications.length === 0 ? 5 : certMatches.length > 0 ? 10 : 0

  const eligibleJobs = input.market.filter((job) => job.verdict === 'eligible' || job.verdict === 'eligible_needs_sponsorship_offered').length
  const evaluatedJobs = input.market.filter((job) => job.verdict !== null).length
  const countries = [...new Set(input.market.map((job) => job.countryCode).filter((code): code is string => Boolean(code)))].sort()
  const countScore = Math.min(1, input.market.length / 20) * 15
  const eligibilityShare = evaluatedJobs > 0 ? eligibleJobs / evaluatedJobs : 0.5
  const marketScore = Math.round(countScore + eligibilityShare * 10)

  const score = Math.max(0, Math.min(100, skillsScore + experienceScoreTotal + certScore + marketScore))
  const confidence = recommendationConfidence(input, matchedSkills.length)
  const fit: RoleRecommendationDTO['fit'] = score >= 70 ? 'strong' : score >= 55 ? 'good' : score >= 40 ? 'stretch' : 'low'

  const evidence: string[] = []
  evidence.push(
    matchedSkills.length > 0
      ? `${matchedSkills.length} of ${role.coreSkills.length} core skills for this role appear in your stored skills: ${matchedSkills.slice(0, 6).join(', ')}.`
      : 'None of the core skills for this role appear in your stored resume or profile skills.'
  )
  if (bestTitle && bestTitle.similarity >= 0.6) {
    evidence.push(`Your title "${bestTitle.title}" is a close match.`)
  } else if (input.titles.length > 0) {
    evidence.push('No close title match in your stored experience yet; the skill evidence carries this recommendation.')
  } else {
    evidence.push('No work titles were extracted, so this ranking leans on skills and stated experience.')
  }
  evidence.push(experienceDetail(input.years, role))
  if (role.certifications.length > 0) {
    evidence.push(
      certMatches.length > 0
        ? `Certification evidence: ${certMatches.join(', ')}.`
        : `No matching certification was found. This role profile mentions ${role.certifications.slice(0, 3).join(', ')}.`
    )
  }
  if (input.market.length > 0) {
    evidence.push(
      `${input.market.length} active ${role.title.toLowerCase()} posting${input.market.length === 1 ? '' : 's'} were discovered in your enabled countries in the last ${MARKET_WINDOW_DAYS} days.` +
        (evaluatedJobs > 0 ? ` ${eligibleJobs} of ${evaluatedJobs} evaluated postings pass your work-authorization check.` : ' No eligibility evaluation is available yet.')
    )
  } else {
    evidence.push('No active postings for this role were discovered in your enabled countries yet, so market evidence is neutral.')
  }

  return {
    key: role.key,
    title: role.title,
    family: role.family,
    description: role.description,
    score,
    confidence,
    fit,
    selected: input.selected,
    components: [
      { key: 'skills', label: 'Skills', score: skillsScore, max: 40, detail: `${matchedSkills.length}/${role.coreSkills.length} core skills matched` },
      {
        key: 'experience',
        label: 'Experience',
        score: experienceScoreTotal,
        max: 25,
        detail: bestTitle ? `Best title similarity ${(bestTitle.similarity * 100).toFixed(0)}%` : 'No title evidence'
      },
      {
        key: 'certifications',
        label: 'Certifications',
        score: certScore,
        max: 10,
        detail: role.certifications.length === 0 ? 'No certification requirement' : `${certMatches.length} matching certification${certMatches.length === 1 ? '' : 's'}`
      },
      {
        key: 'market',
        label: 'Market evidence',
        score: marketScore,
        max: 25,
        detail: `${input.market.length} active posting${input.market.length === 1 ? '' : 's'}${evaluatedJobs > 0 ? `, ${eligibleJobs} eligible` : ''}`
      }
    ],
    matchedSkills,
    missingSkills: missingSkills.slice(0, 8),
    matchedCertifications: certMatches,
    evidence,
    market: {
      activeJobs: input.market.length,
      evaluatedJobs,
      eligibleJobs,
      countries
    }
  }
}

function experienceScore(years: number | null, role: RoleDefinition): number {
  if (years === null) return 0
  if (years >= role.idealYears) return 10
  if (years >= role.minYears) return Math.round(5 + (5 * (years - role.minYears)) / Math.max(1, role.idealYears - role.minYears))
  return Math.round(5 * (years / Math.max(0.5, role.minYears)))
}

function experienceDetail(years: number | null, role: RoleDefinition): string {
  if (years === null) return 'Years of experience are not stated, so seniority fit is neutral.'
  if (years >= role.idealYears) return `${years} years of stated experience meets the seniority this role usually expects.`
  if (years >= role.minYears) return `${years} years of stated experience is within the usual range for this role.`
  return `${years} years of stated experience is below the usual minimum (${role.minYears} years); treat this as a stretch.`
}

function certificationMatches(held: string, expected: string): boolean {
  const heldNorm = normalizeText(held)
  const expectedNorm = normalizeText(expected)
  if (!heldNorm || !expectedNorm) return false
  if (heldNorm.includes(expectedNorm) || expectedNorm.includes(heldNorm)) return true
  const expectedTokens = tokens(expected)
  if (expectedTokens.length === 0) return false
  const heldTokens = new Set(tokens(held))
  return expectedTokens.every((token) => heldTokens.has(token))
}

function recommendationConfidence(input: ScoreInput, matchedSkillCount: number): number {
  let confidence = input.skills.length > 0 ? 35 : 15
  if (input.titles.length > 0) confidence += 20
  if (input.titles.length >= 2) confidence += 5
  if (input.skills.length >= 5) confidence += 10
  if (matchedSkillCount >= 5) confidence += 10
  if (input.years !== null) confidence += 10
  if (input.certifications.length > 0) confidence += 5
  if (input.market.some((job) => job.verdict !== null)) confidence += 5
  return Math.min(95, confidence)
}
