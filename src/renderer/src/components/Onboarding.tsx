import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Fingerprint,
  FileText,
  Globe2,
  Lock,
  ShieldCheck,
  Stamp,
  Upload
} from 'lucide-react'
import type { BootstrapDTO, ProfileDTO, ResumeDTO } from '@shared/api'
import type { RemoteType, WorkAuthorizationStatus } from '@shared/types'
import { call } from '../lib/api'
import { authStatusMeta, country, fmtDate, formatBytes, isEmail, plural } from '../lib/format'
import {
  Badge,
  Button,
  ChipEditor,
  CountryChips,
  CountrySelect,
  Field,
  Input,
  Notice,
  Panel,
  Segmented,
  Select,
  Switch,
  Textarea,
  cx,
  useToast
} from '../components/ui'

interface AuthRow {
  countryCode: string
  status: WorkAuthorizationStatus
  needsSponsorship: boolean
  permitType: string | null
  validUntil: string | null
  evidenceNote: string | null
  source: 'citizenship' | 'residence' | 'manual'
}

const STEPS = [
  { title: 'Identity', desc: 'Who is applying, and from where.', icon: Fingerprint },
  { title: 'Work authorization', desc: 'What you can accept without sponsorship.', icon: Stamp },
  { title: 'Targets & roles', desc: 'Where to look and what to look for.', icon: Globe2 },
  { title: 'Resume', desc: 'The file attached to eligible applications.', icon: FileText },
  { title: 'Review', desc: 'Confirm the local setup.', icon: CheckCircle2 }
]

const STATUS_OPTIONS: WorkAuthorizationStatus[] = [
  'citizen',
  'permanent_resident',
  'work_permit',
  'student_permit',
  'dependent_permit',
  'none'
]

const TITLE_SUGGESTIONS = ['DevOps Engineer', 'Platform Engineer', 'Site Reliability Engineer', 'Cloud Engineer', 'Infrastructure Engineer', 'Software Engineer']

function initialRows(bootstrap: BootstrapDTO): AuthRow[] {
  const rows: AuthRow[] = bootstrap.authorizations.map((item) => ({
    countryCode: item.countryCode,
    status: item.status,
    needsSponsorship: item.needsSponsorship,
    permitType: item.permitType,
    validUntil: item.validUntil,
    evidenceNote: item.evidenceNote,
    source: 'manual'
  }))
  const codes = new Set(rows.map((row) => row.countryCode))
  for (const code of bootstrap.profile.citizenships) {
    if (!codes.has(code)) {
      rows.unshift({ countryCode: code, status: 'citizen', needsSponsorship: false, permitType: null, validUntil: null, evidenceNote: null, source: 'citizenship' })
      codes.add(code)
    }
  }
  const residence = bootstrap.profile.residenceCountry
  if (residence && !codes.has(residence)) {
    rows.push({ countryCode: residence, status: 'none', needsSponsorship: true, permitType: null, validUntil: null, evidenceNote: null, source: 'residence' })
  }
  return rows
}

