import { createHash, randomInt } from 'node:crypto'
import type { ApplicationService } from '../applications'
import type { Db } from '../../db/database'
import type { ChatChannel } from '../../db/repos/chat'
import { consumeChatAction, createChatAction } from '../../db/repos/chat'
import { getApplication, getApplicationStats, listApplications } from '../../db/repos/applications'
import { listJobs } from '../../db/repos/jobs'
import { getProfile, listResumes, listTargetCountries, listWorkAuthorizations, profileCompleteness, saveProfile } from '../../db/repos/profile'
import { logEvent } from '../../db/repos/events'
import { enqueue } from '../../db/repos/tasks'
import { getSection, saveSection } from '../../core/settings'
import { dateKey, systemTimeZone } from '../../core/time'
import { buildDigest } from '../reporting'
import type { ChatCommandInfoDTO } from '../../../shared/api'

export type ChatActor = ChatChannel

export interface ChatCommandResult {
  ok: boolean
  command: string
  reply: string
  requiresConfirmation: boolean
}

export interface ChatCommandRouterOptions {
  now?: () => number
  confirmationTtlMs?: number
  code?: () => string
}

export const CHAT_COMMANDS: ChatCommandInfoDTO[] = [
  { command: '/status', description: 'Pipeline counts, approvals, queue, and mode.', example: '/status' },
  { command: '/report', description: 'Today’s digest and anything needing attention.', example: '/report' },
  { command: '/approvals', description: 'Applications waiting for your decision.', example: '/approvals' },
  { command: '/applications', description: 'Five most recent applications and their status.', example: '/applications' },
  { command: '/jobs', description: 'Top active matches with job IDs.', example: '/jobs' },
  { command: '/missing', description: 'Facts still missing from your profile.', example: '/missing' },
  { command: '/approve', description: 'Prepare an approval; a one-time code confirms it.', example: '/approve 12' },
  { command: '/reject', description: 'Prepare a rejection; a one-time code confirms it.', example: '/reject 12 not a fit' },
  { command: '/retry', description: 'Prepare a retry for a failed delivery.', example: '/retry 12' },
  { command: '/confirm', description: 'Confirm a prepared action within five minutes.', example: '/confirm 482913' },
  { command: '/set', description: 'Update a profile fact in plain text.', example: '/set email you@example.com' },
  { command: '/scan', description: 'Queue a discovery scan for every enabled target.', example: '/scan' },
  { command: '/pause', description: 'Pause discovery, drafting, and delivery.', example: '/pause' },
  { command: '/resume', description: 'Resume automation.', example: '/resume' },
  { command: '/help', description: 'Show the command list.', example: '/help' }
]

const HELP_TEXT = [
  'BT Applicant commands',
  '',
  ...CHAT_COMMANDS.filter((item) => item.command !== '/help').map((item) => `${item.command.slice(1)} — ${item.description}`),
  '',
  'You can also type plain words: status, report, approvals, jobs, applications, missing, pause, resume, scan, approve 12, set email you@example.com.',
  'Approvals, rejections, and retries always require a one-time /confirm code and never happen from a single message.',
  'Type /help at any time.'
].join('\n')

const PROFILE_FIELD_LABELS: Record<string, string> = {
  name: 'Full name',
  email: 'Contact email',
  phone: 'Phone',
  city: 'City',
  country: 'Country of location',
  residence: 'Country of residence',
  linkedin: 'LinkedIn URL',
  github: 'GitHub URL',
  website: 'Website URL',
  summary: 'Professional summary',
  years: 'Years of experience',
  skills: 'Skills',
  citizenship: 'Citizenship',
  citizenships: 'Citizenship',
  notice: 'Notice period',
  start: 'Earliest start'
}

const PROFILE_FIELD_ALIASES: Record<string, string> = {
  fullname: 'name',
  full_name: 'name',
  mail: 'email',
  e_mail: 'email',
  location: 'city',
  countrycode: 'country',
  residencecountry: 'residence',
  experience: 'years',
  yearsexperience: 'years',
  skill: 'skills',
  citizenship: 'citizenship',
  noticeperiod: 'notice',
  earlieststart: 'start'
}

