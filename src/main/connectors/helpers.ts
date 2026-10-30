import { normalizeText, tokenSetSimilarity } from '../core/hash'
import type { FetchTarget } from './types'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

export function str(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

export function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^0-9.-]+/g, ''))
    return Number.isFinite(parsed) && parsed !== 0 ? parsed : null
  }
  return null
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”'
}

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, codeText: string) => {
    const code = codeText.toLowerCase()
    if (code.startsWith('#x')) {
      const point = Number.parseInt(code.slice(2), 16)
      return Number.isFinite(point) ? safeFromCodePoint(point, match) : match
    }
    if (code.startsWith('#')) {
      const point = Number.parseInt(code.slice(1), 10)
      return Number.isFinite(point) ? safeFromCodePoint(point, match) : match
    }
    return ENTITIES[code] ?? match
  })
}

function safeFromCodePoint(point: number, fallback: string): string {
  try {
    return String.fromCodePoint(point)
  } catch {
    return fallback
  }
}

/** Accepts ISO strings, seconds, or millisecond epoch values. */
export function epochMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    if (value > 10_000_000_000) return value
    if (value > 1_000_000_000) return value * 1000
    return null
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export interface BoardEntry {
  token: string
  label: string | null
  domain: string | null
}

/**
 * ATS connectors are configured with a list of company boards. Accepts either
 * plain strings or `{ token, label, domain }` objects so one source can cover
 * several employer career sites without duplicating source rows.
 */
export function boardEntries(config: Record<string, unknown>): BoardEntry[] {
  const raw = config.boards
  const entries: BoardEntry[] = []
  for (const item of asArray(raw)) {
    if (typeof item === 'string' && item.trim().length > 0) {
      entries.push({ token: item.trim(), label: null, domain: null })
      continue
    }
    if (!isRecord(item)) continue
    const token = str(item.token) ?? str(item.board) ?? str(item.company)
    if (!token) continue
    entries.push({ token, label: str(item.label) ?? str(item.company), domain: str(item.domain) })
  }
  return entries
}

export function maxPages(target: FetchTarget, fallback = 3): number {
  return Math.min(Math.max(1, target.pageLimit), 20) || fallback
}

export function searchQueries(target: FetchTarget): string[] {
  const titles = target.jobTitles.map((value) => value.trim()).filter(Boolean)
  if (titles.length > 0) return titles
  return target.keywords.map((value) => value.trim()).filter(Boolean)
}

/**
 * Cheap pre-filter for high-volume aggregators. The full scoring pipeline
 * still runs later; this only prevents fetching thousands of obviously
 * unrelated postings. An empty configuration keeps everything.
 */
export function titleMatchesTarget(title: string, target: FetchTarget): boolean {
  const titles = target.jobTitles.filter((value) => value.trim().length > 0)
  const keywords = target.keywords.filter((value) => value.trim().length > 0)
  if (titles.length === 0 && keywords.length === 0) return true

  let best = 0
  for (const candidate of titles) best = Math.max(best, tokenSetSimilarity(title, candidate))
  if (best >= 0.3) return true

  const normalized = normalizeText(title)
  return keywords.some((keyword) => {
    const needle = normalizeText(keyword)
    return needle.length > 0 && normalized.includes(needle)
  })
}

export function remoteBoardsRelevant(target: FetchTarget): boolean {
  return target.remotePreference !== 'onsite'
}

export function truncate(value: string, max = 4000): string {
  return value.length > max ? value.slice(0, max) : value
}
