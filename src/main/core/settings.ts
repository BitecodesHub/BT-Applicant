import type { Db } from '../db/database'
import { parseJson, toJson } from './json'

import type {
  AiSettings,
  AppSettings,
  AutomationSettings,
  ChatSettings,
  DigestSettings,
  OnboardingSettings,
  OutboundSettings,
  RetentionSettings,
  SettingsSection,
  SmtpSettings,
  UiSettings,
  WorkerSettings
} from '../../shared/settings'

export type {
  AiSettings,
  AppSettings,
  AutomationSettings,
  ChatSettings,
  DigestSettings,
  OnboardingSettings,
  OutboundSettings,
  RetentionSettings,
  SettingsSection,
  SmtpSettings,
  UiSettings,
  WorkerSettings
}
import { SETTINGS_SECTIONS } from '../../shared/settings'
export { SETTINGS_SECTIONS }

export const DEFAULT_SETTINGS: AppSettings = {
  automation: {
    paused: false,
    unattendedEnabled: false,
    requireApproval: true,
    dailyApplicationLimit: 10,
    minScore: 55,
    allowedChannels: ['email', 'web'],
    excludeCompanies: [],
    maxApplicationsPerCompanyPerDay: 1
  },
  outbound: {
    mode: 'mock',
    killSwitch: true,
    smtp: {
      host: '',
      port: 587,
      secure: true,
      user: '',
      fromEmail: '',
      fromName: ''
    }
  },
  ai: {
    mode: 'enhanced',
    chain: ['ollama', 'anthropic', 'openai', 'gemini'],
    models: {
      ollama: 'llama3.2',
      anthropic: 'claude-sonnet-4-5',
      openai: 'gpt-5',
      gemini: 'gemini-2.5-pro',
      openai_compatible: 'local-model'
    },
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    compatibleBaseUrl: '',
    timeoutMs: 20_000,
    maxCallsPerDay: 150,
    maxOutputTokens: 1200,
    temperature: 0.2
  },
  digest: {
    enabled: true,
    time: '19:00',
    notify: true
  },
  ui: {
    theme: 'system',
    density: 'comfortable'
  },
  retention: {
    eventsDays: 180,
    jobsDays: 365,
    aiCallsDays: 90
  },
  worker: {
    concurrency: 3,
    pollIntervalMs: 1000,
    leaseMs: 120_000
  },
  onboarding: {
    completed: false,
    step: 0
  },
  chat: {
    enabled: false,
    commandsEnabled: true,
    telegram: {
      enabled: false,
      chatId: '',
      username: '',
      pollSeconds: 10
    },
    whatsapp: {
      enabled: false,
      phoneNumberId: '',
      businessAccountId: '',
      toPhone: '',
      webhookPort: 4780,
      webhookPath: '/whatsapp/webhook',
      graphVersion: 'v23.0'
    },
    notify: {
      approvals: true,
      submitted: true,
      failures: true,
      digest: true,
      sources: true
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mergeSection<T>(defaults: T, stored: unknown): T {
  if (!isPlainObject(defaults) || !isPlainObject(stored)) {
    return stored === undefined ? defaults : (stored as T)
  }
  const merged: Record<string, unknown> = { ...defaults }
  for (const [key, value] of Object.entries(stored)) {
    const base = defaults[key]
    merged[key] = isPlainObject(base) && isPlainObject(value) ? mergeSection(base, value) : value
  }
  return merged as T
}

export function loadSettings(db: Db): AppSettings {
  const rows = db.all<{ key: string; value: string }>('SELECT key, value FROM settings')
  const stored = new Map(rows.map((row) => [row.key, parseJson<unknown>(row.value, undefined)]))
  const settings: Record<string, unknown> = {}
  for (const section of SETTINGS_SECTIONS) {
    const defaults = DEFAULT_SETTINGS[section]
    const value = mergeSection(defaults, stored.get(section))
    settings[section] = value
  }
  return settings as unknown as AppSettings
}

export function getSection<K extends SettingsSection>(db: Db, section: K): AppSettings[K] {
  return loadSettings(db)[section]
}

export function saveSection<K extends SettingsSection>(db: Db, section: K, value: AppSettings[K]): AppSettings[K] {
  db.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    section,
    toJson(value),
    Date.now()
  )
  return loadSettings(db)[section]
}

export function sectionMinutes(section: { time: string }): number {
  const [hours, minutes] = section.time.split(':').map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0)
}
