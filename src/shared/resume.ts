export interface ResumeExperience {
  title: string
  company: string | null
  location: string | null
  startDate: string | null
  endDate: string | null
  current: boolean
  bullets: string[]
  technologies: string[]
}

export interface ResumeEducation {
  degree: string | null
  institution: string | null
  startDate: string | null
  endDate: string | null
  details: string[]
}

export interface ResumeCertification {
  name: string
  issuer: string | null
  year: number | null
}

export interface ResumeLanguage {
  language: string
  level: string
}

export interface ResumeProject {
  name: string
  detail: string | null
  technologies: string[]
}

export interface ResumeExtractedData {
  name: string | null
  headline: string | null
  email: string | null
  phone: string | null
  location: string | null
  linkedin: string | null
  github: string | null
  website: string | null
  summary: string | null
  skills: string[]
  yearsExperience: number | null
  experience: ResumeExperience[]
  education: ResumeEducation[]
  certifications: ResumeCertification[]
  languages: ResumeLanguage[]
  projects: ResumeProject[]
  awards: string[]
}

export interface ResumeExtractionSummary {
  resumeId: number
  parserVersion: string
  textChars: number
  confidence: number
  warnings: string[]
  sectionsFound: string[]
  extractedAt: number
}
