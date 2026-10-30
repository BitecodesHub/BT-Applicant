import type { Db } from '../db/database'
import type { AiService } from './ai'
import type { MailService, MailAttachment } from './mail'
import { getSection } from '../core/settings'
import { plural } from '../core/text'
import { logEvent } from '../db/repos/events'
import { getJob } from '../db/repos/jobs'
import {
  addResponse,
  claimOutboxMessage,
  countApplicationsForCompanySince,
  countSubmittedSince,
  createOutboxMessage,
  getActiveApplicationForJob,
  getApplication,
  listOutboxForApplication,
  logOutboxAttempt,
  markOutboxFailed,
  markOutboxSent,
  patchApplication,
  setApplicationStatus,
  type ApplicationRecord,
  type OutboxAttachment
} from '../db/repos/applications'
import { getDefaultResume, getProfile, getResume, listWorkAuthorizations, type ResumeRecord } from '../db/repos/profile'
import { getDefaultTemplate, getTemplate } from '../db/repos/templates'
import { createWebRun, getWebRunForApplication, updateWebRun } from '../db/repos/web-runs'
import { enqueue } from '../db/repos/tasks'
import type { ApplicationStatus } from '../../shared/types'

export interface DispatchOutcome {
  applicationId: number
  status: ApplicationStatus
  detail: string
}

export interface DraftOutcome {
  applicationId: number
  status: ApplicationStatus
  aiEnhanced: boolean
  detail: string
}

/**
 * Turns an approved application into a delivery. Email uses a transactional
 * outbox keyed by (application, attempt); web applications become guided runs
 * that require the user to complete employer-specific questions personally.
 */
export class ApplicationService {
  constructor(
    private readonly db: Db,
    private readonly ai: AiService,
    private readonly mail: MailService
  ) {}

  async draft(applicationId: number, signal?: AbortSignal): Promise<DraftOutcome> {
    const application = getApplication(this.db, applicationId)
    if (!application) throw new Error(`Application ${applicationId} not found`)
    if (application.status !== 'draft') {
      return { applicationId, status: application.status, aiEnhanced: false, detail: 'Already drafted.' }
    }

    const job = getJob(this.db, application.jobId)
    if (!job) throw new Error(`Job ${application.jobId} not found`)
    const profile = getProfile(this.db)
    const settings = getSection(this.db, 'automation')

    const resume = application.resumeId ? getResume(this.db, application.resumeId) : getDefaultResume(this.db)
    if (!resume) {
      return this.blockOnHuman(application, 'No resume is stored. Upload a resume before this application can be prepared.')
    }

    const template = application.templateId
      ? getTemplate(this.db, application.templateId)
      : getDefaultTemplate(this.db, 'application_email')
    if (!template) {
      return this.blockOnHuman(application, 'No application email template exists. Create one in Templates.')
    }

    const fit = await this.fitParagraph(job.title, job.company, job.descriptionText, job.skills, signal)
    const variables = this.templateVariables(application, resume)
    const deterministicFit = this.deterministicFit(job.skills)
    const renderedSubject = renderTemplate(template.subject, { ...variables, fit_paragraph: fit.text ?? deterministicFit })
    const renderedBody = renderTemplate(template.body, { ...variables, fit_paragraph: fit.text ?? deterministicFit })

    if (!renderedBody.trim() || !renderedSubject.trim()) {
      return this.blockOnHuman(application, 'The template produced an empty subject or body.')
    }

    const updated = patchApplication(this.db, applicationId, {
      subject: renderedSubject.slice(0, 300),
      body: renderedBody.slice(0, 20_000),
      resumeId: resume.id,
      templateId: template.id,
      lastError: null
    })

    logEvent(this.db, {
      category: 'application.drafted',
      message: `Draft prepared for ${job.title} at ${job.company}`,
      applicationId,
      jobId: job.id,
      detail: {
        channel: application.channel,
        resumeId: resume.id,
        templateId: template.id,
        aiEnhanced: fit.aiUsed,
        aiProvider: fit.provider
      }
    })

    if (fit.aiAttempted && !fit.aiUsed) {
      logEvent(this.db, {
        category: 'ai.fallback',
        level: 'warn',
        message: 'AI drafting was unavailable; the deterministic template was used.',
        applicationId,
        jobId: job.id,
        detail: { reason: fit.aiError }
      })
    }

    if (application.channel === 'manual') {
      return this.blockOnHuman(updated, 'This posting has no verified application channel.')
    }

    const autoApprove = !settings.requireApproval || settings.unattendedEnabled
    if (autoApprove) {
      const queued = setApplicationStatus(this.db, applicationId, 'queued')
      this.enqueueDispatch(applicationId, updated.attempt)
      return { applicationId, status: queued.status, aiEnhanced: fit.aiUsed, detail: 'Draft queued automatically.' }
    }

    const awaiting = setApplicationStatus(this.db, applicationId, 'awaiting_approval')
    logEvent(this.db, {
      category: 'application.awaiting_approval',
      message: `Application for ${job.title} is awaiting approval`,
      applicationId,
      jobId: job.id
    })
    return { applicationId, status: awaiting.status, aiEnhanced: fit.aiUsed, detail: 'Draft is awaiting approval.' }
  }