/**
 * Deterministic command router. No language model is consulted: the same
 * message always produces the same action, and any state change is written to
 * the event log for audit.
 */
export class ChatCommandRouter {
  private readonly now: () => number
  private readonly confirmationTtlMs: number
  private readonly code: () => string

  constructor(
    private readonly db: Db,
    private readonly applications: Pick<ApplicationService, 'approve' | 'reject' | 'retry'>,
    private readonly onProfileChanged: () => { evaluated: number; errors: number },
    options: ChatCommandRouterOptions = {}
  ) {
    this.now = options.now ?? (() => Date.now())
    this.confirmationTtlMs = options.confirmationTtlMs ?? 5 * 60_000
    this.code = options.code ?? (() => String(randomInt(100_000, 1_000_000)))
  }

  execute(input: string, channel: ChatActor, chatRef: string): ChatCommandResult {
    const text = input.replace(/\s+/g, ' ').trim().slice(0, 2000)
    if (!text) return this.result('', false, 'Send /help to see the commands.')
    const parsed = normalizeCommand(text)
    if (!parsed) return this.result('unknown', false, 'I did not recognise that. Send /help to see the commands.')

    const { command, rest } = parsed
    switch (command) {
      case 'help':
        return this.result('help', false, HELP_TEXT)
      case 'start':
        return this.result('start', false, `Connected. ${HELP_TEXT}`)
      case 'status':
        return this.result('status', false, this.statusText())
      case 'report':
        return this.result('report', false, this.reportText())
      case 'missing':
        return this.result('missing', false, this.missingText())
      case 'jobs':
        return this.result('jobs', false, this.jobsText())
      case 'applications':
        return this.result('applications', false, this.applicationsText())
      case 'approvals':
      case 'pending':
        return this.result('approvals', false, this.approvalsText())
      case 'pause':
        return this.setPaused(true)
      case 'resume':
        return this.setPaused(false)
      case 'scan':
        return this.scan()
      case 'approve':
        return this.prepareAction('approve', rest, channel, chatRef)
      case 'reject':
        return this.prepareAction('reject', rest, channel, chatRef)
      case 'retry':
        return this.prepareAction('retry', rest, channel, chatRef)
      case 'confirm':
        return this.confirm(rest, channel, chatRef)
      case 'set':
        return this.setProfile(rest)
      case 'whoami':
        return this.result('whoami', false, `This chat is linked as ${chatRef}. Keep this identifier private; it is the allowlisted address for this bot.`)
      default:
        return this.result('unknown', false, 'I did not recognise that. Send /help to see the commands.')
    }
  }

  private result(command: string, requiresConfirmation: boolean, reply: string, ok = true): ChatCommandResult {
    return { ok, command, reply, requiresConfirmation }
  }

  private statusText(): string {
    const dayStart = localMidnight(this.now())
    const stats = getApplicationStats(this.db)
    const counts = this.db.get<{
      discovered: number
      eligible: number
      queued: number
      dead: number
    }>(
      `SELECT
        (SELECT COUNT(*) FROM jobs WHERE first_seen_at >= ?) AS discovered,
        (SELECT COUNT(*) FROM jobs j JOIN job_evaluations e ON e.job_id = j.id
          WHERE j.status = 'active' AND e.verdict IN ('eligible','eligible_needs_sponsorship_offered')) AS eligible,
        (SELECT COUNT(*) FROM tasks WHERE status IN ('pending','running')) AS queued,
        (SELECT COUNT(*) FROM tasks WHERE status = 'dead') AS dead`,
      dayStart
    )
    const automation = getSection(this.db, 'automation')
    const outbound = getSection(this.db, 'outbound')
    const ai = getSection(this.db, 'ai')
    return [
      'BT Applicant · status',
      `Autopilot: ${automation.paused ? 'paused' : 'running'} · AI ${ai.mode === 'enhanced' ? 'enhanced' : ai.mode === 'off' ? 'off' : 'simulated outage'}`,
      `Today: ${counts?.discovered ?? 0} discovered · ${counts?.eligible ?? 0} eligible among active jobs · ${stats.submitted} submitted all-time`,
      `Approvals: ${stats.awaitingApproval} waiting · ${stats.needsHuman} need you`,
      `Queue: ${counts?.queued ?? 0} active · ${counts?.dead ?? 0} dead-lettered`,
      `Outbound: ${outbound.killSwitch ? 'kill switch on' : outbound.mode === 'smtp' ? 'SMTP live' : 'mock outbox'}`
    ].join('\n')
  }

