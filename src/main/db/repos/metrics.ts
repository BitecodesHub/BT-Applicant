import type { DailyMetricsSnapshot, DigestSummary } from '../../../shared/types'
import type { Db } from '../database'
import { startOfLocalDay } from '../../core/time'
import { parseJson, toJson } from '../../core/json'

function nextDateKey(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, (month ?? 1) - 1, (day ?? 1) + 1)).toISOString().slice(0, 10)
}

function distinct(
  db: Db,
  category: string,
  column: 'job_id' | 'application_id' | 'source_id',
  from: number,
  to: number,
  extraSql = '',
  extraParams: (string | number)[] = []
): number {
  return (
    db.get<{ n: number }>(
      `SELECT COUNT(DISTINCT ${column}) AS n FROM events
       WHERE category = ? AND ts >= ? AND ts < ? AND ${column} IS NOT NULL ${extraSql}`,
      category,
      from,
      to,
      ...extraParams
    )?.n ?? 0
  )
}

export function computeDayMetrics(db: Db, date: string, timezone: string): DailyMetricsSnapshot {
  const start = startOfLocalDay(date, timezone)
  const end = startOfLocalDay(nextDateKey(date), timezone)
  const count = (category: string): number =>
    db.get<{ n: number }>('SELECT COUNT(*) AS n FROM events WHERE category = ? AND ts >= ? AND ts < ?', category, start, end)
      ?.n ?? 0

  return {
    date,
    jobsDiscovered:
      db.get<{ n: number }>('SELECT COUNT(*) AS n FROM jobs WHERE first_seen_at >= ? AND first_seen_at < ?', start, end)?.n ?? 0,
    jobsEligible: distinct(db, 'job.eligible', 'job_id', start, end),
    jobsIneligible: distinct(db, 'job.ineligible', 'job_id', start, end),
    applicationsDrafted: distinct(db, 'application.drafted', 'application_id', start, end),
    awaitingApproval: distinct(db, 'application.awaiting_approval', 'application_id', start, end),
    submitted: distinct(db, 'application.submitted', 'application_id', start, end),
    emailSubmitted: distinct(db, 'application.submitted', 'application_id', start, end, "AND json_extract(detail, '$.channel') = 'email'"),
    webSubmitted: distinct(db, 'application.submitted', 'application_id', start, end, "AND json_extract(detail, '$.channel') = 'web'"),
    failed: distinct(db, 'application.failed', 'application_id', start, end),
    uncertain: distinct(db, 'application.uncertain', 'application_id', start, end),
    needsHuman: distinct(db, 'application.needs_human', 'application_id', start, end),
    responses: count('response.received'),
    emailsSent: distinct(db, 'email.sent', 'application_id', start, end),
    emailsFailed: distinct(db, 'email.failed', 'application_id', start, end),
    sourcesFailed: distinct(db, 'source.failed', 'source_id', start, end),
    aiFallbacks: count('ai.fallback')
  }
}

export function rollupDay(db: Db, date: string, timezone: string): DailyMetricsSnapshot {
  const metrics = computeDayMetrics(db, date, timezone)
  db.run(
    `INSERT INTO daily_metrics (date, timezone, jobs_discovered, jobs_eligible, jobs_ineligible, applications_drafted,
       awaiting_approval, submitted, email_submitted, web_submitted, failed, uncertain, needs_human, responses,
       emails_sent, emails_failed, sources_failed, ai_fallbacks, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET timezone = excluded.timezone, jobs_discovered = excluded.jobs_discovered,
       jobs_eligible = excluded.jobs_eligible, jobs_ineligible = excluded.jobs_ineligible,
       applications_drafted = excluded.applications_drafted, awaiting_approval = excluded.awaiting_approval,
       submitted = excluded.submitted, email_submitted = excluded.email_submitted, web_submitted = excluded.web_submitted,
       failed = excluded.failed, uncertain = excluded.uncertain, needs_human = excluded.needs_human,
       responses = excluded.responses, emails_sent = excluded.emails_sent, emails_failed = excluded.emails_failed,
       sources_failed = excluded.sources_failed, ai_fallbacks = excluded.ai_fallbacks, updated_at = excluded.updated_at`,
    metrics.date,
    timezone,
    metrics.jobsDiscovered,
    metrics.jobsEligible,
    metrics.jobsIneligible,
    metrics.applicationsDrafted,
    metrics.awaitingApproval,
    metrics.submitted,
    metrics.emailSubmitted,
    metrics.webSubmitted,
    metrics.failed,
    metrics.uncertain,
    metrics.needsHuman,
    metrics.responses,
    metrics.emailsSent,
    metrics.emailsFailed,
    metrics.sourcesFailed,
    metrics.aiFallbacks,
    Date.now()
  )
  return metrics
}

