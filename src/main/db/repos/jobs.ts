import type {
  EligibilityResult,
  EligibilityVerdict,
  EmploymentType,
  JobStatus,
  NormalizedJob,
  RemoteType,
  ScoreBreakdown,
  SponsorEvidence,
  WorkAuthStatement
} from '../../../shared/types'
import type { Db } from '../database'
import { parseJson, parseJsonObject, toJson } from '../../core/json'

export interface JobRecord {
  id: number
  dedupeKey: string
  fingerprint: string
  sourceId: string
  sourceName: string
  externalId: string
  title: string
  company: string
  companyDomain: string | null
  countryCode: string | null
  locationRaw: string | null
  remoteType: RemoteType
  employmentType: EmploymentType
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  salaryPeriod: string | null
  descriptionHtml: string | null
  descriptionText: string
  requirements: string[]
  postedAt: number | null
  expiresAt: number | null
  firstSeenAt: number
  lastVerifiedAt: number
  url: string
  applyUrl: string | null
  applicationEmail: string | null
  applicationEmailEvidence: string | null
  applicationInstructions: string | null
  sponsorSignal: SponsorEvidence['signal']
  sponsorEvidence: SponsorEvidence | null
  workAuthStatements: WorkAuthStatement[]
  skills: string[]
  seniority: string | null
  status: JobStatus
  raw: unknown
  createdAt: number
  updatedAt: number
}

interface JobRow {
  id: number
  dedupe_key: string
  fingerprint: string
  source_id: string
  source_name: string
  external_id: string
  title: string
  company: string
  company_domain: string | null
  country_code: string | null
  location_raw: string | null
  remote_type: RemoteType
  employment_type: EmploymentType
  salary_min: number | null
  salary_max: number | null
  salary_currency: string | null
  salary_period: string | null
  description_html: string | null
  description_text: string
  requirements: string
  posted_at: number | null
  expires_at: number | null
  first_seen_at: number
  last_verified_at: number
  url: string
  apply_url: string | null
  application_email: string | null
  application_email_evidence: string | null
  application_instructions: string | null
  sponsor_signal: SponsorEvidence['signal']
  sponsor_evidence: string | null
  work_auth_statements: string
  skills: string
  seniority: string | null
  status: JobStatus
  raw: string | null
  created_at: number
  updated_at: number
}

const JOB_COLUMNS = `id, dedupe_key, fingerprint, source_id, source_name, external_id, title, company,
company_domain, country_code, location_raw, remote_type, employment_type, salary_min, salary_max,
salary_currency, salary_period, description_html, description_text, requirements, posted_at, expires_at,
first_seen_at, last_verified_at, url, apply_url, application_email, application_email_evidence,
application_instructions, sponsor_signal, sponsor_evidence, work_auth_statements, skills, seniority,
status, raw, created_at, updated_at`

const qualifiedJobColumns = (alias: string): string =>
  JOB_COLUMNS.split(',')
    .map((column) => `${alias}.${column.trim()}`)
    .join(', ')

