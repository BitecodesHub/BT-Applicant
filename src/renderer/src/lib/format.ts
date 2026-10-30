import type {
  ApplicationChannel,
  ApplicationStatus,
  EligibilityVerdict,
  EmploymentType,
  JobStatus,
  OutboxStatus,
  RemoteType,
  Severity,
  SponsorshipSignal,
  TaskStatus,
  TaskType,
  TemplateKind,
  WorkAuthorizationStatus
} from '@shared/types'
import { COUNTRIES, countryName } from '@shared/countries'

export type Tone = 'neutral' | 'success' | 'warn' | 'danger' | 'info' | 'accent' | 'purple'

export interface StatusMeta {
  label: string
  tone: Tone
}

export const verdictMeta: Record<EligibilityVerdict, StatusMeta> = {
  eligible: { label: 'Eligible', tone: 'success' },
  eligible_needs_sponsorship_offered: { label: 'Eligible if sponsored', tone: 'warn' },
  needs_review: { label: 'Needs review', tone: 'info' },
  ineligible: { label: 'Ineligible', tone: 'danger' }
}

export const applicationStatusMeta: Record<ApplicationStatus, StatusMeta> = {
  draft: { label: 'Draft', tone: 'neutral' },
  awaiting_approval: { label: 'Awaiting approval', tone: 'warn' },
  approved: { label: 'Approved', tone: 'info' },
  queued: { label: 'Queued', tone: 'info' },
  sending: { label: 'Sending', tone: 'accent' },
  submitted: { label: 'Submitted', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  uncertain: { label: 'Uncertain', tone: 'warn' },
  needs_human: { label: 'Needs you', tone: 'purple' },
  rejected: { label: 'Rejected', tone: 'neutral' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' }
}

export const jobStatusMeta: Record<JobStatus, StatusMeta> = {
  active: { label: 'Active', tone: 'success' },
  expired: { label: 'Expired', tone: 'warn' },
  closed: { label: 'Closed', tone: 'neutral' },
  duplicate: { label: 'Duplicate', tone: 'neutral' },
  removed: { label: 'Removed', tone: 'danger' }
}

export const taskStatusMeta: Record<TaskStatus, StatusMeta> = {
  pending: { label: 'Pending', tone: 'neutral' },
  running: { label: 'Running', tone: 'info' },
  done: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  dead: { label: 'Dead', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' }
}

export const outboxStatusMeta: Record<OutboxStatus, StatusMeta> = {
  queued: { label: 'Queued', tone: 'neutral' },
  sending: { label: 'Sending', tone: 'info' },
  sent: { label: 'Sent', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  uncertain: { label: 'Uncertain', tone: 'warn' },
  cancelled: { label: 'Cancelled', tone: 'neutral' }
}

export const severityMeta: Record<Severity, StatusMeta> = {
  info: { label: 'Info', tone: 'info' },
  warn: { label: 'Warning', tone: 'warn' },
  error: { label: 'Error', tone: 'danger' }
}

export const channelMeta: Record<ApplicationChannel, StatusMeta> = {
  email: { label: 'Email', tone: 'info' },
  web: { label: 'Web form', tone: 'purple' },
  manual: { label: 'Manual', tone: 'neutral' }
}

export const sponsorMeta: Record<SponsorshipSignal, StatusMeta> = {
  sponsorship_offered: { label: 'Sponsorship offered', tone: 'success' },
  sponsorship_not_offered: { label: 'No sponsorship', tone: 'danger' },
  existing_right_to_work_required: { label: 'Right to work required', tone: 'warn' },
  citizenship_or_clearance_required: { label: 'Citizenship or clearance', tone: 'danger' },
  unstated: { label: 'Sponsorship not stated', tone: 'neutral' }
}

export const authStatusMeta: Record<WorkAuthorizationStatus, StatusMeta> = {
  citizen: { label: 'Citizen', tone: 'success' },
  permanent_resident: { label: 'Permanent resident', tone: 'success' },
  work_permit: { label: 'Work permit', tone: 'info' },
  student_permit: { label: 'Student permit', tone: 'warn' },
  dependent_permit: { label: 'Dependent permit', tone: 'warn' },
  none: { label: 'No authorization', tone: 'danger' }
}

export const authorizationBasisLabels: Record<string, string> = {
  citizenship: 'Citizenship',
  permanent_residence: 'Permanent residence',
  permit: 'Work permit',
  visa_free_bloc: 'Free-movement agreement',
  bilateral_route: 'Bilateral agreement',
  sponsorship_required: 'Sponsorship required',
  none: 'No basis found'
}

export const remoteLabels: Record<RemoteType, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
  unknown: 'Location not stated'
}

export const employmentLabels: Record<EmploymentType, string> = {
  full_time: 'Full time',
  part_time: 'Part time',
  contract: 'Contract',
  internship: 'Internship',
  temporary: 'Temporary',
  unknown: 'Type not stated'
}

export const taskTypeLabels: Record<TaskType, string> = {
  'source.poll': 'Discovery scan',
  'job.evaluate': 'Eligibility check',
  'application.draft': 'Draft application',
  'application.dispatch': 'Deliver application',
  'application.reconcile': 'Reconcile queue',
  'web.submit': 'Guided web submit',
  'metrics.rollup': 'Metrics rollup',
  'digest.generate': 'Daily digest',
  'maintenance.retention': 'Retention cleanup',
  'maintenance.reaper': 'Lease reaper'
}

export const templateKindLabels: Record<TemplateKind, string> = {
  application_email: 'Application email',
  cover_letter: 'Cover letter',
  follow_up: 'Follow-up'
}

export const aiModeLabels = {
  enhanced: 'AI enhanced',
  off: 'AI-free deterministic',
  simulated_outage: 'Simulated AI outage'
} as const

export const themeLabels = { system: 'System', light: 'Light', dark: 'Dark' } as const

export function statusOf(status: string): StatusMeta {
  if (status in applicationStatusMeta) return applicationStatusMeta[status as ApplicationStatus]
  if (status in taskStatusMeta) return taskStatusMeta[status as TaskStatus]
  return { label: humanize(status), tone: 'neutral' }
}

export function humanize(value: string): string {
  const cleaned = value.replace(/[._-]+/g, ' ').trim()
  return cleaned.length === 0 ? value : cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

export function humanizeCategory(value: string): string {
  return value
    .split('.')
    .map((part) => humanize(part))
    .join(' · ')
}

export function initials(name: string | null | undefined): string {
  if (!name) return '·'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '·'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase()
}

export function country(code: string | null | undefined): string {
  return code ? countryName(code) : 'Unknown location'
}

export function countryWithCode(code: string | null | undefined): string {
  if (!code) return 'Unknown'
  return `${countryName(code)} (${code.toUpperCase()})`
}

export function flagEmoji(code: string | null | undefined): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return '·'
  const upper = code.toUpperCase()
  return String.fromCodePoint(...[...upper].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65))
}

export function groupedCountries(): { region: string; countries: typeof COUNTRIES }[] {
  const groups = new Map<string, typeof COUNTRIES>()
  for (const item of COUNTRIES) {
    const list = groups.get(item.region) ?? []
    list.push(item)
    groups.set(item.region, list)
  }
  return [...groups.entries()].map(([region, countries]) => ({ region, countries }))
}

export function shortNumber(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}m`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}k`
  return String(value)
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en').format(value)
}

export function compactMoney(amount: number, currency: string | null): string {
  if (!currency) return formatNumber(amount)
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
      notation: Math.abs(amount) >= 10_000 ? 'compact' : 'standard',
      maximumFractionDigits: Math.abs(amount) >= 10_000 ? 1 : 0
    }).format(amount)
  } catch {
    return `${currency} ${formatNumber(amount)}`
  }
}

