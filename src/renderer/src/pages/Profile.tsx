import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Plus, Save, Trash2, UserRound } from 'lucide-react'
import type { CompletenessDTO, ProfileDTO } from '@shared/api'
import { call, queryKeys } from '../lib/api'
import { country, countryWithCode, initials, isEmail, timeAgo } from '../lib/format'
import { useDraft, useNow } from '../lib/hooks'
import {
  Badge,
  Button,
  ChipEditor,
  CountryChips,
  CountrySelect,
  Field,
  Input,
  Meter,
  Notice,
  PageError,
  PageHeader,
  PageLoading,
  Panel,
  Select,
  Textarea,
  useToast
} from '../components/ui'

const LEVELS = ['Native', 'Fluent', 'Professional', 'Conversational', 'Basic']
const SKILL_SUGGESTIONS = [
  'Kubernetes',
  'Docker',
  'Terraform',
  'AWS',
  'Azure',
  'Google Cloud',
  'Linux',
  'Python',
  'Go',
  'TypeScript',
  'CI/CD',
  'GitHub Actions',
  'Observability',
  'Prometheus',
  'Grafana',
  'PostgreSQL',
  'Incident response',
  'Platform engineering'
]

type ProfileDraft = Omit<ProfileDTO, 'id' | 'updatedAt'>

function toDraft(profile: ProfileDTO): ProfileDraft {
  return {
    fullName: profile.fullName,
    email: profile.email,
    phone: profile.phone,
    city: profile.city,
    countryCode: profile.countryCode,
    citizenships: profile.citizenships,
    residenceCountry: profile.residenceCountry,
    linkedin: profile.linkedin,
    website: profile.website,
    github: profile.github,
    summary: profile.summary,
    yearsExperience: profile.yearsExperience,
    skills: profile.skills,
    languages: profile.languages,
    salaryExpectation: profile.salaryExpectation,
    noticePeriod: profile.noticePeriod,
    earliestStart: profile.earliestStart
  }
}

export default function Profile() {
  const query = useQuery({ queryKey: ['profile'], queryFn: () => call('profile.get') })
  if (query.isLoading) return <PageLoading label="Loading profile" />
  if (query.error) return <PageError error={query.error} onRetry={() => query.refetch()} />
  if (!query.data) return null
  return <ProfileEditor profile={query.data.profile} completeness={query.data.completeness} />
}