  approve(applicationId: number): ApplicationRecord {
    const application = getApplication(this.db, applicationId)
    if (!application) throw new Error(`Application ${applicationId} not found`)
    if (application.status === 'approved' || application.status === 'queued') return application
    if (application.status === 'needs_human') {
      throw new Error('This application is blocked. Resolve the reason and use retry instead of approve.')
    }
    if (application.status !== 'awaiting_approval') {
      throw new Error(`Cannot approve an application in status ${application.status}`)
    }
    const approved = setApplicationStatus(this.db, applicationId, 'approved')
    const queued = setApplicationStatus(this.db, applicationId, 'queued')
    this.enqueueDispatch(applicationId, approved.attempt)
    logEvent(this.db, {
      category: 'application.approved',
      message: `Application #${applicationId} approved by the user`,
      applicationId,
      jobId: application.jobId,
      actor: 'user'
    })
    return queued
  }

  reject(applicationId: number, reason: string | null = null): ApplicationRecord {
    const application = getApplication(this.db, applicationId)
    if (!application) throw new Error(`Application ${applicationId} not found`)
    const rejected = setApplicationStatus(this.db, applicationId, 'rejected', { error: reason })
    logEvent(this.db, {
      category: 'application.rejected',
      message: `Application #${applicationId} rejected by the user`,
      applicationId,
      jobId: application.jobId,
      detail: { reason },
      actor: 'user'
    })
    return rejected
  }

  retry(applicationId: number): ApplicationRecord {
    const application = getApplication(this.db, applicationId)
    if (!application) throw new Error(`Application ${applicationId} not found`)
    if (application.status === 'submitted') throw new Error('This application was already submitted.')

    if (application.status === 'failed' || application.status === 'needs_human') {
      this.db.run('UPDATE applications SET attempt = attempt + 1, updated_at = ? WHERE id = ?', Date.now(), applicationId)
      const refreshed = getApplication(this.db, applicationId)!
      const queued = setApplicationStatus(this.db, applicationId, 'queued')
      this.enqueueDispatch(applicationId, refreshed.attempt)
      logEvent(this.db, {
        category: 'application.retry',
        message: `Application #${applicationId} queued for another attempt`,
        applicationId,
        jobId: application.jobId,
        actor: 'user'
      })
      return queued
    }

    throw new Error(`Cannot retry an application in status ${application.status}`)
  }

  async dispatch(applicationId: number, signal?: AbortSignal): Promise<DispatchOutcome> {
    const application = getApplication(this.db, applicationId)
    if (!application) throw new Error(`Application ${applicationId} not found`)
    if (application.status === 'submitted') return { applicationId, status: 'submitted', detail: 'Already submitted.' }
    if (application.status !== 'queued') {
      throw new Error(`Application ${applicationId} is ${application.status}, not queued.`)
    }

    const job = getJob(this.db, application.jobId)
    if (!job) throw new Error(`Job ${application.jobId} not found`)

    const automation = getSection(this.db, 'automation')
    if (automation.paused) {
      return { applicationId, status: application.status, detail: 'Automation is paused; nothing was sent.' }
    }
    if (!automation.allowedChannels.includes(application.channel)) {
      return this.toHuman(application, `The ${application.channel} channel is disabled in automation settings.`)
    }

    const alreadySubmitted = this.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM applications WHERE job_id = ? AND status = 'submitted'",
      application.jobId
    )?.n
    if ((alreadySubmitted ?? 0) > 0) {
      return this.toHuman(application, 'A submitted application already exists for this job.')
    }

