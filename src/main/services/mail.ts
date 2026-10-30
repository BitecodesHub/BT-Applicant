import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import nodemailer from 'nodemailer'
import type { Db } from '../db/database'
import { getSection } from '../core/settings'
import type { SecretStore } from '../core/secrets'
import { sha256 } from '../core/hash'
import { logEvent } from '../db/repos/events'

export interface MailAttachment {
  filename: string
  path: string
  contentType: string
}

export interface MailMessage {
  to: string
  subject: string
  text: string
  attachments: MailAttachment[]
  applicationId: number | null
}

export interface MailSendResult {
  adapter: 'mock' | 'smtp'
  providerMessageId: string
  response: string
  blockedByKillSwitch: boolean
}

export interface MailStatus {
  mode: 'mock' | 'smtp'
  killSwitch: boolean
  smtpConfigured: boolean
  credentialPresent: boolean
  fromAddress: string
  message: string
}

/**
 * Delivers application emails. In mock mode nothing leaves the machine; the
 * exact message is written to the app data directory for inspection. The kill
 * switch forces mock mode even when SMTP is configured.
 */
export class MailService {
  constructor(
    private readonly db: Db,
    private readonly secrets: SecretStore,
    private readonly mockDir: string
  ) {}

  status(): MailStatus {
    const outbound = getSection(this.db, 'outbound')
    const credentialPresent = Boolean(this.secrets.get('smtp.password'))
    const smtpConfigured = Boolean(outbound.smtp.host && outbound.smtp.user && outbound.smtp.fromEmail)
    const mode = this.effectiveMode()
    const message =
      mode === 'smtp'
        ? `Live SMTP delivery through ${outbound.smtp.host}:${outbound.smtp.port}.`
        : outbound.killSwitch
          ? 'Kill switch is on: every message stays local in the mock outbox.'
          : outbound.mode === 'mock'
            ? 'Mock delivery mode is selected: messages are written locally, never sent.'
            : 'SMTP is selected but incomplete, so messages stay local in the mock outbox.'
    return {
      mode,
      killSwitch: outbound.killSwitch,
      smtpConfigured,
      credentialPresent,
      fromAddress: outbound.smtp.fromEmail,
      message
    }
  }

  effectiveMode(): 'mock' | 'smtp' {
    const outbound = getSection(this.db, 'outbound')
    if (outbound.killSwitch || outbound.mode === 'mock') return 'mock'
    const smtp = outbound.smtp
    if (!smtp.host || !smtp.user || !smtp.fromEmail || !this.secrets.get('smtp.password')) return 'mock'
    return 'smtp'
  }

  async send(message: MailMessage): Promise<MailSendResult> {
    const mode = this.effectiveMode()
    if (mode === 'mock') {
      const result = this.writeMockMessage(message)
      logEvent(this.db, {
        category: 'email.mock_sent',
        message: `Mock application email recorded for ${message.to}`,
        applicationId: message.applicationId,
        detail: { providerMessageId: result.providerMessageId, subject: message.subject }
      })
      return result
    }
    return this.sendSmtp(message)
  }

  async verify(): Promise<{ ok: boolean; mode: 'mock' | 'smtp'; message: string }> {
    const mode = this.effectiveMode()
    if (mode === 'mock') {
      return { ok: true, mode, message: this.status().message }
    }
    const outbound = getSection(this.db, 'outbound')
    const password = this.secrets.get('smtp.password')
    if (!password) return { ok: false, mode, message: 'No SMTP password is stored in the keychain.' }
    try {
      const transporter = this.transporter(password)
      await transporter.verify()
      return { ok: true, mode, message: `SMTP login verified for ${outbound.smtp.user}.` }
    } catch (error) {
      return { ok: false, mode, message: error instanceof Error ? error.message : String(error) }
    }
  }

  private writeMockMessage(message: MailMessage): MailSendResult {
    mkdirSync(this.mockDir, { recursive: true })
    const outbound = getSection(this.db, 'outbound')
    const from = outbound.smtp.fromEmail || 'candidate@local'
    const providerMessageId = `mock-${sha256(`${Date.now()}|${message.to}|${message.subject}`).slice(0, 24)}`
    const attachmentLines = message.attachments
      .map((attachment) => `X-Attachment: ${attachment.filename} (${attachment.contentType})`)
      .join('\n')
    const eml = [
      `From: ${outbound.smtp.fromName ? `"${outbound.smtp.fromName}" ` : ''}<${from}>`,
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${providerMessageId}@local.mock>`,
      'X-Delivery-Mode: mock (no network transmission)',
      attachmentLines,
      '',
      message.text,
      ''
    ].join('\n')
    const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}-${providerMessageId}.eml`
    writeFileSync(join(this.mockDir, fileName), eml, 'utf8')
    return {
      adapter: 'mock',
      providerMessageId,
      response: `Local mock: ${fileName}`,
      blockedByKillSwitch: getSection(this.db, 'outbound').killSwitch
    }
  }

  private async sendSmtp(message: MailMessage): Promise<MailSendResult> {
    const outbound = getSection(this.db, 'outbound')
    const password = this.secrets.get('smtp.password')
    if (!password) throw new Error('SMTP password is missing from the keychain.')

    const transporter = this.transporter(password)
    const info = await transporter.sendMail({
      from: {
        name: outbound.smtp.fromName || undefined,
        address: outbound.smtp.fromEmail
      },
      to: message.to,
      subject: message.subject,
      text: message.text,
      attachments: message.attachments.map((attachment) => ({
        filename: attachment.filename,
        path: attachment.path,
        contentType: attachment.contentType
      }))
    })
    return {
      adapter: 'smtp',
      providerMessageId: info.messageId ?? '',
      response: info.response ?? 'accepted',
      blockedByKillSwitch: false
    }
  }

  private transporter(password: string) {
    const outbound = getSection(this.db, 'outbound')
    return nodemailer.createTransport({
      host: outbound.smtp.host,
      port: outbound.smtp.port,
      secure: outbound.smtp.secure,
      auth: { user: outbound.smtp.user, pass: password },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000
    })
  }
}