  private reportText(): string {
    const timeZone = systemTimeZone()
    const digest = buildDigest(this.db, dateKey(this.now(), timeZone), timeZone)
    const lines = [
      `Daily report · ${digest.date}`,
      digest.headline,
      `Discovered ${digest.metrics.jobsDiscovered} · eligible ${digest.metrics.jobsEligible} · submitted ${digest.metrics.submitted}`,
      `Backlog: ${digest.backlog.awaitingApproval} waiting · ${digest.backlog.needsHuman} need you · ${digest.backlog.queued} queued`
    ]
    if (digest.attention.length > 0) {
      lines.push('', 'Attention:')
      for (const item of digest.attention.slice(0, 5)) lines.push(`• ${item}`)
    }
    lines.push('', 'Reply /approvals to act, or /status for the live queue.')
    return lines.join('\n')
  }

  private missingText(): string {
    const profile = getProfile(this.db)
    const completeness = profileCompleteness(profile, listResumes(this.db).length, listWorkAuthorizations(this.db).length)
    const lines = [`Profile completeness: ${completeness.score}%`]
    if (completeness.missing.length === 0) lines.push('Everything required for applications is present.')
    else {
      lines.push('', 'Missing:')
      for (const item of completeness.missing) lines.push(`• ${item}`)
    }
    if (completeness.warnings.length > 0) {
      lines.push('', 'Worth improving:')
      for (const item of completeness.warnings.slice(0, 4)) lines.push(`• ${item}`)
    }
    lines.push('', 'Update most facts with /set, for example /set phone +49 151 2345678 or /set skills Kubernetes, Terraform, AWS.')
    lines.push('Work authorization edits stay in the desktop app so you can review the resulting eligibility changes.')
    return lines.join('\n')
  }

  private jobsText(): string {
    const { items } = listJobs(this.db, { onlyActive: true, limit: 12, sort: 'score' })
    const ranked = items.filter((job) => job.verdict === 'eligible' || job.verdict === 'eligible_needs_sponsorship_offered').slice(0, 6)
    if (ranked.length === 0) return 'No active eligible jobs yet. Reply /scan to queue discovery, then check /status.'
    const lines = ['Top active matches', '']
    for (const job of ranked) {
      lines.push(`• #${job.id} ${job.title} · ${job.company}${job.countryCode ? ` · ${job.countryCode}` : ''} · score ${Math.round(job.score ?? 0)}`)
    }
    lines.push('', 'Open the desktop app for details. Reply /scan to look for more.')
    return lines.join('\n')
  }

  private applicationsText(): string {
    const { items } = listApplications(this.db, { limit: 6 })
    if (items.length === 0) return 'No applications yet. The pipeline drafts them after discovery and eligibility checks.'
    const lines = ['Recent applications', '']
    for (const item of items) {
      lines.push(`• #${item.id} ${item.jobTitle} · ${item.company} · ${humanStatus(item.status)}`)
    }
    lines.push('', 'Reply /approvals for drafts waiting on you.')
    return lines.join('\n')
  }

  private approvalsText(): string {
    const { items } = listApplications(this.db, { status: 'awaiting_approval', limit: 8 })
    if (items.length === 0) return 'Nothing is waiting for approval. Reply /status for the current queue.'
    const lines = ['Awaiting approval', '']
    for (const item of items) {
      lines.push(`• #${item.id} ${item.jobTitle} · ${item.company} · ${item.channel}`)
    }
    lines.push('', 'Reply /approve <id> to prepare an approval. Nothing is sent until you send the one-time /confirm code.')
    return lines.join('\n')
  }

