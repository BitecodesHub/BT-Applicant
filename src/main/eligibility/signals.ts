import type { SponsorEvidence, SponsorshipSignal, WorkAuthStatement } from '../../shared/types'
import { compiledSignalRules } from './rules'

export interface SignalMatch {
  ruleId: string
  signal: SponsorshipSignal
  quote: string
  offset: number
  index: number
}

export interface SignalExtraction {
  signal: SponsorshipSignal
  evidence: SponsorEvidence
  statements: WorkAuthStatement[]
  conflicting: boolean
  signalsFound: SponsorshipSignal[]
  matches: SignalMatch[]
}

const DOMINANCE: SponsorshipSignal[] = [
  'citizenship_or_clearance_required',
  'sponsorship_not_offered',
  'existing_right_to_work_required',
  'sponsorship_offered',
  'unstated'
]

function sentenceAround(text: string, index: number): { quote: string; offset: number } {
  let start = 0
  for (const separator of ['.', '!', '?', '\n']) {
    const found = text.lastIndexOf(separator, index - 1)
    if (found > start) start = found + 1
  }
  let end = text.length
  for (const separator of ['.', '!', '?', '\n']) {
    const found = text.indexOf(separator, index)
    if (found !== -1 && found + 1 < end) end = found + 1
  }
  const quote = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return { quote: quote.slice(0, 400), offset: start }
}

export function extractSponsorshipSignals(text: string): SignalExtraction {
  const matches: SignalMatch[] = []
  const seen = new Set<string>()

  if (text && text.trim().length > 0) {
    for (const rule of compiledSignalRules) {
      rule.regex.lastIndex = 0
      const match = rule.regex.exec(text)
      if (!match || match.index === undefined) continue
      const key = `${rule.id}:${match.index}`
      if (seen.has(key)) continue
      seen.add(key)
      const { quote, offset } = sentenceAround(text, match.index)
      matches.push({ ruleId: rule.id, signal: rule.signal, quote, offset, index: match.index })
    }
  }

  if (matches.length === 0) {
    return {
      signal: 'unstated',
      evidence: {
        signal: 'unstated',
        quote: null,
        offset: null,
        ruleId: null,
        source: 'deterministic'
      },
      statements: [],
      conflicting: false,
      signalsFound: [],
      matches: []
    }
  }

  const signalsFound = [...new Set(matches.map((match) => match.signal))]
  const dominant = DOMINANCE.find((signal) => signalsFound.includes(signal)) ?? 'unstated'
  const dominantMatches = matches.filter((match) => match.signal === dominant).sort((a, b) => a.index - b.index)
  const primary = dominantMatches[0]!

  const restrictive = signalsFound.some((signal) =>
    ['sponsorship_not_offered', 'existing_right_to_work_required', 'citizenship_or_clearance_required'].includes(signal)
  )
  const conflicting = restrictive && signalsFound.includes('sponsorship_offered')

  const statements: WorkAuthStatement[] = matches.map((match) => ({
    quote: match.quote,
    offset: match.offset,
    ruleId: match.ruleId
  }))

  const evidence: SponsorEvidence = {
    signal: dominant,
    quote: primary.quote,
    offset: primary.offset,
    ruleId: primary.ruleId,
    source: 'deterministic'
  }

  return { signal: dominant, evidence, statements, conflicting, signalsFound, matches }
}

export function hasClearanceRequirement(statements: WorkAuthStatement[]): boolean {
  return statements.some((statement) => statement.ruleId?.startsWith('clearance.') ?? false)
}

export function hasCitizenshipOnlyRequirement(statements: WorkAuthStatement[]): boolean {
  return statements.some((statement) => statement.ruleId?.startsWith('citizenship.') ?? false)
}
