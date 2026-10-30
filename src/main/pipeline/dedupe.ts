import type { Db } from '../db/database'
import { findDuplicateCandidates } from '../db/repos/jobs'
import { normalizeText, tokenSetSimilarity } from '../core/hash'

export interface DuplicateCheckJob {
  dedupeKey: string
  fingerprint: string
  company: string
  title: string
  locationRaw: string | null
  url: string
  countryCode: string | null
  id?: number
}

export interface DuplicateMatch {
  id: number
  reason: string
  similarity: number
}

export function canonicalizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    parsed.hostname = parsed.hostname.toLowerCase()
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|ref$|source$|tracking|gclid|fbclid)/i.test(key)) parsed.searchParams.delete(key)
    }
    const path = parsed.pathname.replace(/\/+$/, '') || '/'
    const search = parsed.searchParams.toString()
    return `${parsed.protocol}//${parsed.hostname}${path}${search ? `?${search}` : ''}`
  } catch {
    return url.trim()
  }
}

export function findDuplicate(db: Db, job: DuplicateCheckJob): DuplicateMatch | null {
  const excludeId = job.id ?? -1

  const exactFingerprint = db.get<{ id: number }>(
    "SELECT id FROM jobs WHERE fingerprint = ? AND status = 'active' AND id != ? LIMIT 1",
    job.fingerprint,
    excludeId
  )
  if (exactFingerprint) return { id: exactFingerprint.id, reason: 'description_fingerprint', similarity: 1 }

  const exactKey = db.get<{ id: number }>(
    "SELECT id FROM jobs WHERE dedupe_key = ? AND status = 'active' AND id != ? LIMIT 1",
    job.dedupeKey,
    excludeId
  )
  if (exactKey) return { id: exactKey.id, reason: 'dedupe_key', similarity: 1 }

  const exactUrl = db.get<{ id: number }>(
    "SELECT id FROM jobs WHERE url = ? AND status = 'active' AND id != ? LIMIT 1",
    job.url,
    excludeId
  )
  if (exactUrl) return { id: exactUrl.id, reason: 'canonical_url', similarity: 1 }

  const candidates = findDuplicateCandidates(db, job.company, job.countryCode)
  for (const candidate of candidates) {
    if (candidate.id === excludeId) continue
    if (canonicalizeUrl(candidate.dedupeKey) === canonicalizeUrl(job.dedupeKey)) {
      return { id: candidate.id, reason: 'dedupe_key', similarity: 1 }
    }
    const titleSimilarity = tokenSetSimilarity(job.title, candidate.title)
    if (titleSimilarity < 0.8) continue
    const sameLocation =
      normalizeText(job.locationRaw ?? '') === normalizeText(candidate.locationRaw ?? '') ||
      (!job.locationRaw && !candidate.locationRaw) ||
      (job.countryCode !== null && job.countryCode === candidate.countryCode)
    if (sameLocation) {
      return { id: candidate.id, reason: 'title_location_similarity', similarity: titleSimilarity }
    }
  }

  return null
}