export function salaryText(
  min: number | null,
  max: number | null,
  currency: string | null,
  period: string | null
): string | null {
  if (min === null && max === null) return null
  const unit = period === 'year' ? '/yr' : period === 'month' ? '/mo' : period === 'hour' ? '/hr' : ''
  if (min !== null && max !== null && max !== min) {
    return `${compactMoney(min, currency)}–${compactMoney(max, currency)}${unit}`
  }
  return `${compactMoney(min ?? max ?? 0, currency)}${unit}`
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
}

export function durationText(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
})
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const weekdayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit' })

export function fmtDate(ts: number | null | undefined): string {
  if (!ts) return '—'
  return dateFmt.format(new Date(ts))
}

export function fmtDateTime(ts: number | null | undefined): string {
  if (!ts) return '—'
  return dateTimeFmt.format(new Date(ts))
}

export function fmtTime(ts: number | null | undefined): string {
  if (!ts) return '—'
  return timeFmt.format(new Date(ts))
}

export function fmtDay(date: string): string {
  return dateFmt.format(new Date(`${date}T00:00:00`))
}

export function fmtWeekday(date: string): string {
  return weekdayFmt.format(new Date(`${date}T00:00:00`))
}

export function dateKey(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function timeAgo(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return 'never'
  const delta = now - ts
  if (delta < -30_000) return timeUntil(ts, now)
  if (delta < 45_000) return 'just now'
  const minutes = Math.round(delta / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return fmtDate(ts)
}

export function timeUntil(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return 'not scheduled'
  const delta = ts - now
  if (delta < 0) return timeAgo(ts, now)
  if (delta < 60_000) return `in ${Math.max(1, Math.round(delta / 1000))}s`
  const minutes = Math.round(delta / 60_000)
  if (minutes < 60) return `in ${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 36) return `in ${hours}h`
  return fmtDateTime(ts)
}

export function plural(count: number, singular: string, pluralWord?: string): string {
  return `${count} ${count === 1 ? singular : (pluralWord ?? `${singular}s`)}`
}

export function pct(value: number, total: number): number {
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)))
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

export function oneLine(value: string, max = 160): string {
  return truncate(value.replace(/\s+/g, ' ').trim(), max)
}

export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function urlHost(url: string | null | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function formatCron(cron: string): string {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return cron
  const [minute, hour, day, month, weekday] = parts as [string, string, string, string, string]
  if (minute === '*' && hour === '*' && day === '*' && month === '*' && weekday === '*') return 'Every minute'
  if (minute.startsWith('*/') && hour === '*' && day === '*' && month === '*' && weekday === '*') {
    return `Every ${minute.slice(2)} minutes`
  }
  if (/^\d+$/.test(minute) && hour === '*' && day === '*' && month === '*' && weekday === '*') {
    return `Hourly at :${minute.padStart(2, '0')}`
  }
  if (minute === '0' && hour.startsWith('*/') && day === '*' && month === '*' && weekday === '*') {
    return `Every ${hour.slice(2)} hours`
  }
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && month === '*') {
    const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
    if (day === '*' && weekday === '*') return `Daily at ${time}`
    if (day === '*' && weekday === '1-5') return `Weekdays at ${time}`
    if (day !== '*' && weekday === '*') return `Monthly on day ${day} at ${time}`
  }
  return cron
}

export function templatePreviewValue(name: string): string {
  const samples: Record<string, string> = {
    candidate_name: 'Alex Morgan',
    candidate_first_name: 'Alex',
    candidate_email: 'alex@example.com',
    candidate_phone: '+1 555 0100',
    candidate_contact: 'alex@example.com | +1 555 0100',
    candidate_city: 'Berlin',
    linkedin: 'linkedin.com/in/alexmorgan',
    website: 'alexmorgan.dev',
    summary: 'Platform engineer focused on reliable cloud infrastructure and developer experience.',
    years_experience: '8',
    skills_list: '• Kubernetes\n• Terraform\n• AWS',
    resume_name: 'alex-morgan-resume.pdf',
    job_title: 'Senior Platform Engineer',
    company: 'Northwind Labs',
    job_location: 'Berlin, Germany',
    job_location_suffix: ' in Berlin, Germany',
    job_url: 'https://example.com/jobs/123',
    fit_paragraph: 'Your posting calls for Kubernetes and Terraform; my verified background covers both.'
  }
  return samples[name] ?? ''
}

export function renderPreview(template: string): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key: string) => templatePreviewValue(key))
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export function templateVariableList(): string[] {
  return [
    'candidate_name',
    'candidate_first_name',
    'candidate_email',
    'candidate_phone',
    'candidate_contact',
    'candidate_city',
    'linkedin',
    'website',
    'summary',
    'years_experience',
    'skills_list',
    'resume_name',
    'job_title',
    'company',
    'job_location',
    'job_location_suffix',
    'job_url',
    'fit_paragraph'
  ]
}
