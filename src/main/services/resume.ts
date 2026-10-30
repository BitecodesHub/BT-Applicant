import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { Db } from '../db/database'
import { getResume, getProfile, saveProfile, type ProfileRecord } from '../db/repos/profile'
import {
  getResumeExtraction,
  saveResumeExtraction,
  type ResumeExtractionRecord
} from '../db/repos/resume-extractions'
import { ResumeTextError, extractResumeText } from '../resume/text'
import { RESUME_PARSER_VERSION, parseResumeText } from '../resume/parse'

export class ResumeAnalysisError extends Error {}

export async function analyzeStoredResume(db: Db, resumeId: number): Promise<ResumeExtractionRecord> {
  const resume = getResume(db, resumeId)
  if (!resume) throw new ResumeAnalysisError('Resume not found')
  const extension = extname(resume.fileName).toLowerCase()
  let buffer: Uint8Array
  try {
    buffer = new Uint8Array(await readFile(resume.storedPath))
  } catch {
    throw new ResumeAnalysisError('The stored resume file is missing. Upload it again.')
  }
  if (buffer.byteLength > 10 * 1024 * 1024) throw new ResumeAnalysisError('Resume files must be smaller than 10 MB')

  let text: string
  let textWarnings: string[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new ResumeTextError('Text extraction took too long. The file may be malformed.')), 25_000)
      timer.unref?.()
    })
    const extracted = await Promise.race([extractResumeText(buffer, extension), timeout])
    text = extracted.text
    textWarnings = extracted.warnings
  } catch (error) {
    if (error instanceof ResumeTextError) throw new ResumeAnalysisError(error.message)
    throw new ResumeAnalysisError(error instanceof Error ? error.message : String(error))
  } finally {
    if (timer) clearTimeout(timer)
  }

  const parsed = parseResumeText(text)
  return saveResumeExtraction(db, {
    resumeId,
    parserVersion: RESUME_PARSER_VERSION,
    text,
    textChars: text.length,
    data: parsed.data,
    confidence: parsed.confidence,
    warnings: [...textWarnings, ...parsed.warnings],
    sectionsFound: parsed.sectionsFound
  })
}

export interface ResumeImportResult {
  profile: ProfileRecord
  imported: string[]
  keptExisting: string[]
}

export function importResumeIntoProfile(db: Db, resumeId: number): ResumeImportResult {
  const extraction = getResumeExtraction(db, resumeId)
  if (!extraction) throw new ResumeAnalysisError('Read this resume before importing its details.')
  const data = extraction.data
  const profile = getProfile(db)
  const imported: string[] = []
  const keptExisting: string[] = []

  const next = { ...profile }
  const fill = (field: keyof ProfileRecord, label: string, value: string | null | undefined) => {
    if (!value) return
    const current = next[field]
    if (typeof current === 'string' && current.trim().length > 0) {
      keptExisting.push(label)
      return
    }
    ;(next as unknown as Record<string, unknown>)[field] = value
    imported.push(label)
  }

  fill('fullName', 'Full name', data.name)
  fill('email', 'Email', data.email)
  fill('phone', 'Phone', data.phone)
  fill('city', 'City', cityFromLocation(data.location))
  fill('linkedin', 'LinkedIn', data.linkedin)
  fill('github', 'GitHub', data.github)
  fill('website', 'Website', data.website)
  fill('summary', 'Summary', data.summary)

  if (data.yearsExperience !== null) {
    if (profile.yearsExperience === null) {
      next.yearsExperience = Math.round(data.yearsExperience * 10) / 10
      imported.push('Years of experience')
    } else {
      keptExisting.push('Years of experience')
    }
  }

  const skills = [...profile.skills]
  const skillKeys = new Set(skills.map((skill) => skill.toLowerCase()))
  let addedSkills = 0
  for (const skill of data.skills) {
    const key = skill.toLowerCase()
    if (skillKeys.has(key)) continue
    skillKeys.add(key)
    skills.push(skill)
    addedSkills += 1
  }
  if (addedSkills > 0) {
    next.skills = skills
    imported.push(addedSkills === 1 ? '1 skill' : `${addedSkills} skills`)
  }

  const languages = [...profile.languages]
  const languageKeys = new Set(languages.map((item) => item.language.toLowerCase()))
  let addedLanguages = 0
  for (const language of data.languages) {
    const key = language.language.toLowerCase()
    if (languageKeys.has(key)) continue
    languageKeys.add(key)
    languages.push(language)
    addedLanguages += 1
  }
  if (addedLanguages > 0) {
    next.languages = languages
    imported.push(addedLanguages === 1 ? '1 language' : `${addedLanguages} languages`)
  }

  return {
    profile: saveProfile(db, next),
    imported,
    keptExisting
  }
}

function cityFromLocation(location: string | null): string | null {
  if (!location) return null
  const first = location.split(',')[0]?.trim()
  if (!first || /^remote$/i.test(first)) return null
  return first
}