export default function Onboarding({ bootstrap, onComplete }: { bootstrap: BootstrapDTO; onComplete: () => void }) {
  const toast = useToast()
  const [step, setStep] = useState(() => Math.min(Math.max(bootstrap.settings.onboarding.step, 0), STEPS.length - 1))
  const [profile, setProfile] = useState<ProfileDTO>(bootstrap.profile)
  const [rows, setRows] = useState<AuthRow[]>(() => initialRows(bootstrap))
  const [selectedCountries, setSelectedCountries] = useState<string[]>(() => {
    const existing = bootstrap.targets.map((target) => target.countryCode)
    if (existing.length > 0) return existing
    return [...new Set([...(bootstrap.profile.citizenships ?? []), bootstrap.profile.residenceCountry].filter((code): code is string => Boolean(code)))].slice(0, 3)
  })
  const [titles, setTitles] = useState<string[]>(() => {
    const existing = [...new Set(bootstrap.targets.flatMap((target) => target.jobTitles))]
    return existing.length > 0 ? existing : []
  })
  const [remotePreference, setRemotePreference] = useState<RemoteType | 'any'>('any')
  const [scheduleCron, setScheduleCron] = useState('0 */4 * * *')
  const [pendingCountry, setPendingCountry] = useState('')
  const [resumes, setResumes] = useState<ResumeDTO[]>(bootstrap.resumes)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const suggestions = useMemo(
    () => [...new Set([...profile.citizenships, profile.residenceCountry, ...selectedCountries].filter((code): code is string => Boolean(code)))],
    [profile.citizenships, profile.residenceCountry, selectedCountries]
  )

  const identityReady = profile.fullName.trim().length > 1 && isEmail(profile.email) && Boolean(profile.residenceCountry) && profile.citizenships.length > 0
  const targetsReady = selectedCountries.length > 0 && titles.length > 0
  const canContinue = step === 0 ? identityReady : step === 2 ? targetsReady : true

  const patchProfile = (patch: Partial<ProfileDTO>) => setProfile((current) => ({ ...current, ...patch }))

  const setCitizenships = (values: string[]) => {
    setProfile((current) => ({ ...current, citizenships: values }))
    setRows((current) => {
      const next = current.filter((row) => row.source !== 'citizenship' || values.includes(row.countryCode))
      const known = new Set(next.map((row) => row.countryCode))
      for (const code of values) {
        if (!known.has(code)) {
          next.unshift({ countryCode: code, status: 'citizen', needsSponsorship: false, permitType: null, validUntil: null, evidenceNote: null, source: 'citizenship' })
        }
      }
      return next
    })
  }

  const setResidence = (code: string) => {
    const residence = code || null
    setProfile((current) => ({ ...current, residenceCountry: residence, countryCode: residence }))
    setRows((current) => {
      const next = current.filter((row) => row.source !== 'residence')
      if (residence && !profile.citizenships.includes(residence) && !next.some((row) => row.countryCode === residence)) {
        next.push({ countryCode: residence, status: 'none', needsSponsorship: true, permitType: null, validUntil: null, evidenceNote: null, source: 'residence' })
      }
      return next
    })
  }

  const updateRow = (code: string, patch: Partial<AuthRow>) => {
    setRows((current) => current.map((row) => (row.countryCode === code ? { ...row, ...patch } : row)))
  }

  const setRowStatus = (row: AuthRow, status: WorkAuthorizationStatus) => {
    const needsSponsorship = status === 'none' || status === 'student_permit' || status === 'dependent_permit'
    updateRow(row.countryCode, { status, needsSponsorship: row.status === status ? row.needsSponsorship : needsSponsorship })
  }

  const addAuthCountry = () => {
    if (!pendingCountry) return
    if (!rows.some((row) => row.countryCode === pendingCountry)) {
      setRows((current) => [
        ...current,
        { countryCode: pendingCountry, status: 'none', needsSponsorship: true, permitType: null, validUntil: null, evidenceNote: null, source: 'manual' }
      ])
    }
    setPendingCountry('')
  }

  const profilePatch = (): Partial<ProfileDTO> => {
    const { id: _id, updatedAt: _updatedAt, ...rest } = profile
    return rest
  }

  const saveStep = async (next: number) => {
    await call('settings.save', { section: 'onboarding', value: { completed: false, step: next } })
  }

  const next = async () => {
    setError(null)
    if (step === 0 && !identityReady) {
      setError('Add your full name, a valid email address, residence country, and at least one citizenship.')
      return
    }
    if (step === 2 && !targetsReady) {
      setError('Choose at least one target country and one job title.')
      return
    }
    setBusy(true)
    try {
      if (step === 0) {
        await call('profile.save', profilePatch())
      }
      if (step === 1) {
        await call(
          'authorizations.replace',
          rows.map((row) => ({
            countryCode: row.countryCode,
            status: row.status,
            permitType: row.permitType,
            validFrom: null,
            validUntil: row.validUntil,
            needsSponsorship: row.needsSponsorship,
            evidenceNote: row.evidenceNote
          }))
        )
      }
      if (step === 2) {
        const existing = new Set((await call('targets.list')).map((target) => target.countryCode))
        for (const code of selectedCountries) {
          if (existing.has(code)) continue
          await call('targets.save', {
            input: {
              countryCode: code,
              enabled: true,
              remotePreference,
              employmentTypes: ['full_time'],
              jobTitles: titles.slice(0, 30),
              keywords: [],
              excludeKeywords: [],
              minSalary: null,
              currency: null,
              seniority: [],
              scheduleCron,
              timezone: bootstrap.system.timeZone,
              sources: []
            }
          })
          existing.add(code)
        }
      }
      const nextStep = step + 1
      if (nextStep < STEPS.length) {
        await saveStep(nextStep)
        setStep(nextStep)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const back = async () => {
    if (step === 0) return
    setError(null)
    const previous = step - 1
    setBusy(true)
    try {
      await saveStep(previous)
      setStep(previous)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const uploadResume = async () => {
    setUploading(true)
    try {
      const uploaded = await call('resumes.upload')
      if (!uploaded) return
      const stored = uploaded.resume
      setResumes((current) => (current.some((resume) => resume.id === stored.id) ? current : [stored, ...current]))
      toast.success(`Resume ${stored.fileName} stored locally${uploaded.extraction ? ' and parsed' : ''}.`)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setUploading(false)
    }
  }

  const finish = async () => {
    setError(null)
    if (!identityReady) {
      setStep(0)
      setError('Complete your identity details before entering the workspace.')
      return
    }
    if (!targetsReady) {
      setStep(2)
      setError('Choose at least one target country and one job title.')
      return
    }
    setBusy(true)
    try {
      await call('settings.save', { section: 'onboarding', value: { completed: true, step: STEPS.length } })
      toast.success('Workspace ready. Discovery will run on your schedule.')
      onComplete()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const defaultResume = resumes.find((resume) => resume.isDefault) ?? resumes[0]
  const citationRows = rows.filter((row) => row.status !== 'none').length

  return (
    <div className="onboarding">
      <aside className="onboarding-art">
        <div className="brand" style={{ padding: 0, margin: 0 }}>
          <div className="brand-mark">BT</div>
          <div>
            <div className="brand-name">BT Applicant</div>
            <div className="brand-sub">Offline application desk</div>
          </div>
        </div>
        <div style={{ marginTop: 54, maxWidth: 380 }}>
          <h2 style={{ fontSize: 27, lineHeight: 1.22, letterSpacing: '-0.03em' }}>A quiet job search that stays on your Mac.</h2>
          <p className="hero-lede mt-3">
            Discovery, eligibility, and drafting run locally. Email delivery is mocked until you unlock it, and web forms are never
            submitted without you.
          </p>
        </div>
        <div className="onboarding-steps">
          {STEPS.map((item, index) => {
            const Icon = item.icon
            return (
              <div key={item.title} className={cx('onboarding-step', index === step && 'active', index < step && 'done')}>
                <div className="onboarding-step-index">{index < step ? <Check size={12} /> : index + 1}</div>
                <div>
                  <div className="onboarding-step-title">
                    <span className="inline" style={{ gap: 6 }}>
                      <Icon size={13} /> {item.title}
                    </span>
                  </div>
                  <div className="onboarding-step-desc">{item.desc}</div>
                </div>
              </div>
            )
          })}
        </div>
        <div className="onboarding-authority">
          <ShieldCheck size={14} />
          <span>No cloud account. No background upload. Data stays in this app’s user folder.</span>
        </div>
      </aside>

      <main className="onboarding-main">
        <div className="onboarding-form">
          <div className="eyebrow">
            Step {step + 1} of {STEPS.length}
          </div>
          <h1 className="page-title">{stepTitle(step)}</h1>
          <p className="page-desc">{stepDesc(step)}</p>

          {error ? (
            <div className="mt-3">
              <Notice tone="danger">{error}</Notice>
            </div>
          ) : null}

          <div className="mt-4">
            {step === 0 ? (
              <>
                <div className="field-row">
                  <Field label="Full name" required>
                    <Input value={profile.fullName} onChange={(event) => patchProfile({ fullName: event.target.value })} placeholder="Exactly as it appears on your resume" autoFocus />
                  </Field>
                  <Field label="Email address" required hint="Used for application emails and as your contact address.">
                    <Input value={profile.email} onChange={(event) => patchProfile({ email: event.target.value })} placeholder="you@example.com" type="email" />
                  </Field>
                </div>
                <div className="field-row">
                  <Field label="Phone">
                    <Input value={profile.phone ?? ''} onChange={(event) => patchProfile({ phone: event.target.value || null })} placeholder="Optional" />
                  </Field>
                  <Field label="City">
                    <Input value={profile.city ?? ''} onChange={(event) => patchProfile({ city: event.target.value || null })} placeholder="Berlin" />
                  </Field>
                </div>
                <Field label="Country of residence" required hint="Residence alone never creates a right to work. Authorization is configured in the next step.">
                  <CountrySelect value={profile.residenceCountry} onChange={setResidence} placeholder="Where do you currently live?" />
                </Field>
                <Field label="Citizenship" required hint="Add every citizenship you hold. These create free-movement and bilateral routes during eligibility.">
                  <CountryChips values={profile.citizenships} onChange={setCitizenships} />
                </Field>
                <div className="field-row">
                  <Field label="LinkedIn">
                    <Input value={profile.linkedin ?? ''} onChange={(event) => patchProfile({ linkedin: event.target.value || null })} placeholder="linkedin.com/in/…" />
                  </Field>
                  <Field label="GitHub or portfolio">
                    <Input value={profile.github ?? ''} onChange={(event) => patchProfile({ github: event.target.value || null })} placeholder="github.com/…" />
                  </Field>
                </div>
                <Field label="Short summary" hint="Optional here; you can refine this and your skills later in Profile.">
                  <Textarea value={profile.summary ?? ''} onChange={(event) => patchProfile({ summary: event.target.value || null })} rows={3} placeholder="One or two sentences about your background." />
                </Field>
              </>
            ) : null}

            {step === 1 ? (
              <>
                <Notice tone="info">
                  Eligibility is decided per country. Unknown or unstated authorization is never treated as eligible, and a residence permit is
                  not the same as a work permit.
                </Notice>
                <div className="panel mt-3">
                  <div className="list">
                    {rows.length === 0 ? (
                      <div className="empty">
                        <div className="empty-desc">Add a citizenship or a manual country to continue.</div>
                      </div>
                    ) : null}
                    {rows.map((row) => {
                      const meta = authStatusMeta[row.status]
                      return (
                        <div className="list-row" key={row.countryCode} style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                          <div className="list-row-main">
                            <div className="cell-title inline" style={{ gap: 8 }}>
                              {country(row.countryCode)}
                              <Badge tone={meta.tone}>{meta.label}</Badge>
                              {row.source !== 'manual' ? <Badge tone="neutral">{row.source === 'citizenship' ? 'Citizenship' : 'Residence'}</Badge> : null}
                            </div>
                            <div className="hint mt-2">
                              {row.status === 'none'
                                ? 'Only postings that explicitly offer sponsorship can pass eligibility here.'
                                : row.status === 'student_permit' || row.status === 'dependent_permit'
                                  ? 'Permits with conditions may still require future sponsorship; record that below.'
                                  : 'No sponsorship is required from this employer for this country.'}
                            </div>
                          </div>
                          <div className="row wrap" style={{ gap: 12 }}>
                            <Select value={row.status} onChange={(event) => setRowStatus(row, event.target.value as WorkAuthorizationStatus)} style={{ width: 190 }}>
                              {STATUS_OPTIONS.map((status) => (
                                <option key={status} value={status}>
                                  {authStatusMeta[status].label}
                                </option>
                              ))}
                            </Select>
                            <div className="row" style={{ gap: 8 }}>
                              <span className="tiny muted">Needs sponsorship</span>
                              <Switch
                                checked={row.needsSponsorship}
                                onCheckedChange={(checked) => updateRow(row.countryCode, { needsSponsorship: checked })}
                                disabled={row.status === 'citizen' || row.status === 'permanent_resident'}
                                label={`Needs sponsorship in ${row.countryCode}`}
                              />
                            </div>
                            {row.source === 'manual' ? (
                              <Button size="sm" variant="ghost" iconOnly aria-label={`Remove ${row.countryCode}`} onClick={() => setRows((current) => current.filter((item) => item.countryCode !== row.countryCode))}>
                                ×
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
                <div className="row mt-3" style={{ gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <CountrySelect value={pendingCountry} onChange={setPendingCountry} exclude={rows.map((row) => row.countryCode)} placeholder="Add another country with a permit" />
                  </div>
                  <Button variant="secondary" onClick={addAuthCountry} disabled={!pendingCountry}>
                    Add
                  </Button>
                </div>
                <p className="hint mt-2">
                  {plural(rows.filter((row) => row.status === 'citizen').length, 'citizenship route')}, {plural(citationRows, 'country record')} with
                  authorization.
                </p>
              </>
            ) : null}

            {step === 2 ? (
              <>
                <Field label="Target countries" required hint="Each target scans compatible sources on a schedule. Targets do not grant authorization.">
                  <CountryChips values={selectedCountries} onChange={setSelectedCountries} />
                </Field>
                {suggestions.length > 0 ? (
                  <div className="chip-list mt-2">
                    {suggestions
                      .filter((code) => !selectedCountries.includes(code))
                      .map((code) => (
                        <button key={code} type="button" className="chip" onClick={() => setSelectedCountries([...selectedCountries, code])}>
                          <Globe2 size={11} /> Add {country(code)}
                        </button>
                      ))}
                  </div>
                ) : null}
                <Field label="Job titles" required hint="Used as search queries. Add specific titles you would actually accept." className="mt-4">
                  <ChipEditor values={titles} onChange={(values) => setTitles(values.slice(0, 30))} suggestions={TITLE_SUGGESTIONS} placeholder="e.g. Platform Engineer" />
                </Field>
                <div className="field-row mt-4">
                  <Field label="Work arrangement">
                    <Segmented
                      value={remotePreference}
                      onChange={setRemotePreference}
                      options={[
                        { value: 'any', label: 'Any' },
                        { value: 'remote', label: 'Remote' },
                        { value: 'hybrid', label: 'Hybrid' },
                        { value: 'onsite', label: 'On-site' }
                      ]}
                    />
                  </Field>
                  <Field label="Scan frequency" hint="Stored as a cron schedule in your local time zone.">
                    <Select value={scheduleCron} onChange={(event) => setScheduleCron(event.target.value)}>
                      <option value="0 */2 * * *">Every 2 hours</option>
                      <option value="0 */4 * * *">Every 4 hours</option>
                      <option value="0 */6 * * *">Every 6 hours</option>
                      <option value="0 8 * * *">Daily at 08:00</option>
                    </Select>
                  </Field>
                </div>
                <Notice tone="accent" className="mt-4">
                  Source connectors are preconfigured and disabled connectors stay inactive. You can tune boards, credentials, and per-target sources
                  later without losing these targets.
                </Notice>
              </>
            ) : null}

            {step === 3 ? (
              <>
                <div className="panel">
                  <div className="panel-body">
                    <div className="row-between">
                      <div>
                        <div className="panel-title">Resume files</div>
                        <div className="panel-sub">Stored in the app’s local resume folder. The original file is copied, never uploaded.</div>
                      </div>
                      <Button variant="primary" onClick={uploadResume} loading={uploading}>
                        <Upload /> Choose file
                      </Button>
                    </div>
                    <div className="divider" />
                    {resumes.length === 0 ? (
                      <div className="empty" style={{ padding: '26px 0' }}>
                        <div className="empty-icon">
                          <FileText />
                        </div>
                        <div className="empty-title">No resume yet</div>
                        <div className="empty-desc">Email applications need an attachment. You can add one later, but applications will pause until a resume exists.</div>
                      </div>
                    ) : (
                      <div className="list">
                        {resumes.map((resume) => (
                          <div className="list-row" key={resume.id}>
                            <div className="empty-icon" style={{ width: 32, height: 32, marginBottom: 0 }}>
                              <FileText size={15} />
                            </div>
                            <div className="list-row-main">
                              <div className="cell-title">
                                {resume.fileName}{' '}
                                {resume.isDefault ? (
                                  <span style={{ marginLeft: 6 }}>
                                    <Badge tone="accent">Default</Badge>
                                  </span>
                                ) : null}
                              </div>
                              <div className="cell-sub">
                                {formatBytes(resume.sizeBytes)} · added {fmtDate(resume.createdAt)} · SHA {resume.sha256.slice(0, 10)}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <p className="fine-print mt-3">
                  PDF, DOC, DOCX, TXT, MD, or RTF up to 10 MB. Duplicate files are detected by SHA-256 and reused.
                </p>
              </>
            ) : null}

            {step === 4 ? (
              <>
                <div className="stack">
                  <ReviewRow
                    title="Identity"
                    ready={identityReady}
                    detail={`${profile.fullName || 'No name'} · ${profile.email || 'no email'} · ${profile.residenceCountry ? country(profile.residenceCountry) : 'no residence'}`}
                  />
                  <ReviewRow
                    title="Work authorization"
                    ready={rows.length > 0}
                    detail={`${rows.length} country record${rows.length === 1 ? '' : 's'}; ${rows.filter((row) => row.status === 'citizen').length} by citizenship`}
                  />
                  <ReviewRow
                    title="Targets"
                    ready={targetsReady}
                    detail={selectedCountries.length > 0 ? selectedCountries.map((code) => country(code)).join(', ') : 'No target country'}
                  />
                  <ReviewRow title="Roles" ready={titles.length > 0} detail={titles.length > 0 ? titles.join(', ') : 'No job titles'} />
                  <ReviewRow
                    title="Resume"
                    ready={resumes.length > 0}
                    detail={defaultResume ? `${defaultResume.fileName}${defaultResume.isDefault ? ' (default)' : ''}` : 'No resume yet — applications will pause'}
                    warnOnly
                  />
                </div>
                <div className="mt-4">
                  <Notice tone="info" icon={Lock}>
                    <strong>Delivery is locked to the local mock outbox.</strong> The kill switch is on, so no email can leave this machine. Web forms
                    open in a separate guided window and require your confirmation. AI is optional; all core steps work without it.
                  </Notice>
                </div>
                <div className="mt-4">
                  <Panel title="What happens after setup" sub="Nothing is submitted automatically in this state.">
                    <div className="kv">
                      <dt>Discovery</dt>
                      <dd>Enabled sources are polled on each target’s schedule; duplicates and expired jobs are handled locally.</dd>
                      <dt>Eligibility</dt>
                      <dd>Your citizenship, residence permits, sponsorship statements, and posting quotes are evaluated deterministically before anything is drafted.</dd>
                      <dt>Application drafts</dt>
                      <dd>Drafts are prepared from your template and resume. Email drafts wait for approval by default.</dd>
                      <dt>Daily report</dt>
                      <dd>Applied, awaiting approval, needs-you, failed, and uncertain counts are recorded every day, with an optional local notification.</dd>
                    </div>
                  </Panel>
                </div>
              </>
            ) : null}
          </div>

          <div className="row-between mt-4" style={{ marginTop: 'auto', paddingTop: 32 }}>
            <Button variant="ghost" onClick={back} disabled={step === 0 || busy}>
              <ArrowLeft /> Back
            </Button>
            <div className="row">
              {step === 3 && resumes.length === 0 ? (
                <Button variant="ghost" onClick={next} disabled={busy}>
                  Continue without resume
                </Button>
              ) : null}
              {step < STEPS.length - 1 ? (
                <Button
                  variant="primary"
                  onClick={next}
                  loading={busy}
                  disabled={(step === 0 && !identityReady) || (step === 2 && !targetsReady)}
                >
                  Continue <ArrowRight />
                </Button>
              ) : (
                <Button variant="primary" onClick={finish} loading={busy} disabled={!identityReady || !targetsReady}>
                  Enter workspace <ArrowRight />
                </Button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

function ReviewRow({ title, ready, detail, warnOnly = false }: { title: string; ready: boolean; detail: string; warnOnly?: boolean }) {
  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
      <span style={{ marginTop: 1 }}>
        {ready ? <CheckCircle2 size={16} className="color-green" /> : <AlertTriangle size={16} className={warnOnly ? 'color-yellow' : 'color-red'} />}
      </span>
      <div>
        <div className="small strong">{title}</div>
        <div className="small muted">{detail}</div>
      </div>
    </div>
  )
}

function stepTitle(step: number): string {
  switch (step) {
    case 0:
      return 'Start with the facts.'
    case 1:
      return 'Where can you actually work?'
    case 2:
      return 'Choose your search floor.'
    case 3:
      return 'Attach the resume.'
    default:
      return 'Review before entering.'
  }
}

function stepDesc(step: number): string {
  switch (step) {
    case 0:
      return 'These details populate application forms and email templates. Nothing is inferred or invented later.'
    case 1:
      return 'Add honest authorization records for each country. The engine will use the posting text, citizenship routes, and these records to decide eligibility.'
    case 2:
      return 'Targets define where discovery runs and which titles are searched. Keep them narrow enough to review.'
    case 3:
      return 'The default resume is attached to email applications and referenced in web application guidance.'
    default:
      return 'Everything here is editable later. You can change authorization or targets at any time and re-evaluate stored jobs.'
  }
}