function mapJob(row: JobRow): JobRecord {
  return {
    id: row.id,
    dedupeKey: row.dedupe_key,
    fingerprint: row.fingerprint,
    sourceId: row.source_id,
    sourceName: row.source_name,
    externalId: row.external_id,
    title: row.title,
    company: row.company,
    companyDomain: row.company_domain,
    countryCode: row.country_code,
    locationRaw: row.location_raw,
    remoteType: row.remote_type,
    employmentType: row.employment_type,
    salaryMin: row.salary_min,
    salaryMax: row.salary_max,
    salaryCurrency: row.salary_currency,
    salaryPeriod: row.salary_period,
    descriptionHtml: row.description_html,
    descriptionText: row.description_text,
    requirements: parseJson<string[]>(row.requirements, []),
    postedAt: row.posted_at,
    expiresAt: row.expires_at,
    firstSeenAt: row.first_seen_at,
    lastVerifiedAt: row.last_verified_at,
    url: row.url,
    applyUrl: row.apply_url,
    applicationEmail: row.application_email,
    applicationEmailEvidence: row.application_email_evidence,
    applicationInstructions: row.application_instructions,
    sponsorSignal: row.sponsor_signal,
    sponsorEvidence: parseJson<SponsorEvidence | null>(row.sponsor_evidence, null),
    workAuthStatements: parseJson<WorkAuthStatement[]>(row.work_auth_statements, []),
    skills: parseJson<string[]>(row.skills, []),
    seniority: row.seniority,
    status: row.status,
    raw: parseJson<unknown>(row.raw, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export interface JobInsert extends NormalizedJob {
  dedupeKey: string
  fingerprint: string
}

function insertValues(input: JobInsert, statements: WorkAuthStatement[]): (string | number | null)[] {
  return [
    input.dedupeKey,
    input.fingerprint,
    input.sourceId,
    input.sourceName,
    input.externalId,
    input.title,
    input.company,
    input.companyDomain,
    input.countryCode,
    input.locationRaw,
    input.remoteType,
    input.employmentType,
    input.salaryMin,
    input.salaryMax,
    input.salaryCurrency,
    input.salaryPeriod,
    input.descriptionHtml,
    input.descriptionText.slice(0, 200_000),
    toJson(input.requirements.slice(0, 100)),
    input.postedAt,
    input.expiresAt,
    input.url,
    input.applyUrl,
    input.applicationEmail,
    input.applicationEmailEvidence,
    input.applicationInstructions,
    toJson(statements),
    toJson(input.skills.slice(0, 100)),
    input.seniority,
    toJson(input.raw ?? null)
  ]
}

/** Inserts a job or refreshes an existing row for the same (source, external id). */
export function upsertJob(db: Db, input: JobInsert, sponsorEvidence: SponsorEvidence, statements: WorkAuthStatement[]): { id: number; created: boolean } {
  const now = Date.now()
  const existing = db.get<{ id: number }>(
    'SELECT id FROM jobs WHERE source_id = ? AND external_id = ?',
    input.sourceId,
    input.externalId
  )

  if (existing) {
    db.run(
      `UPDATE jobs SET dedupe_key = ?, fingerprint = ?, title = ?, company = ?, company_domain = ?,
        country_code = ?, location_raw = ?, remote_type = ?, employment_type = ?, salary_min = ?, salary_max = ?,
        salary_currency = ?, salary_period = ?, description_html = ?, description_text = ?, requirements = ?,
        posted_at = COALESCE(posted_at, ?), expires_at = ?, last_verified_at = ?, url = ?, apply_url = ?,
        application_email = ?, application_email_evidence = ?, application_instructions = ?,
        sponsor_signal = ?, sponsor_evidence = ?, work_auth_statements = ?, skills = ?, seniority = ?,
        status = CASE WHEN status = 'duplicate' THEN status ELSE 'active' END, raw = ?, updated_at = ?
       WHERE id = ?`,
      input.dedupeKey,
      input.fingerprint,
      input.title,
      input.company,
      input.companyDomain,
      input.countryCode,
      input.locationRaw,
      input.remoteType,
      input.employmentType,
      input.salaryMin,
      input.salaryMax,
      input.salaryCurrency,
      input.salaryPeriod,
      input.descriptionHtml,
      input.descriptionText.slice(0, 200_000),
      toJson(input.requirements.slice(0, 100)),
      input.postedAt,
      input.expiresAt,
      now,
      input.url,
      input.applyUrl,
      input.applicationEmail,
      input.applicationEmailEvidence,
      input.applicationInstructions,
      sponsorEvidence.signal,
      toJson(sponsorEvidence),
      toJson(statements),
      toJson(input.skills.slice(0, 100)),
      input.seniority,
      toJson(input.raw ?? null),
      now,
      existing.id
    )
    return { id: existing.id, created: false }
  }

  const values = insertValues(input, statements)
  const result = db.run(
    `INSERT INTO jobs (dedupe_key, fingerprint, source_id, source_name, external_id, title, company,
       company_domain, country_code, location_raw, remote_type, employment_type, salary_min, salary_max,
       salary_currency, salary_period, description_html, description_text, requirements, posted_at, expires_at,
       url, apply_url, application_email, application_email_evidence, application_instructions,
       work_auth_statements, skills, seniority, raw, sponsor_signal, sponsor_evidence, first_seen_at,
       last_verified_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ...values,
    sponsorEvidence.signal,
    toJson(sponsorEvidence),
    now,
    now,
    now,
    now
  )
  return { id: result.lastInsertRowid, created: true }
}

export function getJob(db: Db, id: number): JobRecord | undefined {
  const row = db.get<JobRow>(`SELECT ${JOB_COLUMNS} FROM jobs WHERE id = ?`, id)
  return row ? mapJob(row) : undefined
}

export interface DuplicateCandidate {
  id: number
  title: string
  company: string
  locationRaw: string | null
  countryCode: string | null
  dedupeKey: string
}

export function findDuplicateCandidates(db: Db, company: string, countryCode: string | null, limit = 75): DuplicateCandidate[] {
  return db
    .all<{
      id: number
      title: string
      company: string
      location_raw: string | null
      country_code: string | null
      dedupe_key: string
    }>(
      `SELECT id, title, company, location_raw, country_code, dedupe_key FROM jobs
       WHERE status = 'active' AND LOWER(company) = LOWER(?) ${countryCode ? 'AND (country_code = ? OR country_code IS NULL)' : ''}
       ORDER BY first_seen_at DESC LIMIT ?`,
      ...(countryCode ? [company, countryCode, limit] : [company, limit])
    )
    .map((row) => ({
      id: row.id,
      title: row.title,
      company: row.company,
      locationRaw: row.location_raw,
      countryCode: row.country_code,
      dedupeKey: row.dedupe_key
    }))
}

export function markDuplicate(db: Db, jobId: number, duplicateOfJobId: number, reason: string, similarity: number): void {
  db.tx(() => {
    db.run("UPDATE jobs SET status = 'duplicate', updated_at = ? WHERE id = ?", Date.now(), jobId)
    db.run(
      `INSERT INTO job_duplicates (job_id, duplicate_of_job_id, reason, similarity, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(job_id) DO UPDATE SET duplicate_of_job_id = excluded.duplicate_of_job_id,
         reason = excluded.reason, similarity = excluded.similarity`,
      jobId,
      duplicateOfJobId,
      reason,
      similarity,
      Date.now()
    )
  })
}

export function markJobStatus(db: Db, jobId: number, status: JobStatus): void {
  db.run('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?', status, Date.now(), jobId)
}

/** Closes jobs from a source that were absent from a successful full listing fetch. */
export function closeMissingJobs(db: Db, sourceId: string, seenExternalIds: string[]): number {
  const now = Date.now()
  if (seenExternalIds.length > 500) {
    return db.run(
      "UPDATE jobs SET status = 'closed', updated_at = ? WHERE source_id = ? AND status = 'active'",
      now,
      sourceId
    ).changes
  }
  const placeholders = seenExternalIds.map(() => '?').join(',')
  const sql =
    seenExternalIds.length === 0
      ? "UPDATE jobs SET status = 'closed', updated_at = ? WHERE source_id = ? AND status = 'active'"
      : `UPDATE jobs SET status = 'closed', updated_at = ? WHERE source_id = ? AND status = 'active'
         AND external_id NOT IN (${placeholders})`
  const result = db.run(sql, now, sourceId, ...seenExternalIds)
  return result.changes
}

export function upsertEvaluation(db: Db, jobId: number, result: EligibilityResult, score: number, breakdown: ScoreBreakdown, profileHash: string): void {
  db.run(
    `INSERT INTO job_evaluations (job_id, verdict, score, score_breakdown, reasons, rule_ids, authorization_basis,
       matched_bloc, requires_sponsorship, profile_hash, evaluated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(job_id) DO UPDATE SET verdict = excluded.verdict, score = excluded.score,
       score_breakdown = excluded.score_breakdown, reasons = excluded.reasons, rule_ids = excluded.rule_ids,
       authorization_basis = excluded.authorization_basis, matched_bloc = excluded.matched_bloc,
       requires_sponsorship = excluded.requires_sponsorship, profile_hash = excluded.profile_hash,
       evaluated_at = excluded.evaluated_at`,
    jobId,
    result.verdict,
    score,
    toJson(breakdown),
    toJson(result.reasons),
    toJson(result.ruleIds),
    result.authorizationBasis,
    result.matchedBloc,
    result.requiresSponsorship ? 1 : 0,
    profileHash,
    Date.now()
  )
}

export interface EvaluationRecord {
  jobId: number
  verdict: EligibilityVerdict
  score: number
  breakdown: ScoreBreakdown
  reasons: EligibilityResult['reasons']
  ruleIds: string[]
  authorizationBasis: string | null
  matchedBloc: string | null
  requiresSponsorship: boolean
  profileHash: string | null
  evaluatedAt: number
}

export function getEvaluation(db: Db, jobId: number): EvaluationRecord | undefined {
  const row = db.get<{
    job_id: number
    verdict: EligibilityVerdict
    score: number
    score_breakdown: string
    reasons: string
    rule_ids: string
    authorization_basis: string | null
    matched_bloc: string | null
    requires_sponsorship: number
    profile_hash: string | null
    evaluated_at: number
  }>('SELECT * FROM job_evaluations WHERE job_id = ?', jobId)
  if (!row) return undefined
  return {
    jobId: row.job_id,
    verdict: row.verdict,
    score: row.score,
    breakdown: parseJsonObject<ScoreBreakdown>(row.score_breakdown, {} as ScoreBreakdown),
    reasons: parseJson(row.reasons, []),
    ruleIds: parseJson<string[]>(row.rule_ids, []),
    authorizationBasis: row.authorization_basis,
    matchedBloc: row.matched_bloc,
    requiresSponsorship: row.requires_sponsorship === 1,
    profileHash: row.profile_hash,
    evaluatedAt: row.evaluated_at
  }
}

export interface JobListFilters {
  search?: string
  status?: JobStatus | 'all'
  verdict?: EligibilityVerdict | 'all'
  country?: string
  sourceId?: string
  remoteType?: RemoteType | 'all'
  minScore?: number
  onlyActive?: boolean
  needsAttention?: boolean
  limit?: number
  offset?: number
  sort?: 'score' | 'newest' | 'company'
}

export interface JobListItem {
  id: number
  title: string
  company: string
  countryCode: string | null
  locationRaw: string | null
  remoteType: RemoteType
  employmentType: EmploymentType
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  salaryPeriod: string | null
  postedAt: number | null
  firstSeenAt: number
  lastVerifiedAt: number
  url: string
  applyUrl: string | null
  sourceId: string
  sourceName: string
  status: JobStatus
  sponsorSignal: SponsorEvidence['signal']
  verdict: EligibilityVerdict | null
  score: number | null
  applicationId: number | null
  applicationStatus: string | null
  applicationChannel: string | null
  hasEmail: boolean
}

export function listJobs(db: Db, filters: JobListFilters = {}): { items: JobListItem[]; total: number } {
  const where: string[] = []
  const params: (string | number)[] = []

  if (filters.search) {
    where.push('(j.title LIKE ? OR j.company LIKE ? OR j.location_raw LIKE ?)')
    const needle = `%${filters.search}%`
    params.push(needle, needle, needle)
  }
  if (filters.status && filters.status !== 'all') {
    where.push('j.status = ?')
    params.push(filters.status)
  }
  if (filters.onlyActive) where.push("j.status = 'active'")
  if (filters.verdict && filters.verdict !== 'all') {
    if (filters.verdict === 'needs_review') {
      where.push("(e.verdict = 'needs_review' OR e.verdict IS NULL)")
    } else {
      where.push('e.verdict = ?')
      params.push(filters.verdict)
    }
  }
  if (filters.country) {
    where.push('j.country_code = ?')
    params.push(filters.country)
  }
  if (filters.sourceId) {
    where.push('j.source_id = ?')
    params.push(filters.sourceId)
  }
  if (filters.remoteType && filters.remoteType !== 'all') {
    where.push('j.remote_type = ?')
    params.push(filters.remoteType)
  }
  if (typeof filters.minScore === 'number') {
    where.push('COALESCE(e.score, 0) >= ?')
    params.push(filters.minScore)
  }
  if (filters.needsAttention) {
    where.push("(e.verdict = 'needs_review' OR a.status IN ('awaiting_approval','needs_human','uncertain','failed'))")
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const orderSql =
    filters.sort === 'company'
      ? 'ORDER BY j.company ASC, j.title ASC'
      : filters.sort === 'newest'
        ? 'ORDER BY COALESCE(j.posted_at, j.first_seen_at) DESC'
        : 'ORDER BY COALESCE(e.score, 0) DESC, COALESCE(j.posted_at, j.first_seen_at) DESC'

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500)
  const offset = Math.max(filters.offset ?? 0, 0)

  interface Row {
    id: number
    title: string
    company: string
    country_code: string | null
    location_raw: string | null
    remote_type: RemoteType
    employment_type: EmploymentType
    salary_min: number | null
    salary_max: number | null
    salary_currency: string | null
    salary_period: string | null
    posted_at: number | null
    first_seen_at: number
    last_verified_at: number
    url: string
    apply_url: string | null
    source_id: string
    source_name: string
    status: JobStatus
    sponsor_signal: SponsorEvidence['signal']
    verdict: EligibilityVerdict | null
    score: number | null
    application_id: number | null
    application_status: string | null
    application_channel: string | null
    application_email: string | null
  }

  const rows = db.all<Row>(
    `SELECT j.id, j.title, j.company, j.country_code, j.location_raw, j.remote_type, j.employment_type,
       j.salary_min, j.salary_max, j.salary_currency, j.salary_period, j.posted_at, j.first_seen_at,
       j.last_verified_at, j.url, j.apply_url, j.source_id, j.source_name, j.status, j.sponsor_signal,
       j.application_email, e.verdict, e.score, a.id AS application_id, a.status AS application_status,
       a.channel AS application_channel
     FROM jobs j
     LEFT JOIN job_evaluations e ON e.job_id = j.id
     LEFT JOIN applications a ON a.job_id = j.id AND a.active = 1
     ${whereSql} ${orderSql} LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset
  )

  const totalRow = db.get<{ total: number }>(
    `SELECT COUNT(*) AS total FROM jobs j
     LEFT JOIN job_evaluations e ON e.job_id = j.id
     LEFT JOIN applications a ON a.job_id = j.id AND a.active = 1
     ${whereSql}`,
    ...params
  )

  return {
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      company: row.company,
      countryCode: row.country_code,
      locationRaw: row.location_raw,
      remoteType: row.remote_type,
      employmentType: row.employment_type,
      salaryMin: row.salary_min,
      salaryMax: row.salary_max,
      salaryCurrency: row.salary_currency,
      salaryPeriod: row.salary_period,
      postedAt: row.posted_at,
      firstSeenAt: row.first_seen_at,
      lastVerifiedAt: row.last_verified_at,
      url: row.url,
      applyUrl: row.apply_url,
      sourceId: row.source_id,
      sourceName: row.source_name,
      status: row.status,
      sponsorSignal: row.sponsor_signal,
      verdict: row.verdict,
      score: row.score,
      applicationId: row.application_id,
      applicationStatus: row.application_status,
      applicationChannel: row.application_channel,
      hasEmail: Boolean(row.application_email)
    })),
    total: totalRow?.total ?? 0
  }
}

export interface JobStats {
  total: number
  active: number
  eligible: number
  eligibleNeedsSponsorship: number
  ineligible: number
  needsReview: number
  duplicates: number
  closed: number
  discoveredToday: number
}

export function getJobStats(db: Db, todayStart: number): JobStats {
  const count = (sql: string, ...params: (string | number)[]): number =>
    db.get<{ n: number }>(sql, ...params)?.n ?? 0

  return {
    total: count('SELECT COUNT(*) AS n FROM jobs'),
    active: count("SELECT COUNT(*) AS n FROM jobs WHERE status = 'active'"),
    eligible: count(
      "SELECT COUNT(*) AS n FROM jobs j JOIN job_evaluations e ON e.job_id = j.id WHERE e.verdict = 'eligible' AND j.status = 'active'"
    ),
    eligibleNeedsSponsorship: count(
      "SELECT COUNT(*) AS n FROM jobs j JOIN job_evaluations e ON e.job_id = j.id WHERE e.verdict = 'eligible_needs_sponsorship_offered' AND j.status = 'active'"
    ),
    ineligible: count(
      "SELECT COUNT(*) AS n FROM jobs j JOIN job_evaluations e ON e.job_id = j.id WHERE e.verdict = 'ineligible' AND j.status = 'active'"
    ),
    needsReview: count(
      "SELECT COUNT(*) AS n FROM jobs j LEFT JOIN job_evaluations e ON e.job_id = j.id WHERE (e.verdict = 'needs_review' OR e.verdict IS NULL) AND j.status = 'active'"
    ),
    duplicates: count("SELECT COUNT(*) AS n FROM jobs WHERE status = 'duplicate'"),
    closed: count("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('closed','expired')"),
    discoveredToday: count('SELECT COUNT(*) AS n FROM jobs WHERE first_seen_at >= ?', todayStart)
  }
}

export function listJobsNeedingEvaluation(db: Db, profileHash: string, limit = 200): JobRecord[] {
  return db
    .all<JobRow>(
      `SELECT ${qualifiedJobColumns('j')} FROM jobs j
       LEFT JOIN job_evaluations e ON e.job_id = j.id
       WHERE j.status = 'active' AND (e.job_id IS NULL OR e.profile_hash IS NOT ?)
       ORDER BY j.first_seen_at DESC LIMIT ?`,
      profileHash,
      limit
    )
    .map(mapJob)
}

export function expireJobs(db: Db, now: number): number {
  const result = db.run(
    "UPDATE jobs SET status = 'expired', updated_at = ? WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < ?",
    now,
    now
  )
  return result.changes
}

export function listJobsForSource(db: Db, sourceId: string): JobRecord[] {
  return db.all<JobRow>(`SELECT ${JOB_COLUMNS} FROM jobs WHERE source_id = ?`, sourceId).map(mapJob)
}

export function normalizeCountry(code: string | null | undefined): string | null {
  if (!code) return null
  const trimmed = code.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(trimmed) ? trimmed : null
}
