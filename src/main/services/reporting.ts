import type { DailyMetricsSnapshot, DigestBacklog, DigestSummary } from '../../shared/types'
import type { Db } from '../db/database'
import { computeDayMetrics, getDayMetrics, saveDigest } from '../db/repos/metrics'
import { listEvents } from '../db/repos/events'
import { dateKey, systemTimeZone } from '../core/time'

export function backlogCounts(db: Db): DigestBacklog {
  const count = (status: string): number =>
    db.get<{ n: number }>('SELECT COUNT(*) AS n FROM applications WHERE status = ? AND active = 1', status)?.n ?? 0
  return {
    awaitingApproval: count('awaiting_approval'),
    needsHuman: count('needs_human'),
    queued: count('queued'),
    uncertain: count('uncertain'),
    failed: count('failed')
  }
}

function headlineFor(metrics: DailyMetricsSnapshot): string {
  if (metrics.submitted === 0 && metrics.applicationsDrafted === 0 && metrics.jobsDiscovered === 0) {
    return 'No activity recorded yet today.'
  }
  if (metrics.submitted > 0) {
    return `${metrics.submitted} application${metrics.submitted === 1 ? '' : 's'} submitted today from ${metrics.jobsDiscovered} new job${metrics.jobsDiscovered === 1 ? '' : 's'}.`
  }
  if (metrics.applicationsDrafted > 0) {
    return `${metrics.applicationsDrafted} application${metrics.applicationsDrafted === 1 ? '' : 's'} drafted today, none submitted yet.`
  }
  return `${metrics.jobsDiscovered} new job${metrics.jobsDiscovered === 1 ? '' : 's'} discovered today; no eligible drafts yet.`
}

export function buildDigest(db: Db, date: string, timeZone = systemTimeZone()): DigestSummary {
  const isToday = date === dateKey(Date.now(), timeZone)
  const metrics = isToday ? computeDayMetrics(db, date, timeZone) : (getDayMetrics(db, date) ?? computeDayMetrics(db, date, timeZone))
  const backlog = backlogCounts(db)
  const attention: string[] = []
  if (backlog.awaitingApproval > 0) {
    attention.push(`${backlog.awaitingApproval} draft${backlog.awaitingApproval === 1 ? '' : 's'} waiting for your approval.`)
  }
  if (backlog.needsHuman > 0) {
    attention.push(`${backlog.needsHuman} application${backlog.needsHuman === 1 ? '' : 's'} ${backlog.needsHuman === 1 ? 'needs' : 'need'} a manual step.`)
  }
  if (backlog.uncertain > 0) {
    attention.push(`${backlog.uncertain} delivery outcome${backlog.uncertain === 1 ? ' is' : 's are'} uncertain; check the outbox before retrying.`)
  }
  if (backlog.failed > 0) {
    attention.push(`${backlog.failed} application${backlog.failed === 1 ? '' : 's'} failed and can be retried.`)
  }
  if (metrics.sourcesFailed > 0) {
    attention.push(`${metrics.sourcesFailed} source${metrics.sourcesFailed === 1 ? '' : 's'} failed today; check source health.`)
  }
  if (metrics.aiFallbacks > 0) {
    attention.push(`AI was unavailable ${metrics.aiFallbacks} time${metrics.aiFallbacks === 1 ? '' : 's'}; deterministic drafts were used instead.`)
  }

  const highlights = listEvents(db, { limit: 5 })
    .items.filter((event) => event.level !== 'error')
    .slice(0, 3)
    .map((event) => event.message)

  return {
    date,
    headline: headlineFor(metrics),
    metrics,
    backlog,
    attention,
    highlights
  }
}

export function generateDailyDigest(db: Db, date = dateKey(Date.now(), systemTimeZone()), timeZone = systemTimeZone()): DigestSummary {
  const summary = buildDigest(db, date, timeZone)
  saveDigest(db, summary, false)
  return summary
}

export function todayReport(db: Db): { date: string; metrics: DailyMetricsSnapshot; backlog: DigestBacklog; digest: DigestSummary } {
  const timeZone = systemTimeZone()
  const date = dateKey(Date.now(), timeZone)
  const metrics = computeDayMetrics(db, date, timeZone)
  const backlog = backlogCounts(db)
  return { date, metrics, backlog, digest: buildDigest(db, date, timeZone) }
}
