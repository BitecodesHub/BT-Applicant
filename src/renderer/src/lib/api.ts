import type { ApiChannel, ApiRequest, ApiResponse } from '@shared/api'

export function hasBridge(): boolean {
  return typeof window !== 'undefined' && Boolean(window.api)
}

export function call<K extends ApiChannel>(channel: K, payload?: ApiRequest<K>): Promise<ApiResponse<K>> {
  if (!hasBridge()) {
    return Promise.reject(
      new Error('The desktop bridge is unavailable. Start this window through the BT Applicant Electron app.')
    )
  }
  return window.api.invoke(channel, payload)
}

export function chooseResumeFile(): Promise<{ canceled: boolean; filePath: string | null }> {
  return window.api.chooseResumeFile()
}

export function openExternal(url: string): Promise<void> {
  return window.api.openExternal(url)
}

export function openPath(path: string): Promise<void> {
  return window.api.openPath(path)
}

export function openWebRun(applicationId: number, url: string): Promise<void> {
  return window.api.openWebRun(applicationId, url)
}

export function exportData(kind: 'jobs' | 'applications' | 'events' | 'outbox') {
  return window.api.exportData(kind)
}

export const queryKeys = {
  bootstrap: ['bootstrap'] as const,
  dashboard: ['dashboard'] as const,
  dailyReport: (date?: string) => ['daily-report', date ?? 'today'] as const,
  diagnostics: ['diagnostics'] as const,
  jobs: (filters: unknown) => ['jobs', filters] as const,
  job: (id: number) => ['job', id] as const,
  applications: (filters: unknown) => ['applications', filters] as const,
  application: (id: number) => ['application', id] as const,
  approvals: ['approvals'] as const,
  sources: ['sources'] as const,
  connectors: ['connectors'] as const,
  targets: ['targets'] as const,
  templates: (kind?: string) => ['templates', kind ?? 'all'] as const,
  templateVersions: (id: number) => ['template-versions', id] as const,
  outbox: (status?: string) => ['outbox', status ?? 'all'] as const,
  queue: ['queue'] as const,
  events: (filters: unknown) => ['events', filters] as const,
  mail: ['mail'] as const,
  ai: ['ai-status'] as const,
  secrets: ['secrets'] as const
}