    const todayStart = localMidnight()
    const submittedToday = countSubmittedSince(this.db, todayStart)
    if (submittedToday >= automation.dailyApplicationLimit) {
      logEvent(this.db, {
        category: 'application.limit',
        level: 'warn',
        message: `Daily application limit (${automation.dailyApplicationLimit}) reached; application stays queued.`,
        applicationId,
        jobId: application.jobId
      })
      return { applicationId, status: application.status, detail: 'Daily limit reached; still queued.' }
    }
    const companyToday = countApplicationsForCompanySince(this.db, job.company, todayStart, applicationId)
    if (companyToday >= automation.maxApplicationsPerCompanyPerDay) {
      return this.toHuman(
        application,
        `Daily cap for ${job.company} (${automation.maxApplicationsPerCompanyPerDay}) reached. Resume manually if this is intentional.`
      )
    }

    if (application.channel === 'email') return this.dispatchEmail(application, signal)
    if (application.channel === 'web') return this.prepareWebRun(application)
    return this.toHuman(application, 'This application needs a manual channel.')
  }

  async reconcile(): Promise<{ requeued: number; markedUncertain: number }> {
    const automation = getSection(this.db, 'automation')
    let requeued = 0
    if (!automation.paused) {
      const stale = this.db.all<{ id: number; attempt: number }>(
        `SELECT id, attempt FROM applications WHERE status = 'queued' AND updated_at < ? ORDER BY updated_at LIMIT 100`,
        Date.now() - 10 * 60_000
      )
      for (const row of stale) {
        this.enqueueDispatch(row.id, row.attempt)
        requeued += 1
      }
    }

    const cutoff = Date.now() - 5 * 60_000
    const markedUncertain = this.db.run(
      `UPDATE outbox_messages SET status = 'uncertain', updated_at = ?
       WHERE status = 'sending' AND updated_at < ?`,
      Date.now(),
      cutoff
    ).changes
    if (markedUncertain > 0) {
      logEvent(this.db, {
        category: 'email.failed',
        level: 'warn',
        message: `${plural(markedUncertain, 'outbox message')} left in sending state and marked uncertain.`,
        detail: { cutoff }
      })
    }
    return { requeued, markedUncertain }
  }

  recordResponse(applicationId: number, kind: string, notes: string | null): void {
    const application = getApplication(this.db, applicationId)
    if (!application) throw new Error(`Application ${applicationId} not found`)
    addResponse(this.db, { applicationId, kind, notes })
    logEvent(this.db, {
      category: 'response.received',
      message: `Response recorded for application #${applicationId}: ${kind}`,
      applicationId,
      jobId: application.jobId,
      actor: 'user'
    })
  }

  confirmWebSubmission(applicationId: number, confirmationNote: string): ApplicationRecord {
    const application = getApplication(this.db, applicationId)
    if (!application) throw new Error(`Application ${applicationId} not found`)
    if (application.channel !== 'web') throw new Error('Only web applications can be confirmed here.')

    const run = getWebRunForApplication(this.db, applicationId)
    if (run) {
      updateWebRun(this.db, run.id, {
        status: 'submitted',
        confirmation: { note: confirmationNote, recordedBy: 'user', recordedAt: Date.now() },
        steps: run.steps.map((step) => (step.status === 'pending' ? { ...step, status: 'done' as const } : step))
      })
    }

    if (application.status !== 'queued' && application.status !== 'needs_human') {
      throw new Error(`Cannot confirm submission from status ${application.status}`)
    }
    const submitted = setApplicationStatus(this.db, applicationId, 'submitted', {
      confirmation: { kind: 'web', note: confirmationNote, recordedBy: 'user' }
    })
    logEvent(this.db, {
      category: 'application.submitted',
      message: `Web application for job #${application.jobId} recorded as submitted by the user`,
      applicationId,
      jobId: application.jobId,
      detail: { channel: 'web', note: confirmationNote },
      actor: 'user'
    })
    return submitted
  }

  private async dispatchEmail(application: ApplicationRecord, signal?: AbortSignal): Promise<DispatchOutcome> {
    const job = getJob(this.db, application.jobId)
    if (!job) throw new Error(`Job ${application.jobId} not found`)
    if (!application.recipient) return this.toHuman(application, 'No verified recipient address is attached to this application.')
    if (!job.applicationEmail || job.applicationEmail.toLowerCase() !== application.recipient.toLowerCase()) {
      return this.toHuman(application, 'The recipient does not match the address verified from the posting.')
    }
    if (!job.applicationEmailEvidence) {
      return this.toHuman(application, 'The recipient address has no quoted evidence from the posting.')
    }
    if (!application.subject || !application.body) {
      return this.toHuman(application, 'The draft has no subject or body.')
    }

    const resume = application.resumeId ? getResume(this.db, application.resumeId) : getDefaultResume(this.db)
    if (!resume) return this.toHuman(application, 'The selected resume file is missing.')

    const outbound = getSection(this.db, 'outbound')
    const adapter = this.mail.effectiveMode()
    const { message } = createOutboxMessage(this.db, {
      applicationId: application.id,
      adapter,
      toAddress: application.recipient,
      fromAddress: outbound.smtp.fromEmail || null,
      subject: application.subject,
      bodyText: application.body,
      attachments: [toAttachment(resume)],
      attempt: application.attempt
    })

    if (message.status === 'sent') {
      const submitted = setApplicationStatus(this.db, application.id, 'submitted', {
        confirmation: { adapter: message.adapter, providerMessageId: message.providerMessageId, sentAt: message.sentAt }
      })
      return { applicationId: application.id, status: submitted.status, detail: 'Outbox already sent this attempt.' }
    }

    const claimed = claimOutboxMessage(this.db, message.id)
    if (!claimed) {
      return { applicationId: application.id, status: application.status, detail: 'Outbox message could not be claimed.' }
    }

    const sending = setApplicationStatus(this.db, application.id, 'sending')
    const startedAt = Date.now()
    try {
      const result = await this.mail.send({
        to: application.recipient,
        subject: application.subject,
        text: application.body,
        attachments: [toMailAttachment(resume)],
        applicationId: application.id
      })
      signal?.throwIfAborted()
      markOutboxSent(this.db, claimed.id, result.providerMessageId)
      logOutboxAttempt(this.db, {
        outboxId: claimed.id,
        attempt: claimed.attempt,
        startedAt,
        result: 'sent',
        providerResponse: { adapter: result.adapter, response: result.response, blockedByKillSwitch: result.blockedByKillSwitch }
      })
      const submitted = setApplicationStatus(this.db, application.id, 'submitted', {
        confirmation: {
          adapter: result.adapter,
          providerMessageId: result.providerMessageId,
          response: result.response,
          to: application.recipient,
          subject: application.subject,
          blockedByKillSwitch: result.blockedByKillSwitch
        }
      })
      logEvent(this.db, {
        category: 'email.sent',
        message: `Application email to ${application.recipient} recorded via ${result.adapter}`,
        applicationId: application.id,
        jobId: job.id,
        detail: { adapter: result.adapter, providerMessageId: result.providerMessageId, mocked: result.adapter === 'mock' }
      })
      logEvent(this.db, {
        category: 'application.submitted',
        message: `Application for ${job.title} at ${job.company} submitted via email`,
        applicationId: application.id,
        jobId: job.id,
        detail: { channel: 'email', adapter: result.adapter }
      })
      return { applicationId: application.id, status: submitted.status, detail: `Sent via ${result.adapter}.` }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error)
      const uncertain = isUncertainDeliveryError(messageText)
      markOutboxFailed(this.db, claimed.id, messageText, uncertain ? 'uncertain' : 'failed')
      logOutboxAttempt(this.db, {
        outboxId: claimed.id,
        attempt: claimed.attempt,
        startedAt,
        result: uncertain ? 'uncertain' : 'failed',
        error: messageText
      })
      const next = uncertain ? 'uncertain' : 'failed'
      const failed = setApplicationStatus(this.db, application.id, next, { error: messageText })
      logEvent(this.db, {
        category: uncertain ? 'application.uncertain' : 'application.failed',
        level: uncertain ? 'warn' : 'error',
        message: uncertain
          ? `Delivery outcome for application #${application.id} is uncertain: ${messageText}`
          : `Application #${application.id} failed: ${messageText}`,
        applicationId: application.id,
        jobId: job.id
      })
      logEvent(this.db, {
        category: 'email.failed',
        level: uncertain ? 'warn' : 'error',
        message: `Application email to ${application.recipient} ${uncertain ? 'has an uncertain outcome' : 'failed'}`,
        applicationId: application.id,
        jobId: job.id,
        detail: { error: messageText }
      })
      void sending
      return { applicationId: application.id, status: failed.status, detail: messageText }
    }
  }

  private prepareWebRun(application: ApplicationRecord): DispatchOutcome {
    const job = getJob(this.db, application.jobId)
    if (!job) throw new Error(`Job ${application.jobId} not found`)
    const url = application.applyUrl ?? job.applyUrl ?? job.url
    const profile = getProfile(this.db)
    const authorizations = listWorkAuthorizations(this.db)
    const prefilled = {
      fullName: profile.fullName,
      email: profile.email,
      phone: profile.phone ?? '',
      city: profile.city ?? '',
      country: profile.countryCode ?? '',
      linkedin: profile.linkedin ?? '',
      website: profile.website ?? '',
      coverLetter: application.body ?? '',
      resumeFileName: application.resumeId ? getResume(this.db, application.resumeId)?.fileName ?? '' : getDefaultResume(this.db)?.fileName ?? '',
      workAuthorizationSummary: authorizations.map((item) => `${item.countryCode}: ${item.status}${item.validUntil ? ` until ${item.validUntil}` : ''}`)
    }

    const existing = getWebRunForApplication(this.db, application.id)
    if (!existing) {
      createWebRun(this.db, {
        applicationId: application.id,
        url,
        status: 'awaiting_human',
        steps: [
          { label: 'Open the employer application page', status: 'pending' },
          { label: 'Attach the selected resume', status: 'pending' },
          { label: 'Fill known fields from your verified profile', status: 'pending' },
          { label: 'Answer employer-specific questions', status: 'blocked', detail: 'Requires your input; the assistant never guesses answers.' },
          { label: 'Submit and record the confirmation', status: 'pending' }
        ],
        prefilled
      })
    }

    const human = setApplicationStatus(this.db, application.id, 'needs_human', {
      error: 'Web applications need your confirmation in the guided submission window.'
    })
    logEvent(this.db, {
      category: 'application.needs_human',
      level: 'warn',
      message: `Web application for ${job.title} is ready for guided submission`,
      applicationId: application.id,
      jobId: job.id,
      detail: { url }
    })
    return { applicationId: application.id, status: human.status, detail: 'Guided web submission prepared.' }
  }

  private enqueueDispatch(applicationId: number, attempt: number): void {
    enqueue(this.db, {
      type: 'application.dispatch',
      payload: { applicationId },
      priority: 5,
      idempotencyKey: `dispatch:${applicationId}:${attempt}`
    })
  }

  private toHuman(application: ApplicationRecord, reason: string): DispatchOutcome {
    let current = application
    if (application.status !== 'needs_human') {
      try {
        current = setApplicationStatus(this.db, application.id, 'needs_human', { error: reason })
      } catch {
        current = application
      }
    }
    logEvent(this.db, {
      category: 'application.needs_human',
      level: 'warn',
      message: `Application #${application.id} needs attention: ${reason}`,
      applicationId: application.id,
      jobId: application.jobId
    })
    return { applicationId: application.id, status: current.status, detail: reason }
  }

  private blockOnHuman(application: ApplicationRecord, reason: string): DraftOutcome {
    const current = setApplicationStatus(this.db, application.id, 'needs_human', { error: reason })
    logEvent(this.db, {
      category: 'application.needs_human',
      level: 'warn',
      message: `Application #${application.id} needs attention: ${reason}`,
      applicationId: application.id,
      jobId: application.jobId
    })
    return { applicationId: application.id, status: current.status, aiEnhanced: false, detail: reason }
  }

  private templateVariables(application: ApplicationRecord, resume: ResumeRecord): Record<string, string> {
    const profile = getProfile(this.db)
    const job = getJob(this.db, application.jobId)!
    const contact = [profile.email, profile.phone].filter(Boolean).join(' | ')
    const locationSuffix = job.locationRaw ? ` in ${job.locationRaw}` : ''
    const skills = profile.skills.length > 0 ? profile.skills.slice(0, 8).map((skill) => `• ${skill}`).join('\n') : '• See attached resume'
    return {
      candidate_name: profile.fullName || 'Your name',
      candidate_first_name: profile.fullName.split(' ')[0] || 'there',
      candidate_email: profile.email,
      candidate_phone: profile.phone ?? '',
      candidate_contact: contact,
      candidate_city: profile.city ?? '',
      linkedin: profile.linkedin ?? '',
      website: profile.website ?? '',
      summary: profile.summary ?? '',
      years_experience: profile.yearsExperience !== null ? String(profile.yearsExperience) : '',
      skills_list: skills,
      resume_name: resume.fileName,
      job_title: job.title,
      company: job.company,
      job_location: job.locationRaw ?? '',
      job_location_suffix: locationSuffix,
      job_url: job.url
    }
  }

  private deterministicFit(jobSkills: string[]): string {
    const profile = getProfile(this.db)
    const wanted = new Set(jobSkills.map((skill) => skill.toLowerCase()))
    const overlap = profile.skills.filter((skill) => wanted.has(skill.toLowerCase()))
    if (overlap.length > 0) {
      return `The posting calls for ${jobSkills.slice(0, 4).join(', ') || 'the listed skills'}, and my verified background includes ${overlap.slice(0, 4).join(', ')}.`
    }
    if (profile.summary) return profile.summary
    return 'My background matches the responsibilities described in the posting, as detailed in the attached resume.'
  }

  private async fitParagraph(
    title: string,
    company: string,
    description: string,
    jobSkills: string[],
    signal?: AbortSignal
  ): Promise<{ text: string | null; aiUsed: boolean; aiAttempted: boolean; aiError: string | null; provider: string | null }> {
    if (!this.ai.isEnabled()) return { text: null, aiUsed: false, aiAttempted: false, aiError: null, provider: null }
    const profile = getProfile(this.db)
    const result = await this.ai.complete(
      {
        purpose: 'application.draft',
        system:
          'You write one short, factual paragraph for a job application email. Use only the facts supplied. Never invent skills, jobs, achievements, numbers, dates, degrees, certifications, companies, emails, or links. If a fact is missing, omit it. Do not mention AI. Return plain text only, 45 to 85 words, no greeting, no sign-off.',
        prompt: [
          `Candidate name: ${profile.fullName}`,
          `Summary: ${profile.summary || '(none)'}`,
          `Verified skills: ${profile.skills.join(', ') || '(none)'}`,
          `Years of experience: ${profile.yearsExperience ?? '(not stated)'}`,
          `Target role: ${title}`,
          `Company: ${company}`,
          `Role skills mentioned: ${jobSkills.slice(0, 8).join(', ') || '(none)'}`,
          `Posting excerpt: ${description.replace(/\s+/g, ' ').slice(0, 3000)}`
        ].join('\n'),
        maxTokens: 260
      },
      signal
    )

    if (!result.ok || !result.text) {
      return { text: null, aiUsed: false, aiAttempted: true, aiError: result.error, provider: null }
    }

    const text = result.text.replace(/^["']|["']$/g, '').trim()
    if (!isSafeFitParagraph(text)) {
      return { text: null, aiUsed: false, aiAttempted: true, aiError: 'AI output contained unverifiable details', provider: result.provider }
    }
    return { text, aiUsed: true, aiAttempted: true, aiError: null, provider: result.provider }
  }
}

function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (match, key: string) => variables[key] ?? match)
}

function toAttachment(resume: ResumeRecord): OutboxAttachment {
  return {
    resumeId: resume.id,
    fileName: resume.fileName,
    storedPath: resume.storedPath,
    sizeBytes: resume.sizeBytes,
    mimeType: resume.mimeType,
    sha256: resume.sha256
  }
}

function toMailAttachment(resume: ResumeRecord): MailAttachment {
  return { filename: resume.fileName, path: resume.storedPath, contentType: resume.mimeType }
}

function isSafeFitParagraph(text: string): boolean {
  if (text.length < 80 || text.length > 900) return false
  if (/\d/.test(text)) return false
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) return false
  if (/https?:\/\//i.test(text)) return false
  return true
}

function isUncertainDeliveryError(message: string): boolean {
  return /ECONNRESET|ETIMEDOUT|socket hang up|timeout after/i.test(message)
}

function localMidnight(): number {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function resumeAttachment(resume: ResumeRecord): MailAttachment {
  return toMailAttachment(resume)
}

export function activeApplicationForJob(db: Db, jobId: number): ApplicationRecord | undefined {
  return getActiveApplicationForJob(db, jobId)
}

export function outboxForApplication(db: Db, applicationId: number) {
  return listOutboxForApplication(db, applicationId)
}
