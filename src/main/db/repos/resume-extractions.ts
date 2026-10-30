import type { Db } from '../database'
import { parseJson, toJson } from '../../core/json'
import type { ResumeExtractedData } from '../../../shared/resume'

export interface ResumeExtractionRecord {
  resumeId: number
  parserVersion: string
  text: string
  textChars: number
  data: ResumeExtractedData
  confidence: number
  warnings: string[]
  sectionsFound: string[]
  extractedAt: number
}

interface ResumeExtractionRow {
  resume_id: number
  parser_version: string
  text: string
  text_chars: number
  data: string
  confidence: number
  warnings: string
  sections_found: string
  extracted_at: number
}

function mapExtraction(row: ResumeExtractionRow): ResumeExtractionRecord {
  return {
    resumeId: row.resume_id,
    parserVersion: row.parser_version,
    text: row.text,
    textChars: row.text_chars,
    data: { ...emptyData(), ...parseJson<Partial<ResumeExtractedData>>(row.data, {}) },
    confidence: row.confidence,
    warnings: parseJson<string[]>(row.warnings, []),
    sectionsFound: parseJson<string[]>(row.sections_found, []),
    extractedAt: row.extracted_at
  }
}

function emptyData(): ResumeExtractedData {
  return {
    name: null,
    headline: null,
    email: null,
    phone: null,
    location: null,
    linkedin: null,
    github: null,
    website: null,
    summary: null,
    skills: [],
    yearsExperience: null,
    experience: [],
    education: [],
    certifications: [],
    languages: [],
    projects: [],
    awards: []
  }
}

export function listResumeExtractions(db: Db): ResumeExtractionRecord[] {
  return db
    .all<ResumeExtractionRow>('SELECT * FROM resume_extractions ORDER BY extracted_at DESC')
    .map(mapExtraction)
}

export function getResumeExtraction(db: Db, resumeId: number): ResumeExtractionRecord | undefined {
  const row = db.get<ResumeExtractionRow>('SELECT * FROM resume_extractions WHERE resume_id = ?', resumeId)
  return row ? mapExtraction(row) : undefined
}

export function saveResumeExtraction(
  db: Db,
  input: Omit<ResumeExtractionRecord, 'extractedAt'> & { extractedAt?: number }
): ResumeExtractionRecord {
  db.run(
    `INSERT INTO resume_extractions (resume_id, parser_version, text, text_chars, data, confidence, warnings,
       sections_found, extracted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(resume_id) DO UPDATE SET
       parser_version = excluded.parser_version, text = excluded.text, text_chars = excluded.text_chars,
       data = excluded.data, confidence = excluded.confidence, warnings = excluded.warnings,
       sections_found = excluded.sections_found, extracted_at = excluded.extracted_at`,
    input.resumeId,
    input.parserVersion,
    input.text,
    input.textChars,
    toJson(input.data),
    input.confidence,
    toJson(input.warnings),
    toJson(input.sectionsFound),
    input.extractedAt ?? Date.now()
  )
  return getResumeExtraction(db, input.resumeId)!
}

export function deleteResumeExtraction(db: Db, resumeId: number): void {
  db.run('DELETE FROM resume_extractions WHERE resume_id = ?', resumeId)
}
