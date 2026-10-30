import type { Db } from './database'
import { getSource, upsertSource, type SourceInput } from './repos/sources'
import { listTemplates, createTemplate } from './repos/templates'
import { logEvent } from './repos/events'
import { getProfile } from './repos/profile'

interface SeedSource extends SourceInput {}

/**
 * Sources verified live on 2026-10-28 (docs/SOURCE-VERIFICATION.md). Employers
 * can be added or removed from each source without code changes.
 */
export const DEFAULT_SOURCES: SeedSource[] = [
  {
    id: 'greenhouse-tech',
    connector: 'greenhouse',
    label: 'Greenhouse — tech employers',
    config: {
      boards: [
        { token: 'stripe', label: 'Stripe' },
        { token: 'figma', label: 'Figma' },
        { token: 'discord', label: 'Discord' },
        { token: 'datadog', label: 'Datadog' },
        { token: 'cloudflare', label: 'Cloudflare' },
        { token: 'gitlab', label: 'GitLab' }
      ]
    },
    enabled: true,
    countries: [],
    rateLimitPerMinute: 30
  },
  {
    id: 'ashby-tech',
    connector: 'ashby',
    label: 'Ashby — tech employers',
    config: {
      boards: [
        { token: 'openai', label: 'OpenAI' },
        { token: 'ramp', label: 'Ramp' },
        { token: 'linear', label: 'Linear' }
      ]
    },
    enabled: true,
    countries: [],
    rateLimitPerMinute: 20
  },
  {
    id: 'lever-tech',
    connector: 'lever',
    label: 'Lever — Gopuff',
    config: { boards: [{ token: 'gopuff', label: 'Gopuff' }] },
    enabled: true,
    countries: [],
    rateLimitPerMinute: 20
  },
  {
    id: 'workable-tech',
    connector: 'workable',
    label: 'Workable — Hugging Face',
    config: { boards: [{ token: 'huggingface', label: 'Hugging Face' }] },
    enabled: true,
    countries: [],
    rateLimitPerMinute: 15
  },
  {
    id: 'smartrecruiters-tech',
    connector: 'smartrecruiters',
    label: 'SmartRecruiters — Ubisoft',
    config: { boards: [{ token: 'Ubisoft2', label: 'Ubisoft' }] },
    enabled: true,
    countries: [],
    rateLimitPerMinute: 20
  },
  {
    id: 'remotive',
    connector: 'remotive',
    label: 'Remotive (remote)',
    config: {},
    enabled: true,
    countries: [],
    rateLimitPerMinute: 12
  },
  {
    id: 'arbeitnow',
    connector: 'arbeitnow',
    label: 'Arbeitnow (Europe)',
    config: {},
    enabled: true,
    countries: [],
    rateLimitPerMinute: 20
  },
  {
    id: 'jobicy',
    connector: 'jobicy',
    label: 'Jobicy (remote)',
    config: {},
    enabled: true,
    countries: [],
    rateLimitPerMinute: 12
  },
  {
    id: 'himalayas',
    connector: 'himalayas',
    label: 'Himalayas (remote)',
    config: {},
    enabled: true,
    countries: [],
    rateLimitPerMinute: 20
  },
  {
    id: 'remoteok',
    connector: 'remoteok',
    label: 'Remote OK',
    config: {},
    enabled: true,
    countries: [],
    rateLimitPerMinute: 12
  },
  {
    id: 'themuse',
    connector: 'themuse',
    label: 'The Muse',
    config: {},
    enabled: true,
    countries: [],
    rateLimitPerMinute: 20
  },
  {
    id: 'adzuna',
    connector: 'adzuna',
    label: 'Adzuna (country search)',
    config: {},
    enabled: false,
    countries: [],
    rateLimitPerMinute: 20
  },
  {
    id: 'usajobs',
    connector: 'usajobs',
    label: 'USAJOBS (US federal)',
    config: {},
    enabled: false,
    countries: ['US'],
    rateLimitPerMinute: 20
  },
  {
    id: 'jsonld-careers',
    connector: 'jsonld',
    label: 'Career pages (JSON-LD)',
    config: { urls: [] },
    enabled: false,
    countries: [],
    rateLimitPerMinute: 15
  }
]

const APPLICATION_EMAIL_SUBJECT = 'Application for {{job_title}} — {{candidate_name}}'

const APPLICATION_EMAIL_BODY = `Dear {{company}} hiring team,

I am writing to apply for the {{job_title}} position{{job_location_suffix}}.

{{fit_paragraph}}

{{summary}}

Relevant background:
{{skills_list}}

My resume is attached for your review. I would welcome the opportunity to discuss how my experience can help your team.

Kind regards,
{{candidate_name}}
{{candidate_contact}}`

const COVER_LETTER_BODY = `Dear {{company}} hiring team,

I am applying for the {{job_title}} role{{job_location_suffix}}. {{fit_paragraph}}

{{summary}}

Highlights relevant to this role:
{{skills_list}}

I have attached my resume and would be glad to provide any further detail.

Sincerely,
{{candidate_name}}
{{candidate_contact}}`

export function seedDefaults(db: Db): void {
  for (const source of DEFAULT_SOURCES) {
    if (!getSource(db, source.id)) upsertSource(db, source)
  }

  if (listTemplates(db, 'application_email').length === 0) {
    createTemplate(db, {
      name: 'Standard application email',
      kind: 'application_email',
      subject: APPLICATION_EMAIL_SUBJECT,
      body: APPLICATION_EMAIL_BODY,
      isDefault: true
    })
  }

  if (listTemplates(db, 'cover_letter').length === 0) {
    createTemplate(db, {
      name: 'Standard cover letter',
      kind: 'cover_letter',
      subject: 'Cover letter — {{job_title}}',
      body: COVER_LETTER_BODY,
      isDefault: true
    })
  }

  const profile = getProfile(db)
  logEvent(db, {
    category: 'system.started',
    message: 'Database ready',
    detail: { seededSources: DEFAULT_SOURCES.length, profileName: profile.fullName || null },
    actor: 'system'
  })
}
