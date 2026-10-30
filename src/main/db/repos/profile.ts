import type { LanguageSkill, RemoteType, SalaryExpectation, WorkAuthorizationStatus } from '../../../shared/types'
import type { Db } from '../database'
import { parseJson, toJson } from '../../core/json'
import { stableHash } from '../../core/hash'
import { effectiveRoleTitles } from './roles'

export interface ProfileRecord {
  id: number
  fullName: string
  email: string
  phone: string | null
  city: string | null
  countryCode: string | null
  citizenships: string[]
  residenceCountry: string | null
  linkedin: string | null
  website: string | null
  github: string | null
  summary: string | null
  yearsExperience: number | null
  skills: string[]
  languages: LanguageSkill[]
  salaryExpectation: SalaryExpectation | null
  noticePeriod: string | null
  earliestStart: string | null
  updatedAt: number
}

export type ProfileInput = Omit<ProfileRecord, 'id' | 'updatedAt'>

interface ProfileRow {
  id: number
  full_name: string
  email: string
  phone: string | null
  city: string | null
  country_code: string | null
  citizenships: string
  residence_country: string | null
  linkedin: string | null
  website: string | null
  github: string | null
  summary: string | null
  years_experience: number | null
  skills: string
  languages: string
  salary_expectation: string | null
  notice_period: string | null
  earliest_start: string | null
  updated_at: number
}

const PROFILE_COLUMNS = `id, full_name, email, phone, city, country_code, citizenships, residence_country,
linkedin, website, github, summary, years_experience, skills, languages, salary_expectation,
notice_period, earliest_start, updated_at`

function mapProfile(row: ProfileRow): ProfileRecord {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    city: row.city,
    countryCode: row.country_code,
    citizenships: parseJson<string[]>(row.citizenships, []),
    residenceCountry: row.residence_country,
    linkedin: row.linkedin,
    website: row.website,
    github: row.github,
    summary: row.summary,
    yearsExperience: row.years_experience,
    skills: parseJson<string[]>(row.skills, []),
    languages: parseJson<LanguageSkill[]>(row.languages, []),
    salaryExpectation: parseJson<SalaryExpectation | null>(row.salary_expectation, null),
    noticePeriod: row.notice_period,
    earliestStart: row.earliest_start,
    updatedAt: row.updated_at
  }
}

export function getProfile(db: Db): ProfileRecord {
  const existing = db.get<ProfileRow>(`SELECT ${PROFILE_COLUMNS} FROM profile WHERE id = 1`)
  if (existing) return mapProfile(existing)
  const now = Date.now()
  db.run('INSERT INTO profile (id, updated_at) VALUES (1, ?)', now)
  return mapProfile(db.get<ProfileRow>(`SELECT ${PROFILE_COLUMNS} FROM profile WHERE id = 1`)!)
}

export function saveProfile(db: Db, input: ProfileInput): ProfileRecord {
  const now = Date.now()
  db.run(
    `INSERT INTO profile (id, full_name, email, phone, city, country_code, citizenships, residence_country,
       linkedin, website, github, summary, years_experience, skills, languages, salary_expectation,
       notice_period, earliest_start, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       full_name = excluded.full_name, email = excluded.email, phone = excluded.phone, city = excluded.city,
       country_code = excluded.country_code, citizenships = excluded.citizenships,
       residence_country = excluded.residence_country, linkedin = excluded.linkedin, website = excluded.website,
       github = excluded.github, summary = excluded.summary, years_experience = excluded.years_experience,
       skills = excluded.skills, languages = excluded.languages, salary_expectation = excluded.salary_expectation,
       notice_period = excluded.notice_period, earliest_start = excluded.earliest_start, updated_at = excluded.updated_at`,
    input.fullName.trim(),
    input.email.trim(),
    emptyToNull(input.phone),
    emptyToNull(input.city),
    emptyToNull(input.countryCode),
    toJson(input.citizenships.map((code) => code.toUpperCase())),
    emptyToNull(input.residenceCountry),
    emptyToNull(input.linkedin),
    emptyToNull(input.website),
    emptyToNull(input.github),
    emptyToNull(input.summary),
    input.yearsExperience,
    toJson(input.skills),
    toJson(input.languages),
    input.salaryExpectation ? toJson(input.salaryExpectation) : null,
    emptyToNull(input.noticePeriod),
    emptyToNull(input.earliestStart),
    now
  )
  return getProfile(db)
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export interface ProfileCompleteness {
  score: number
  missing: string[]
  warnings: string[]
  readyToApply: boolean
}

export function profileCompleteness(profile: ProfileRecord, resumeCount: number, authorizationCount: number): ProfileCompleteness {
  const missing: string[] = []
  const warnings: string[] = []

  if (!profile.fullName.trim()) missing.push('Full name')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) missing.push('A valid contact email')
  if (profile.citizenships.length === 0) missing.push('At least one citizenship (drives work-authorization checks)')
  if (!profile.residenceCountry) missing.push('Country of residence')
  if (authorizationCount === 0) missing.push('Work authorization details')
  if (resumeCount === 0) missing.push('A resume file')
  if (profile.skills.length === 0) missing.push('Skills')

  if (profile.summary && profile.summary.length < 80) warnings.push('Professional summary is shorter than 80 characters')
  if (profile.yearsExperience === null) warnings.push('Years of experience is not set, which weakens match scoring')
  if (!profile.salaryExpectation) warnings.push('No salary expectation set')

  const total = 7
  const score = Math.round(((total - missing.length) / total) * 100)
  return { score, missing, warnings, readyToApply: missing.length === 0 }
}

