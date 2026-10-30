import { unzipSync } from 'fflate'

export interface TextExtraction {
  text: string
  format: 'pdf' | 'docx' | 'doc' | 'txt' | 'md' | 'rtf'
  warnings: string[]
}

const MAX_TEXT_CHARS = 300_000

export class ResumeTextError extends Error {}

export async function extractResumeText(
  buffer: Uint8Array,
  extension: string
): Promise<TextExtraction> {
  const ext = extension.toLowerCase().replace(/^\./, '')
  let text = ''
  const warnings: string[] = []

  if (ext === 'pdf') {
    text = await extractPdf(buffer)
  } else if (ext === 'docx') {
    text = extractDocx(buffer)
  } else if (ext === 'doc') {
    throw new ResumeTextError('Legacy .doc files cannot be read locally. Save the file as PDF or DOCX and upload it again.')
  } else if (ext === 'rtf') {
    text = rtfToText(decodeText(buffer))
  } else if (ext === 'txt' || ext === 'md') {
    text = decodeText(buffer)
    if (ext === 'md') text = markdownToText(text)
  } else {
    throw new ResumeTextError('This file type cannot be read. Use PDF, DOCX, TXT, Markdown, or RTF.')
  }

  text = normalizeExtractedText(text)
  if (text.length > MAX_TEXT_CHARS) {
    warnings.push(`Only the first ${MAX_TEXT_CHARS.toLocaleString()} characters were read from this file.`)
    text = text.slice(0, MAX_TEXT_CHARS)
  }
  if (!text.trim()) {
    throw new ResumeTextError(
      ext === 'pdf'
        ? 'No text layer was found. This PDF is probably a scan or an image; upload a text-based PDF or a DOCX file.'
        : 'No readable text was found in this file.'
    )
  }
  return { text, format: ext as TextExtraction['format'], warnings }
}

function decodeText(buffer: Uint8Array): string {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
  return text.replace(/^\uFEFF/, '')
}

async function extractPdf(buffer: Uint8Array): Promise<string> {
  const { extractText } = await import('unpdf')
  try {
    // Passing bytes rather than a document proxy lets unpdf release pages and
    // the worker after extraction; pdf.js no longer exposes destroy() on the
    // document proxy itself.
    const result = await extractText(new Uint8Array(buffer), { mergePages: true })
    return result.text
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/password|encrypt/i.test(message)) {
      throw new ResumeTextError('This PDF is password-protected. Remove the password and upload it again.')
    }
    throw new ResumeTextError(`The PDF could not be read: ${message}`)
  }
}

function extractDocx(buffer: Uint8Array): string {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(buffer)
  } catch {
    throw new ResumeTextError('This DOCX file is damaged or is not a real Word document.')
  }
  const document = files['word/document.xml']
  if (!document) throw new ResumeTextError('The Word document has no readable body.')

  const xml = decodeText(document)
  const paragraphs: string[] = []
  const blocks = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? []
  for (const block of blocks) {
    const withBreaks = block
      .replace(/<w:tab\b[^>]*\/>/g, '\t')
      .replace(/<w:br\b[^>]*\/>/g, '\n')
      .replace(/<\/w:tc>/g, ' | ')
    const text = decodeXml(withBreaks.replace(/<[^>]+>/g, ''))
    if (text.trim()) paragraphs.push(text.replace(/\s*\|\s*$/, '').trim())
  }
  if (paragraphs.length === 0) {
    const fallback = decodeXml(xml.replace(/<[^>]+>/g, ' '))
    if (fallback.trim()) return fallback
  }
  return paragraphs.join('\n')
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

const RTF_DESTINATIONS = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'pict',
  'object',
  'header',
  'footer',
  'headerl',
  'headerr',
  'footerl',
  'footerr',
  'xmlnstbl',
  'generator',
  'themedata',
  'datastore',
  'latentstyles',
  'rsidtbl',
  'listtable',
  'listoverridetable',
  'filetbl',
  'revtbl'
])

function rtfToText(input: string): string {
  let out = ''
  const skipStack: boolean[] = []
  let i = 0

  while (i < input.length) {
    const char = input[i]!
    if (char === '{') {
      const next = input.slice(i + 1, i + 80)
      const destination = /^\\(?:\*|([a-z]+))/i.exec(next)?.[1]?.toLowerCase()
      skipStack.push(Boolean(skipStack.at(-1)) || next.startsWith('\\*') || Boolean(destination && RTF_DESTINATIONS.has(destination)))
      i += 1
      continue
    }
    if (char === '}') {
      skipStack.pop()
      i += 1
      continue
    }
    if (char === '\\') {
      const next = input[i + 1]
      if (next === "'") {
        const hex = input.slice(i + 2, i + 4)
        if (!skipStack.at(-1) && /^[0-9a-f]{2}$/i.test(hex)) out += String.fromCharCode(Number.parseInt(hex, 16))
        i += 4
        continue
      }
      if (next === '\\' || next === '{' || next === '}') {
        if (!skipStack.at(-1)) out += next
        i += 2
        continue
      }
      if (next === '*') {
        if (skipStack.length > 0) skipStack[skipStack.length - 1] = true
        i += 2
        continue
      }
      if (next === 'u') {
        const match = /^\\u(-?\d+)\s?/.exec(input.slice(i))
        if (match) {
          const code = Number(match[1])
          if (!skipStack.at(-1)) out += String.fromCharCode(code < 0 ? code + 65536 : code)
          i += match[0].length
          continue
        }
      }
      const wordMatch = /^\\([a-z]+)(-?\d+)?\s?/i.exec(input.slice(i))
      if (wordMatch) {
        const word = wordMatch[1]!.toLowerCase()
        if (!skipStack.at(-1)) {
          if (word === 'par' || word === 'line' || word === 'sect' || word === 'row') out += '\n'
          else if (word === 'tab' || word === 'cell') out += '\t'
          else if (word === 'emdash') out += '—'
          else if (word === 'endash') out += '–'
          else if (word === 'bullet') out += '• '
        }
        if (RTF_DESTINATIONS.has(word) && skipStack.length > 0) skipStack[skipStack.length - 1] = true
        i += wordMatch[0].length
        continue
      }
      i += 1
      continue
    }
    if (char !== '\r' && char !== '\n' && !skipStack.at(-1)) out += char
    i += 1
  }

  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function markdownToText(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '• ')
    .replace(/[*_`~]/g, '')
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