function ProfileEditor({ profile, completeness }: { profile: ProfileDTO; completeness: CompletenessDTO }) {
  const draft = useDraft<ProfileDraft>(toDraft(profile))
  const [language, setLanguage] = useState({ language: '', level: 'Professional' })
  const queryClient = useQueryClient()
  const toast = useToast()
  const now = useNow(60_000)

  const save = useMutation({
    mutationFn: () =>
      call('profile.save', {
        ...draft.draft,
        fullName: draft.draft.fullName.trim(),
        email: draft.draft.email.trim(),
        phone: draft.draft.phone?.trim() || null,
        city: draft.draft.city?.trim() || null,
        countryCode: draft.draft.countryCode || null,
        residenceCountry: draft.draft.residenceCountry || null,
        linkedin: draft.draft.linkedin?.trim() || null,
        website: draft.draft.website?.trim() || null,
        github: draft.draft.github?.trim() || null,
        summary: draft.draft.summary?.trim() || null,
        noticePeriod: draft.draft.noticePeriod?.trim() || null,
        earliestStart: draft.draft.earliestStart?.trim() || null,
        salaryExpectation: draft.draft.salaryExpectation && draft.draft.salaryExpectation.min > 0 ? draft.draft.salaryExpectation : null
      }),
    onSuccess: (result) => {
      draft.reset(toDraft(result.profile))
      queryClient.invalidateQueries({ queryKey: ['profile'] })
      queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap })
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success('Profile saved. Existing jobs are re-evaluated against the new details.')
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const set = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) => {
    draft.setDraft((current) => ({ ...current, [key]: value }))
  }

  const addLanguage = () => {
    if (!language.language.trim()) return
    const next = [...draft.draft.languages, { language: language.language.trim(), level: language.level }]
    set('languages', next)
    setLanguage({ language: '', level: 'Professional' })
  }

  const removeLanguage = (index: number) => {
    set('languages', draft.draft.languages.filter((_item, itemIndex) => itemIndex !== index))
  }

  const valid = draft.draft.fullName.trim().length >= 2 && isEmail(draft.draft.email)
  const salary = draft.draft.salaryExpectation

  return (
    <>
      <PageHeader
        eyebrow="Configure"
        title="Applicant profile"
        desc="Only these verified details are used to evaluate jobs and render applications. Nothing is invented or inferred."
        actions={
          <>
            <span className={`small ${draft.dirty ? 'color-yellow' : 'muted'}`}>{draft.dirty ? 'Unsaved changes' : 'All changes saved'}</span>
            <Button variant="ghost" onClick={() => draft.reset()} disabled={!draft.dirty}>
              Reset
            </Button>
            <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!valid || !draft.dirty}>
              <Save /> Save profile
            </Button>
          </>
        }
      />

      <div className="split-2">
        <div className="stack-lg">
          <Panel title="Identity" sub="Used in application emails and eligibility checks.">
            <div className="field-row">
              <Field label="Full name" required>
                <Input value={draft.draft.fullName} onChange={(event) => set('fullName', event.target.value)} placeholder="Your legal name" maxLength={200} />
              </Field>
              <Field label="Email address" required hint="Applications are only sent from your configured SMTP identity; this is the reply address.">
                <Input type="email" value={draft.draft.email} onChange={(event) => set('email', event.target.value)} placeholder="you@example.com" maxLength={320} />
              </Field>
            </div>
            <div className="field-row mt-3">
              <Field label="Phone">
                <Input value={draft.draft.phone ?? ''} onChange={(event) => set('phone', event.target.value)} placeholder="+1 555 0100" maxLength={80} />
              </Field>
              <Field label="City">
                <Input value={draft.draft.city ?? ''} onChange={(event) => set('city', event.target.value)} placeholder="Berlin" maxLength={120} />
              </Field>
            </div>
            <div className="field-row mt-3">
              <Field label="Country of location" hint="Where you are currently based. Separate from citizenship.">
                <CountrySelect value={draft.draft.countryCode} onChange={(value) => set('countryCode', value || null)} placeholder="Select a country" />
              </Field>
              <Field label="Country of residence for work authorization" hint="The country whose work rules apply to you now.">
                <CountrySelect value={draft.draft.residenceCountry} onChange={(value) => set('residenceCountry', value || null)} placeholder="Same as location" />
              </Field>
            </div>
            <div className="field mt-3">
              <span className="label">Citizenships <span className="req">*</span></span>
              <CountryChips values={draft.draft.citizenships} onChange={(values) => set('citizenships', values)} addLabel="Add citizenship" />
              <span className="hint">
                Every citizenship you hold. Dual citizens receive the best route from either passport; nothing is assumed without a record.
              </span>
            </div>
            <div className="field-row mt-3">
              <Field label="Years of experience">
                <Input
                  type="number"
                  min={0}
                  max={80}
                  value={draft.draft.yearsExperience ?? ''}
                  onChange={(event) => set('yearsExperience', event.target.value === '' ? null : Number(event.target.value))}
                  placeholder="e.g. 8"
                />
              </Field>
              <div>
                <span className="label">Profile photo</span>
                <div className="row mt-2" style={{ gap: 10 }}>
                  <div className="company-avatar" style={{ borderRadius: '50%' }}>{initials(draft.draft.fullName)}</div>
                  <span className="tiny faint">Initials are shown locally. Photos are not used in applications.</span>
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="Links" sub="Included in templates through {{linkedin}}, {{website}}, and {{github}}.">
            <div className="field-row">
              <Field label="LinkedIn">
                <Input value={draft.draft.linkedin ?? ''} onChange={(event) => set('linkedin', event.target.value)} placeholder="linkedin.com/in/you" maxLength={500} />
              </Field>
              <Field label="Website">
                <Input value={draft.draft.website ?? ''} onChange={(event) => set('website', event.target.value)} placeholder="yourname.dev" maxLength={500} />
              </Field>
            </div>
            <Field label="GitHub" className="mt-3">
              <Input value={draft.draft.github ?? ''} onChange={(event) => set('github', event.target.value)} placeholder="github.com/you" maxLength={500} />
            </Field>
          </Panel>

          <Panel title="Professional summary & skills" sub="Skills drive the deterministic score and the fit paragraph.">
            <Field label="Summary" hint="Two to four sentences. Keep it factual; this text is not rewritten without your edits.">
              <Textarea
                value={draft.draft.summary ?? ''}
                onChange={(event) => set('summary', event.target.value)}
                placeholder="Platform engineer focused on reliable cloud infrastructure, Kubernetes, and developer experience."
                maxLength={4000}
                style={{ minHeight: 120 }}
              />
            </Field>
            <div className="field mt-3">
              <span className="label">Skills</span>
              <ChipEditor values={draft.draft.skills} onChange={(values) => set('skills', values)} suggestions={SKILL_SUGGESTIONS} placeholder="Add a skill and press Enter" />
              <span className="hint">Use the same spellings as job postings where possible (for example Kubernetes, not k8s).</span>
            </div>
          </Panel>

          <Panel title="Languages">
            <div className="stack">
              {draft.draft.languages.length === 0 ? <div className="small muted">No languages recorded yet.</div> : null}
              {draft.draft.languages.map((item, index) => (
                <div className="row" key={`${item.language}-${index}`} style={{ gap: 10 }}>
                  <Input value={item.language} readOnly aria-label={`Language ${index + 1}`} />
                  <Input value={item.level} readOnly aria-label={`Level ${index + 1}`} style={{ maxWidth: 150 }} />
                  <Button variant="ghost" iconOnly onClick={() => removeLanguage(index)} aria-label={`Remove ${item.language}`}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
            <div className="field-row mt-3">
              <Field label="Language">
                <Input value={language.language} onChange={(event) => setLanguage((current) => ({ ...current, language: event.target.value }))} placeholder="German" />
              </Field>
              <Field label="Level">
                <Select value={language.level} onChange={(event) => setLanguage((current) => ({ ...current, level: event.target.value }))}>
                  {LEVELS.map((level) => (
                    <option key={level} value={level}>{level}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button variant="secondary" size="sm" className="mt-3" onClick={addLanguage} disabled={!language.language.trim()}>
              <Plus /> Add language
            </Button>
          </Panel>

          <Panel title="Compensation & availability" sub="Used by salary fit scoring and templates.">
            <div className="row mb-3">
              <label className="check-row" style={{ padding: 0 }}>
                <input
                  type="checkbox"
                  checked={Boolean(salary)}
                  onChange={(event) =>
                    set('salaryExpectation', event.target.checked ? { min: 0, max: 0, currency: 'USD', period: 'year' } : null)
                  }
                />
                <span className="small strong">Record a salary expectation</span>
              </label>
            </div>
            {salary ? (
              <div className="field-row" style={{ gridTemplateColumns: '1fr 1fr 90px 120px' }}>
                <Field label="Minimum" required>
                  <Input
                    type="number"
                    min={0}
                    value={salary.min || ''}
                    onChange={(event) => set('salaryExpectation', { ...salary, min: Number(event.target.value) || 0 })}
                  />
                </Field>
                <Field label="Maximum">
                  <Input
                    type="number"
                    min={0}
                    value={salary.max && salary.max > 0 ? salary.max : ''}
                    onChange={(event) => set('salaryExpectation', { ...salary, max: event.target.value ? Number(event.target.value) : undefined })}
                  />
                </Field>
                <Field label="Currency">
                  <Input value={salary.currency} onChange={(event) => set('salaryExpectation', { ...salary, currency: event.target.value.toUpperCase().slice(0, 3) })} maxLength={3} />
                </Field>
                <Field label="Period">
                  <Select value={salary.period} onChange={(event) => set('salaryExpectation', { ...salary, period: event.target.value as typeof salary.period })}>
                    <option value="year">Per year</option>
                    <option value="month">Per month</option>
                    <option value="hour">Per hour</option>
                  </Select>
                </Field>
              </div>
            ) : (
              <div className="small muted">No expectation recorded; salary fit stays neutral.</div>
            )}
            <div className="field-row mt-3">
              <Field label="Notice period">
                <Input value={draft.draft.noticePeriod ?? ''} onChange={(event) => set('noticePeriod', event.target.value)} placeholder="4 weeks" maxLength={120} />
              </Field>
              <Field label="Earliest start">
                <Input value={draft.draft.earliestStart ?? ''} onChange={(event) => set('earliestStart', event.target.value)} placeholder="Immediately" maxLength={120} />
              </Field>
            </div>
          </Panel>
        </div>

        <div className="stack-lg">
          <Panel title="Readiness" sub="A complete profile is required before automatic applications.">
            <div className="row-between mb-2">
              <span className="small strong">{completeness.score}% complete</span>
              <Badge tone={completeness.readyToApply ? 'success' : 'warn'}>{completeness.readyToApply ? 'Ready to apply' : 'Not ready yet'}</Badge>
            </div>
            <Meter value={completeness.score} max={100} tone={completeness.readyToApply ? 'green' : 'accent'} />
            {completeness.missing.length > 0 ? (
              <div className="mt-3">
                <div className="small strong mb-2">Missing</div>
                <div className="stack">
                  {completeness.missing.map((item) => (
                    <div className="small color-yellow" key={item}>· {item}</div>
                  ))}
                </div>
              </div>
            ) : null}
            {completeness.warnings.length > 0 ? (
              <div className="mt-3">
                <div className="small strong mb-2">Warnings</div>
                <div className="stack">
                  {completeness.warnings.map((item) => (
                    <div className="small muted" key={item}>· {item}</div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="divider" />
            <div className="row wrap" style={{ gap: 8 }}>
              <Link to="/authorization"><Button variant="secondary" size="sm">Work authorization</Button></Link>
              <Link to="/resumes"><Button variant="secondary" size="sm">Resumes</Button></Link>
            </div>
          </Panel>

          <Panel title="Profile preview">
            <div className="row" style={{ gap: 12 }}>
              <div className="company-avatar" style={{ borderRadius: '50%', width: 44, height: 44 }}>
                {initials(draft.draft.fullName)}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="strong">{draft.draft.fullName || 'Your name'}</div>
                <div className="tiny muted truncate">{draft.draft.email || 'email@example.com'}</div>
                <div className="tiny faint">
                  {draft.draft.city ? `${draft.draft.city}, ` : ''}
                  {draft.draft.countryCode ? country(draft.draft.countryCode) : 'Location not set'}
                </div>
              </div>
            </div>
            <div className="divider" />
            <div className="stack small">
              <div className="row-between">
                <span className="muted">Citizenship</span>
                <span>{draft.draft.citizenships.length > 0 ? draft.draft.citizenships.map((code) => country(code)).join(', ') : 'Not recorded'}</span>
              </div>
              <div className="row-between">
                <span className="muted">Residence</span>
                <span>{draft.draft.residenceCountry ? countryWithCode(draft.draft.residenceCountry) : 'Not recorded'}</span>
              </div>
              <div className="row-between">
                <span className="muted">Experience</span>
                <span>{draft.draft.yearsExperience !== null ? `${draft.draft.yearsExperience} years` : 'Not recorded'}</span>
              </div>
              <div className="row-between">
                <span className="muted">Skills</span>
                <span>{draft.draft.skills.length}</span>
              </div>
              <div className="row-between">
                <span className="muted">Languages</span>
                <span>{draft.draft.languages.length}</span>
              </div>
            </div>
            <div className="mt-3">
              {draft.draft.skills.length > 0 ? (
                <div className="chip-list">
                  {draft.draft.skills.slice(0, 10).map((skill) => (
                    <span className="chip" key={skill}>{skill}</span>
                  ))}
                  {draft.draft.skills.length > 10 ? <span className="chip">+{draft.draft.skills.length - 10}</span> : null}
                </div>
              ) : (
                <div className="small muted">No skills recorded.</div>
              )}
            </div>
          </Panel>

          <Panel title="Why these details matter">
            <div className="stack small muted" style={{ lineHeight: 1.65 }}>
              <div className="inline"><CheckCircle2 size={13} className="color-green" /> Citizenships and residence set the eligibility route.</div>
              <div className="inline"><CheckCircle2 size={13} className="color-green" /> Skills and years of experience set the deterministic score.</div>
              <div className="inline"><CheckCircle2 size={13} className="color-green" /> Contact details only enter text you have approved.</div>
              <div className="inline"><AlertTriangle size={13} className="color-yellow" /> Missing fields reduce completeness and block auto-drafting.</div>
            </div>
          </Panel>

          <Panel title="Local record">
            <div className="tiny faint">
              Last updated {timeAgo(profile.updatedAt, now)}. Stored only in this app’s local SQLite database; no profile data leaves the machine except
              inside an application you deliberately send.
            </div>
            <div className="row mt-3">
              <UserRound size={14} className="faint" />
              <span className="tiny faint">Profile ID {profile.id}</span>
            </div>
          </Panel>
        </div>
      </div>
    </>
  )
}
