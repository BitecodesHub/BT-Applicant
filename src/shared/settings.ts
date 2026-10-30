import type { AiMode, AiProviderId, ApplicationChannel } from './types'

export interface AutomationSettings {
  paused: boolean
  unattendedEnabled: boolean
  requireApproval: boolean
  dailyApplicationLimit: number
  minScore: number
  allowedChannels: ApplicationChannel[]
  excludeCompanies: string[]
  maxApplicationsPerCompanyPerDay: number
}

export interface SmtpSettings {
  host: string
  port: number
  secure: boolean
  user: string
  fromEmail: string
  fromName: string
}

export interface OutboundSettings {
  mode: 'mock' | 'smtp'
  killSwitch: boolean
  smtp: SmtpSettings
}

export interface AiSettings {
  mode: AiMode
  chain: AiProviderId[]
  models: Record<AiProviderId, string>
  ollamaBaseUrl: string
  compatibleBaseUrl: string
  timeoutMs: number
  maxCallsPerDay: number
  maxOutputTokens: number
  temperature: number
}

export interface DigestSettings {
  enabled: boolean
  time: string
  notify: boolean
}

export interface UiSettings {
  theme: 'light' | 'dark' | 'system'
  density: 'comfortable' | 'compact'
}

export interface RetentionSettings {
  eventsDays: number
  jobsDays: number
  aiCallsDays: number
}

export interface WorkerSettings {
  concurrency: number
  pollIntervalMs: number
  leaseMs: number
}

export interface OnboardingSettings {
  completed: boolean
  step: number
}

export interface ChatNotifySettings {
  approvals: boolean
  submitted: boolean
  failures: boolean
  digest: boolean
  sources: boolean
}

export interface TelegramChatSettings {
  enabled: boolean
  chatId: string
  username: string
  pollSeconds: number
}

export interface WhatsAppChatSettings {
  enabled: boolean
  phoneNumberId: string
  businessAccountId: string
  toPhone: string
  webhookPort: number
  webhookPath: string
  graphVersion: string
}

export interface ChatSettings {
  enabled: boolean
  commandsEnabled: boolean
  telegram: TelegramChatSettings
  whatsapp: WhatsAppChatSettings
  notify: ChatNotifySettings
}

export interface AppSettings {
  automation: AutomationSettings
  outbound: OutboundSettings
  ai: AiSettings
  digest: DigestSettings
  ui: UiSettings
  retention: RetentionSettings
  worker: WorkerSettings
  onboarding: OnboardingSettings
  chat: ChatSettings
}

export const SETTINGS_SECTIONS = [
  'automation',
  'outbound',
  'ai',
  'digest',
  'ui',
  'retention',
  'worker',
  'onboarding',
  'chat'
] as const

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]
