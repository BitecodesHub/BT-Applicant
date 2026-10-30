export interface EmailExtraction {
  email: string
  evidence: string
  offset: number
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

const APPLICATION_CONTEXT =
  /\b(apply|application|applications|cv|resume|resumé|send|email|e-mail|contact|hiring|recruit|recruiter|recruitment|careers?|jobs?|vacanc(?:y|ies)|interest(?:ed)?)\b/i

const REJECTED_LOCAL_PARTS =
  /^(noreply|no-reply|donotreply|do-not-reply|privacy|dpo|unsubscribe|support|help|abuse|postmaster|webmaster|bounce|notifications?)$/i

const REJECTED_CONTEXT = /\b(do not (contact|email|apply)|no (recruiters|agencies)|privacy policy|unsubscribe)\b/i

function sentenceAround(text: string, index: number): { quote: string; offset: number } {
  let start = 0
  for (const separator of ['.', '!', '?', '\n', ';']) {
    const found = text.lastIndexOf(separator, index - 1)
    if (found > start) start = found + 1
  }
  let end = text.length
  for (const separator of ['.', '!', '?', '\n', ';']) {
    const found = text.indexOf(separator, index)
    if (found !== -1 && found + 1 < end) end = found + 1
  }
  return { quote: text.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, 400), offset: start }
}

/**
 * Returns an application email only when the posting explicitly directs
 * applications to it. A generic address without application context is rejected.
 */
export function extractApplicationEmail(text: string): EmailExtraction | null {
  if (!text) return null
  EMAIL_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = EMAIL_PATTERN.exec(text)) !== null) {
    const email = match[0]
    const localPart = email.split('@')[0] ?? ''
    if (REJECTED_LOCAL_PARTS.test(localPart)) continue
    if (/\.(png|jpe?g|gif|svg|webp)$/i.test(email)) continue

    const { quote, offset } = sentenceAround(text, match.index)
    if (!quote) continue
    if (!APPLICATION_CONTEXT.test(quote)) continue
    if (REJECTED_CONTEXT.test(quote)) continue

    return { email, evidence: quote, offset }
  }
  return null
}

export function parseMailto(url: string | null | undefined): { email: string; subject: string | null } | null {
  if (!url) return null
  const trimmed = url.trim()
  if (!/^mailto:/i.test(trimmed)) return null
  try {
    const withoutScheme = trimmed.slice('mailto:'.length)
    const [address, query] = withoutScheme.split('?')
    const email = decodeURIComponent((address ?? '').split(',')[0] ?? '').trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null
    const params = new URLSearchParams(query ?? '')
    return { email, subject: params.get('subject') }
  } catch {
    return null
  }
}

export function firstEmailInText(text: string): string | null {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  return match ? match[0] : null
}