interface DailyRow {
  date: string
  jobs_discovered: number
  jobs_eligible: number
  jobs_ineligible: number
  applications_drafted: number
  awaiting_approval: number
  submitted: number
  email_submitted: number
  web_submitted: number
  failed: number
  uncertain: number
  needs_human: number
  responses: number
  emails_sent: number
  emails_failed: number
  sources_failed: number
  ai_fallbacks: number
}

function mapDaily(row: DailyRow): DailyMetricsSnapshot {
  return {
    date: row.date,
    jobsDiscovered: row.jobs_discovered,
    jobsEligible: row.jobs_eligible,
    jobsIneligible: row.jobs_ineligible,
    applicationsDrafted: row.applications_drafted,
    awaitingApproval: row.awaiting_approval,
    submitted: row.submitted,
    emailSubmitted: row.email_submitted,
    webSubmitted: row.web_submitted,
    failed: row.failed,
    uncertain: row.uncertain,
    needsHuman: row.needs_human,
    responses: row.responses,
    emailsSent: row.emails_sent,
    emailsFailed: row.emails_failed,
    sourcesFailed: row.sources_failed,
    aiFallbacks: row.ai_fallbacks
  }
}

export function getDayMetrics(db: Db, date: string): DailyMetricsSnapshot | undefined {
  const row = db.get<DailyRow>('SELECT * FROM daily_metrics WHERE date = ?', date)
  return row ? mapDaily(row) : undefined
}

export function listDayMetrics(db: Db, limit = 30): DailyMetricsSnapshot[] {
  return db.all<DailyRow>('SELECT * FROM daily_metrics ORDER BY date DESC LIMIT ?', limit).map(mapDaily)
}

export function getDigest(db: Db, date: string): DigestSummary | undefined {
  const row = db.get<{ summary: string }>('SELECT summary FROM digests WHERE date = ?', date)
  return row ? parseJson<DigestSummary | undefined>(row.summary, undefined) : undefined
}

export function saveDigest(db: Db, summary: DigestSummary, notified: boolean): void {
  const now = Date.now()
  db.run(
    `INSERT INTO digests (date, generated_at, summary, notified_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET generated_at = excluded.generated_at, summary = excluded.summary,
       notified_at = COALESCE(digests.notified_at, excluded.notified_at)`,
    summary.date,
    now,
    toJson(summary),
    notified ? now : null
  )
}

export function listDigests(db: Db, limit = 30): DigestSummary[] {
  return db
    .all<{ summary: string }>('SELECT summary FROM digests ORDER BY date DESC LIMIT ?', limit)
    .map((row) => parseJson<DigestSummary | null>(row.summary, null))
    .filter((item): item is DigestSummary => item !== null)
}

export function markDigestNotified(db: Db, date: string): void {
  db.run('UPDATE digests SET notified_at = ? WHERE date = ?', Date.now(), date)
}

export function pruneMetrics(db: Db, olderThanDate: string): number {
  return db.run('DELETE FROM daily_metrics WHERE date < ?', olderThanDate).changes
}