  private setPaused(paused: boolean): ChatCommandResult {
    const automation = getSection(this.db, 'automation')
    if (automation.paused === paused) {
      return this.result(paused ? 'pause' : 'resume', false, paused ? 'Autopilot is already paused.' : 'Autopilot is already running.')
    }
    saveSection(this.db, 'automation', { ...automation, paused })
    logEvent(this.db, {
      category: 'automation.paused',
      message: paused ? 'Autopilot paused from chat' : 'Autopilot resumed from chat',
      actor: 'user',
      detail: { source: 'chat' }
    })
    return this.result(paused ? 'pause' : 'resume', false, paused
      ? 'Autopilot paused. Discovery, drafting, and delivery will wait. Reply /resume when you want to continue.'
      : 'Autopilot resumed. Queued work will continue with the existing caps and approval rules.')
  }

  private scan(): ChatCommandResult {
    const targets = listTargetCountries(this.db).filter((target) => target.enabled)
    if (targets.length === 0) return this.result('scan', false, 'No enabled target country. Add one in Targets before scanning.', false)
    const bucket = Math.floor(this.now() / 60_000)
    for (const target of targets) {
      enqueue(this.db, {
        type: 'source.poll',
        payload: { targetCountryId: target.id },
        priority: 7,
        idempotencyKey: `chat-scan:${target.id}:${bucket}`
      })
    }
    logEvent(this.db, {
      category: 'target.polled',
      message: `Discovery scan queued from chat for ${targets.length} target ${targets.length === 1 ? 'country' : 'countries'}`,
      actor: 'user',
      detail: { targets: targets.map((target) => target.countryCode) }
    })
    return this.result('scan', false, `Queued discovery for ${targets.length} target ${targets.length === 1 ? 'country' : 'countries'}. I will report failures here when they occur.`)
  }