export function profileFingerprint(db: Db): string {
  const profile = getProfile(db)
  const authorizations = listWorkAuthorizations(db)
  return stableHash({
    citizenships: [...profile.citizenships].sort(),
    residenceCountry: profile.residenceCountry,
    skills: [...profile.skills].sort(),
    yearsExperience: profile.yearsExperience,
    salary: profile.salaryExpectation,
    roleTitles: effectiveRoleTitles(db).sort(),
    authorizations: authorizations.map((item) => ({
      country: item.countryCode,
      status: item.status,
      needsSponsorship: item.needsSponsorship,
      validUntil: item.validUntil
    }))
  })
}

export interface WorkAuthorizationRecord {
  id: number
  countryCode: string
  status: WorkAuthorizationStatus
  permitType: string | null
  validFrom: string | null
  validUntil: string | null
  needsSponsorship: boolean
  evidenceNote: string | null
  createdAt: number
  updatedAt: number
}

interface WorkAuthorizationRow {
  id: number
  country_code: string
  status: WorkAuthorizationStatus
  permit_type: string | null
  valid_from: string | null
  valid_until: string | null
  needs_sponsorship: number
  evidence_note: string | null
  created_at: number
  updated_at: number
}

export function listWorkAuthorizations(db: Db): WorkAuthorizationRecord[] {
  return db
    .all<WorkAuthorizationRow>('SELECT * FROM work_authorizations ORDER BY country_code')
    .map((row) => ({
      id: row.id,
      countryCode: row.country_code,
      status: row.status,
      permitType: row.permit_type,
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      needsSponsorship: row.needs_sponsorship === 1,
      evidenceNote: row.evidence_note,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
}

export interface WorkAuthorizationInput {
  countryCode: string
  status: WorkAuthorizationStatus
  permitType?: string | null
  validFrom?: string | null
  validUntil?: string | null
  needsSponsorship: boolean
  evidenceNote?: string | null
}

export function replaceWorkAuthorizations(db: Db, items: WorkAuthorizationInput[]): WorkAuthorizationRecord[] {
  const now = Date.now()
  db.tx(() => {
    db.run('DELETE FROM work_authorizations')
    for (const item of items) {
      db.run(
        `INSERT INTO work_authorizations (country_code, status, permit_type, valid_from, valid_until,
           needs_sponsorship, evidence_note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        item.countryCode.toUpperCase(),
        item.status,
        emptyToNull(item.permitType ?? null),
        emptyToNull(item.validFrom ?? null),
        emptyToNull(item.validUntil ?? null),
        item.needsSponsorship ? 1 : 0,
        emptyToNull(item.evidenceNote ?? null),
        now,
        now
      )
    }
  })
  return listWorkAuthorizations(db)
}

export interface CountryAnswerRecord {
  id: number
  questionKey: string
  questionText: string
  countryCode: string | null
  answer: string
  verified: boolean
  createdAt: number
  updatedAt: number
}

export function listCountryAnswers(db: Db): CountryAnswerRecord[] {
  return db
    .all<{
      id: number
      question_key: string
      question_text: string
      country_code: string | null
      answer: string
      verified: number
      created_at: number
      updated_at: number
    }>('SELECT * FROM country_answers ORDER BY question_key')
    .map((row) => ({
      id: row.id,
      questionKey: row.question_key,
      questionText: row.question_text,
      countryCode: row.country_code,
      answer: row.answer,
      verified: row.verified === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
}

export function upsertCountryAnswer(
  db: Db,
  input: { questionKey: string; questionText: string; countryCode?: string | null; answer: string; verified: boolean }
): void {
  const now = Date.now()
  const countryCode = emptyToNull(input.countryCode ?? null)
  const existing = db.get<{ id: number }>(
    "SELECT id FROM country_answers WHERE question_key = ? AND IFNULL(country_code, '') = IFNULL(?, '')",
    input.questionKey,
    countryCode
  )
  if (existing) {
    db.run(
      'UPDATE country_answers SET question_text = ?, answer = ?, verified = ?, updated_at = ? WHERE id = ?',
      input.questionText,
      input.answer,
      input.verified ? 1 : 0,
      now,
      existing.id
    )
    return
  }
  db.run(
    `INSERT INTO country_answers (question_key, question_text, country_code, answer, verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    input.questionKey,
    input.questionText,
    countryCode,
    input.answer,
    input.verified ? 1 : 0,
    now,
    now
  )
}

export function deleteCountryAnswer(db: Db, id: number): void {
  db.run('DELETE FROM country_answers WHERE id = ?', id)
}

export interface ResumeRecord {
  id: number
  label: string
  fileName: string
  storedPath: string
  mimeType: string
  sizeBytes: number
  sha256: string
  isDefault: boolean
  notes: string | null
  createdAt: number
}

export function listResumes(db: Db): ResumeRecord[] {
  return db
    .all<{
      id: number
      label: string
      file_name: string
      stored_path: string
      mime_type: string
      size_bytes: number
      sha256: string
      is_default: number
      notes: string | null
      created_at: number
    }>('SELECT * FROM resumes ORDER BY is_default DESC, created_at DESC')
    .map((row) => ({
      id: row.id,
      label: row.label,
      fileName: row.file_name,
      storedPath: row.stored_path,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      sha256: row.sha256,
      isDefault: row.is_default === 1,
      notes: row.notes,
      createdAt: row.created_at
    }))
}

export function getResume(db: Db, id: number): ResumeRecord | undefined {
  return listResumes(db).find((resume) => resume.id === id)
}

export function addResume(
  db: Db,
  input: Omit<ResumeRecord, 'id' | 'createdAt' | 'isDefault'> & { isDefault?: boolean }
): ResumeRecord {
  const now = Date.now()
  const isFirst = db.get<{ count: number }>('SELECT COUNT(*) AS count FROM resumes')?.count === 0
  const makeDefault = input.isDefault === true || isFirst
  let id = 0
  db.tx(() => {
    if (makeDefault) db.run('UPDATE resumes SET is_default = 0')
    const result = db.run(
      `INSERT INTO resumes (label, file_name, stored_path, mime_type, size_bytes, sha256, is_default, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.label,
      input.fileName,
      input.storedPath,
      input.mimeType,
      input.sizeBytes,
      input.sha256,
      makeDefault ? 1 : 0,
      emptyToNull(input.notes),
      now
    )
    id = result.lastInsertRowid
  })
  return getResume(db, id)!
}

export function setDefaultResume(db: Db, id: number): void {
  db.tx(() => {
    db.run('UPDATE resumes SET is_default = 0')
    db.run('UPDATE resumes SET is_default = 1 WHERE id = ?', id)
  })
}

export function deleteResume(db: Db, id: number): void {
  db.run('DELETE FROM resumes WHERE id = ?', id)
}

export function getDefaultResume(db: Db): ResumeRecord | undefined {
  return listResumes(db).find((resume) => resume.isDefault)
}

export interface TargetCountryRecord {
  id: number
  countryCode: string
  enabled: boolean
  remotePreference: RemoteType | 'any'
  employmentTypes: string[]
  jobTitles: string[]
  keywords: string[]
  excludeKeywords: string[]
  minSalary: number | null
  currency: string | null
  seniority: string[]
  scheduleCron: string
  timezone: string
  sources: string[]
  createdAt: number
  updatedAt: number
  lastRunAt: number | null
}

interface TargetCountryRow {
  id: number
  country_code: string
  enabled: number
  remote_preference: RemoteType | 'any'
  employment_types: string
  job_titles: string
  keywords: string
  exclude_keywords: string
  min_salary: number | null
  currency: string | null
  seniority: string
  schedule_cron: string
  timezone: string
  sources: string
  created_at: number
  updated_at: number
  last_run_at: number | null
}

function mapTarget(row: TargetCountryRow): TargetCountryRecord {
  return {
    id: row.id,
    countryCode: row.country_code,
    enabled: row.enabled === 1,
    remotePreference: row.remote_preference,
    employmentTypes: parseJson<string[]>(row.employment_types, []),
    jobTitles: parseJson<string[]>(row.job_titles, []),
    keywords: parseJson<string[]>(row.keywords, []),
    excludeKeywords: parseJson<string[]>(row.exclude_keywords, []),
    minSalary: row.min_salary,
    currency: row.currency,
    seniority: parseJson<string[]>(row.seniority, []),
    scheduleCron: row.schedule_cron,
    timezone: row.timezone,
    sources: parseJson<string[]>(row.sources, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRunAt: row.last_run_at
  }
}

export function listTargetCountries(db: Db): TargetCountryRecord[] {
  return db.all<TargetCountryRow>('SELECT * FROM target_countries ORDER BY country_code').map(mapTarget)
}

export function getTargetCountry(db: Db, id: number): TargetCountryRecord | undefined {
  const row = db.get<TargetCountryRow>('SELECT * FROM target_countries WHERE id = ?', id)
  return row ? mapTarget(row) : undefined
}

export interface TargetCountryInput {
  countryCode: string
  enabled: boolean
  remotePreference: RemoteType | 'any'
  employmentTypes: string[]
  jobTitles: string[]
  keywords: string[]
  excludeKeywords: string[]
  minSalary: number | null
  currency: string | null
  seniority: string[]
  scheduleCron: string
  timezone: string
  sources: string[]
}

export function upsertTargetCountry(db: Db, input: TargetCountryInput, id?: number): TargetCountryRecord {
  const now = Date.now()
  if (id) {
    db.run(
      `UPDATE target_countries SET country_code = ?, enabled = ?, remote_preference = ?, employment_types = ?,
        job_titles = ?, keywords = ?, exclude_keywords = ?, min_salary = ?, currency = ?, seniority = ?,
        schedule_cron = ?, timezone = ?, sources = ?, updated_at = ? WHERE id = ?`,
      input.countryCode.toUpperCase(),
      input.enabled ? 1 : 0,
      input.remotePreference,
      toJson(input.employmentTypes),
      toJson(input.jobTitles),
      toJson(input.keywords),
      toJson(input.excludeKeywords),
      input.minSalary,
      input.currency,
      toJson(input.seniority),
      input.scheduleCron,
      input.timezone,
      toJson(input.sources),
      now,
      id
    )
    return getTargetCountry(db, id)!
  }
  const result = db.run(
    `INSERT INTO target_countries (country_code, enabled, remote_preference, employment_types, job_titles,
       keywords, exclude_keywords, min_salary, currency, seniority, schedule_cron, timezone, sources,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.countryCode.toUpperCase(),
    input.enabled ? 1 : 0,
    input.remotePreference,
    toJson(input.employmentTypes),
    toJson(input.jobTitles),
    toJson(input.keywords),
    toJson(input.excludeKeywords),
    input.minSalary,
    input.currency,
    toJson(input.seniority),
    input.scheduleCron,
    input.timezone,
    toJson(input.sources),
    now,
    now
  )
  return getTargetCountry(db, result.lastInsertRowid)!
}

export function setTargetEnabled(db: Db, id: number, enabled: boolean): void {
  db.run('UPDATE target_countries SET enabled = ?, updated_at = ? WHERE id = ?', enabled ? 1 : 0, Date.now(), id)
}

export function deleteTargetCountry(db: Db, id: number): void {
  db.run('DELETE FROM target_countries WHERE id = ?', id)
}

export function touchTargetRun(db: Db, id: number): void {
  db.run('UPDATE target_countries SET last_run_at = ? WHERE id = ?', Date.now(), id)
}
