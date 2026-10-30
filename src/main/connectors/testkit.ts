import type { FetchTarget, ConnectorContext } from './types'
import type { SourceRecord } from '../db/repos/sources'

export function verificationTarget(countryCode = 'US'): FetchTarget {
  return {
    countryCode,
    jobTitles: ['DevOps Engineer', 'Cloud Engineer', 'Platform Engineer'],
    keywords: ['kubernetes', 'aws', 'terraform'],
    remotePreference: 'any',
    pageLimit: 2
  }
}

export function mockSource(connector: string, config: Record<string, unknown>, id = `verify-${connector}`): SourceRecord {
  const now = Date.now()
  return {
    id,
    connector,
    label: connector,
    config,
    enabled: true,
    countries: [],
    rateLimitPerMinute: 30,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    consecutiveFailures: 0,
    lastItemCount: null,
    verifiedAt: null,
    createdAt: now,
    updatedAt: now
  }
}

export function verificationContext(
  connector: string,
  config: Record<string, unknown>,
  credentials: Record<string, string> = {},
  countryCode = 'US'
): ConnectorContext {
  return {
    source: mockSource(connector, config),
    credentials,
    target: verificationTarget(countryCode),
    fetchImpl: fetch,
    userAgent: 'BTApplicant/0.1 verification (+personal job search tool)'
  }
}