  private prepareAction(kind: 'approve' | 'reject' | 'retry', rest: string, channel: ChatActor, chatRef: string): ChatCommandResult {
    const match = rest.match(/^#?(\d+)\b\s*(.*)$/)
    if (!match) return this.result(kind, false, `Usage: /${kind} <application id>. Find IDs with /approvals or /applications.`, false)
    const applicationId = Number(match[1])
    const reason = match[2]?.trim() || null
    const application = getApplication(this.db, applicationId)
    if (!application) return this.result(kind, false, `Application #${applicationId} was not found.`, false)

    if (kind === 'approve' && application.status !== 'awaiting_approval') {
      return this.result('approve', false, `Application #${applicationId} is ${humanStatus(application.status)}; there is nothing to approve.`, false)
    }
    if (kind === 'reject' && !['awaiting_approval', 'needs_human', 'failed'].includes(application.status)) {
      return this.result('reject', false, `Application #${applicationId} is ${humanStatus(application.status)}; rejecting it here is not allowed.`, false)
    }
    if (kind === 'retry' && !['failed', 'needs_human'].includes(application.status)) {
      return this.result('retry', false, `Application #${applicationId} is ${humanStatus(application.status)}; only failed or blocked applications can be retried.`, false)
    }

    const code = this.code()
    createChatAction(this.db, {
      kind,
      provider: channel,
      providerRef: chatRef,
      applicationId,
      reason,
      tokenHash: hashCode(code),
      expiresAt: this.now() + this.confirmationTtlMs
    })
    const actionText = kind === 'approve' ? 'approval' : kind === 'reject' ? 'rejection' : 'retry'
    logEvent(this.db, {
      category: 'chat.action_prepared',
      message: `${actionText} prepared from chat for application #${applicationId}`,
      applicationId,
      jobId: application.jobId,
      actor: 'user',
      detail: { channel, action: kind }
    })
    return this.result(kind, true, [
      `${capitalize(actionText)} prepared for #${applicationId}${reason ? `: ${reason.slice(0, 200)}` : ''}.`,
      'Nothing has changed yet.',
      `Reply /confirm ${code} within 5 minutes to apply it. The code is single-use and expires automatically.`
    ].join('\n'))
  }

  private confirm(rest: string, channel: ChatActor, chatRef: string): ChatCommandResult {
    const code = rest.trim().replace(/\s+/g, '')
    if (!/^\d{6}$/.test(code)) return this.result('confirm', false, 'Usage: /confirm 123456.', false)
    const action = consumeChatAction(this.db, hashCode(code), channel, chatRef, this.now())
    if (!action) return this.result('confirm', false, 'That code is invalid, expired, or belongs to another chat. Prepare the action again.', false)

    try {
      if (action.kind === 'approve') this.applications.approve(action.applicationId)
      else if (action.kind === 'reject') this.applications.reject(action.applicationId, action.reason ?? 'Rejected from chat')
      else if (action.kind === 'retry') this.applications.retry(action.applicationId)
      else throw new Error('Unknown prepared action')

      logEvent(this.db, {
        category: 'chat.action_confirmed',
        message: `Prepared ${action.kind} confirmed from chat for application #${action.applicationId}`,
        applicationId: action.applicationId,
        actor: 'user',
        detail: { channel, action: action.kind }
      })
      const verb = action.kind === 'approve' ? 'approved and queued' : action.kind === 'reject' ? 'rejected' : 'queued for another attempt'
      return this.result('confirm', false, `Application #${action.applicationId} ${verb}. I will send an update if delivery changes state.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logEvent(this.db, {
        category: 'chat.action_failed',
        level: 'warn',
        message: `Prepared ${action.kind} from chat failed: ${message}`,
        applicationId: action.applicationId,
        actor: 'user',
        detail: { channel, action: action.kind }
      })
      return this.result('confirm', false, `The action could not be applied: ${message}`, false)
    }
  }

  private setProfile(rest: string): ChatCommandResult {
    const match = rest.match(/^([A-Za-z_]+)\s+(.+)$/)
    if (!match) {
      return this.result('set', false, 'Usage: /set <field> <value>. Fields: name, email, phone, city, country, residence, linkedin, github, website, summary, years, skills, citizenship, notice, start.', false)
    }
    const key = normalizeField(match[1]!)
    const value = match[2]!.trim()
    if (!key || !PROFILE_FIELD_LABELS[key]) {
      return this.result('set', false, `“${match[1]}” is not an editable field. Send /help for the field list.`, false)
    }
    if (value.length === 0) return this.result('set', false, 'A value is required after the field name.', false)

    const profile = getProfile(this.db)
    const patch: Record<string, unknown> = {}
    let label = PROFILE_FIELD_LABELS[key]

    switch (key) {
      case 'name':
        if (value.length > 200) return this.result('set', false, 'The name is too long.', false)
        patch.fullName = value
        break
      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) || value.length > 320) {
          return this.result('set', false, 'That email address does not look valid. Nothing was saved.', false)
        }
        patch.email = value
        break
      case 'phone':
        if (value.length > 80) return this.result('set', false, 'The phone number is too long.', false)
        patch.phone = value
        break
      case 'city':
        if (value.length > 120) return this.result('set', false, 'The city name is too long.', false)
        patch.city = value
        break
      case 'country':
      case 'residence': {
        if (!/^[A-Za-z]{2}$/.test(value)) {
          return this.result('set', false, 'Use a two-letter country code such as DE, IN, GB, or US.', false)
        }
        const code = value.toUpperCase()
        if (key === 'country') {
          patch.countryCode = code
          if (!profile.residenceCountry) patch.residenceCountry = code
          label = 'Country of location'
        } else {
          patch.residenceCountry = code
        }
        break
      }
      case 'linkedin':
      case 'github':
      case 'website': {
        if (!/^https?:\/\/[^\s]+$/i.test(value) || value.length > 500) {
          return this.result('set', false, 'Use a full http or https address. Nothing was saved.', false)
        }
        patch[key] = value
        break
      }
      case 'summary':
        if (value.length > 4000) return this.result('set', false, 'Keep the summary under 4000 characters.', false)
        patch.summary = value
        break
      case 'years': {
        const years = Number(value.replace(/,/g, '.'))
        if (!Number.isFinite(years) || years < 0 || years > 80) return this.result('set', false, 'Years of experience must be between 0 and 80.', false)
        patch.yearsExperience = years
        break
      }
      case 'skills': {
        const skills = uniqueList(value.split(','))
        if (skills.length === 0) return this.result('set', false, 'Provide at least one skill, separated by commas.', false)
        if (skills.length > 100) return this.result('set', false, 'Keep the skills list under 100 items.', false)
        patch.skills = skills
        label = `Skills (${skills.length})`
        break
      }
      case 'citizenship':
      case 'citizenships': {
        const tokens = value.split(/[,\s]+/).filter(Boolean)
        const codes = [...new Set(tokens.map((item) => item.toUpperCase()))]
        if (codes.length === 0 || codes.some((code) => !/^[A-Z]{2}$/.test(code))) {
          return this.result('set', false, 'Use two-letter citizenship codes, for example /set citizenship IN, GB.', false)
        }
        if (tokens.length !== codes.length) return this.result('set', false, 'Duplicate citizenship codes were provided.', false)
        patch.citizenships = codes
        label = `Citizenship (${codes.join(', ')})`
        break
      }
      case 'notice':
        if (value.length > 120) return this.result('set', false, 'Keep the notice period under 120 characters.', false)
        patch.noticePeriod = value
        break
      case 'start':
        if (value.length > 120) return this.result('set', false, 'Keep the start date under 120 characters.', false)
        patch.earliestStart = value
        break
    }

    saveProfile(this.db, { ...profile, ...patch } as Parameters<typeof saveProfile>[1])
    const reEvaluated = this.onProfileChanged()
    logEvent(this.db, {
      category: 'profile.updated',
      message: `Profile field updated from chat: ${label}`,
      actor: 'user',
      detail: { source: 'chat', field: key, reEvaluated: reEvaluated.evaluated }
    })
    const followUp = key === 'citizenship'
      ? ' Review work authorization for each country in the desktop app.'
      : key === 'skills' || key === 'years'
        ? ` ${reEvaluated.evaluated} job${reEvaluated.evaluated === 1 ? '' : 's'} re-evaluated.`
        : ''
    return this.result('set', false, `${label} updated.${followUp}`)
  }
}

function normalizeCommand(text: string): { command: string; rest: string } | null {
  const lower = text.toLowerCase()
  if (text.startsWith('/')) {
    const [rawToken, ...rest] = text.slice(1).split(' ')
    const token = (rawToken ?? '').split('@')[0]!.toLowerCase()
    return { command: token, rest: rest.join(' ').trim() }
  }
  const [first, ...rest] = text.split(' ')
  const restText = rest.join(' ').trim()
  const word = (first ?? '').toLowerCase().replace(/[.,!?]+$/, '')
  if (/^(status|report|approvals|applications|jobs|missing|pause|resume|scan|help|whoami)$/.test(word)) {
    return { command: word, rest: restText }
  }
  if (/^(approve|reject|retry|confirm|set)$/.test(word)) return { command: word, rest: restText }
  if (word === 'stop') return { command: 'pause', rest: restText }
  if (word === 'continue') return { command: 'resume', rest: restText }
  if (/^(what|how|show|give|check)/.test(word)) {
    if (lower.includes('missing')) return { command: 'missing', rest: restText }
    if (lower.includes('report') || lower.includes('digest')) return { command: 'report', rest: restText }
    if (lower.includes('status')) return { command: 'status', rest: restText }
    if (lower.includes('approv')) return { command: 'approvals', rest: restText }
  }
  return null
}

function normalizeField(input: string): string | null {
  const key = input.trim().toLowerCase().replace(/[^a-z_]/g, '')
  if (PROFILE_FIELD_LABELS[key]) return key
  return PROFILE_FIELD_ALIASES[key] ?? null
}

function uniqueList(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of values) {
    const value = raw.trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(value.slice(0, 80))
  }
  return result
}

function hashCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex')
}

function humanStatus(status: string): string {
  return status.replace(/_/g, ' ')
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function localMidnight(now: number): number {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}
