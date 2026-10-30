import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Globe2, Pencil, Plus, Save, ShieldCheck, Stamp, Trash2, UserRound } from 'lucide-react'
import type { CountryAnswerDTO, ProfileDTO, WorkAuthorizationInputDTO } from '@shared/api'
import type { WorkAuthorizationStatus } from '@shared/types'
import { call, queryKeys } from '../lib/api'
import { authStatusMeta, country, countryWithCode, flagEmoji, fmtDate, timeAgo } from '../lib/format'
import { useNow } from '../lib/hooks'
import {
  Badge,
  Button,
  ConfirmDialog,
  CountryChips,
  CountrySelect,
  EmptyState,
  Field,
  Input,
  Modal,
  Notice,
  PageError,
  PageHeader,
  PageLoading,
  Panel,
  Select,
  Switch,
  Textarea,
  useToast
} from '../components/ui'

const STATUS_OPTIONS: WorkAuthorizationStatus[] = ['citizen', 'permanent_resident', 'work_permit', 'student_permit', 'dependent_permit', 'none']

function toRow(item: WorkAuthorizationInputDTO): WorkAuthorizationInputDTO {
  return {
    countryCode: item.countryCode,
    status: item.status,
    permitType: item.permitType ?? null,
    validFrom: item.validFrom ?? null,
    validUntil: item.validUntil ?? null,
    needsSponsorship: item.needsSponsorship,
    evidenceNote: item.evidenceNote ?? null
  }
}

export default function WorkAuthorization() {
  const authorizations = useQuery({ queryKey: ['work-auth'], queryFn: () => call('authorizations.list') })
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => call('profile.get') })
  const answers = useQuery({ queryKey: ['answers'], queryFn: () => call('answers.list') })

  if (authorizations.isLoading || profile.isLoading) return <PageLoading label="Loading authorization records" />
  if (authorizations.error) return <PageError error={authorizations.error} onRetry={() => authorizations.refetch()} />
  if (!authorizations.data || !profile.data) return null

  return <AuthorizationEditor rows={authorizations.data.map(toRow)} profile={profile.data.profile} answers={answers.data ?? []} />
}

function AuthorizationEditor({
  rows: initialRows,
  profile,
  answers
}: {
  rows: WorkAuthorizationInputDTO[]
  profile: ProfileDTO
  answers: CountryAnswerDTO[]
}) {
  const [rows, setRows] = useState<WorkAuthorizationInputDTO[]>(initialRows)
  const [savedRows, setSavedRows] = useState<WorkAuthorizationInputDTO[]>(initialRows)
  const [citizenships, setCitizenships] = useState<string[]>(profile.citizenships)
  const [savedCitizenships, setSavedCitizenships] = useState<string[]>(profile.citizenships)
  const [newCountry, setNewCountry] = useState('')
  const [answerEditor, setAnswerEditor] = useState<CountryAnswerDTO | 'new' | null>(null)
  const [deletingAnswer, setDeletingAnswer] = useState<CountryAnswerDTO | null>(null)
  const queryClient = useQueryClient()
  const toast = useToast()
  const now = useNow(60_000)

  const refreshJobs = () => {
    queryClient.invalidateQueries({ queryKey: ['jobs'] })
    queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    queryClient.invalidateQueries({ queryKey: ['profile'] })
    queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap })
    queryClient.invalidateQueries({ queryKey: ['work-auth'] })
    queryClient.invalidateQueries({ queryKey: ['answers'] })
  }

  const saveCitizenships = useMutation({
    mutationFn: () => call('profile.save', { citizenships }),
    onSuccess: (result) => {
      setCitizenships(result.profile.citizenships)
      setSavedCitizenships(result.profile.citizenships)
      toast.success('Nationality updated. Existing jobs are re-evaluated.')
      refreshJobs()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const saveRows = useMutation({
    mutationFn: () => call('authorizations.replace', rows.map(toRow)),
    onSuccess: (saved) => {
      const mapped = saved.map(toRow)
      setRows(mapped)
      setSavedRows(mapped)
      toast.success('Work authorization saved. Existing jobs are re-evaluated.')
      refreshJobs()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const upsertAnswer = useMutation({
    mutationFn: (input: { id?: number; questionKey: string; questionText: string; countryCode: string | null; answer: string; verified: boolean }) =>
      call('answers.upsert', input),
    onSuccess: () => {
      setAnswerEditor(null)
      toast.success('Answer saved.')
      queryClient.invalidateQueries({ queryKey: ['answers'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const removeAnswer = useMutation({
    mutationFn: (id: number) => call('answers.delete', { id }),
    onSuccess: () => {
      setDeletingAnswer(null)
      toast.info('Answer removed.')
      queryClient.invalidateQueries({ queryKey: ['answers'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const updateRow = (index: number, patch: Partial<WorkAuthorizationInputDTO>) => {
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)))
  }

  const setStatus = (index: number, status: WorkAuthorizationStatus) => {
    const needsSponsorship = status === 'citizen' || status === 'permanent_resident' ? false : status === 'student_permit' || status === 'dependent_permit' ? true : rows[index]?.needsSponsorship ?? false
    updateRow(index, { status, needsSponsorship })
  }

  const addRow = () => {
    if (!newCountry || rows.some((row) => row.countryCode === newCountry)) return
    setRows((current) => [
      ...current,
      { countryCode: newCountry, status: 'work_permit', permitType: null, validFrom: null, validUntil: null, needsSponsorship: true, evidenceNote: null }
    ])
    setNewCountry('')
  }

  const removeRow = (index: number) => {
    setRows((current) => current.filter((_row, rowIndex) => rowIndex !== index))
  }

  const dirty = JSON.stringify(rows) !== JSON.stringify(savedRows)
  const citizenshipDirty = JSON.stringify([...citizenships].sort()) !== JSON.stringify([...savedCitizenships].sort())
  const sponsorshipCount = rows.filter((row) => row.needsSponsorship).length
  const citizenRows = rows.filter((row) => row.status === 'citizen' || row.status === 'permanent_resident').length
  const missingEvidence = rows.filter((row) => row.status === 'work_permit' && !row.validUntil).length

  return (
    <>
      <PageHeader
        eyebrow="Configure"
        title="Nationality & work authorization"
        desc="This is the evidence the eligibility engine uses to decide whether you can work somewhere before a single application is drafted."
        actions={
          <>
            {dirty ? <span className="small color-yellow">Unsaved authorization changes</span> : null}
            <Button variant="ghost" onClick={() => setRows(savedRows)} disabled={!dirty}>Reset</Button>
            <Button variant="primary" onClick={() => saveRows.mutate()} loading={saveRows.isPending} disabled={!dirty}>
              <Save /> Save authorization
            </Button>
          </>
        }
      />

      <div className="stat-grid mb-4">
        <div className="stat-card">
          <div className="stat-label">Citizenships</div>
          <div className="stat-value">{citizenships.length}</div>
          <div className="stat-foot">{citizenships.length > 0 ? citizenships.map((code) => country(code)).join(' · ') : 'No nationality recorded'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Countries with a route</div>
          <div className="stat-value">{rows.length}</div>
          <div className="stat-foot">{citizenRows} by citizenship or residence</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Sponsorship needed</div>
          <div className="stat-value" style={{ color: sponsorshipCount ? 'var(--yellow)' : 'var(--muted)' }}>{sponsorshipCount}</div>
          <div className="stat-foot">Only eligible if the employer offers it</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Permit gaps</div>
          <div className="stat-value" style={{ color: missingEvidence ? 'var(--red)' : 'var(--muted)' }}>{missingEvidence}</div>
          <div className="stat-foot">Work permits without an end date</div>
        </div>
      </div>

      <Notice tone="info" className="mb-4">
        <span>
          Eligibility is decided in this order: citizenship, permanent residence, a valid permit, a free-movement agreement, a bilateral route, then
          employer sponsorship. An unknown or unstated signal never produces an <strong>eligible</strong> verdict — it becomes <strong>needs review</strong>.
        </span>
      </Notice>

      <div className="split-2">
        <div className="stack-lg">
          <Panel
            title="Nationality"
            sub="Stored on your profile so scoring and templates use the same source of truth."
            actions={<Link to="/profile"><Button variant="ghost" size="sm">Open profile</Button></Link>}
          >
            <div className="row-between mb-3">
              <div className="small muted">
                Residence: <strong className="color-muted">{profile.residenceCountry ? countryWithCode(profile.residenceCountry) : 'Not recorded'}</strong>
              </div>
              {citizenshipDirty ? (
                <Button variant="secondary" size="sm" onClick={() => saveCitizenships.mutate()} loading={saveCitizenships.isPending}>
                  <Save /> Save nationality
                </Button>
              ) : null}
            </div>
            <CountryChips values={citizenships} onChange={setCitizenships} addLabel="Add citizenship" />
            <div className="hint mt-2">
              Add every passport you hold. Dual nationality is evaluated against both, so a job can be eligible through the better route.
            </div>
          </Panel>

          <Panel
            title="Work authorization by country"
            sub="Permits, residence rights, and explicit no-authorization records."
            actions={
              <div className="row" style={{ gap: 6 }}>
                <div style={{ width: 190 }}>
                  <CountrySelect
                    value={newCountry}
                    onChange={setNewCountry}
                    exclude={rows.map((row) => row.countryCode)}
                    placeholder="Add a country"
                  />
                </div>
                <Button variant="secondary" size="sm" iconOnly onClick={addRow} disabled={!newCountry} aria-label="Add country authorization">
                  <Plus />
                </Button>
              </div>
            }
          >
            {rows.length === 0 ? (
              <EmptyState
                icon={Stamp}
                title="No work authorization records"
                desc="Citizenship alone may be enough for some countries. Add permits and residence rights so the engine can evaluate the rest."
              />
            ) : (
              <div className="stack-lg">
                {rows.map((row, index) => {
                  const meta = authStatusMeta[row.status]
                  return (
                    <div className="application-card" key={row.countryCode}>
                      <div className="application-card-head">
                        <span style={{ fontSize: 20 }}>{flagEmoji(row.countryCode)}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="application-card-title">{country(row.countryCode)}</div>
                          <div className="tiny faint mono">{row.countryCode}</div>
                        </div>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                        <Button variant="ghost" size="sm" iconOnly onClick={() => removeRow(index)} aria-label={`Remove ${country(row.countryCode)}`}>
                          <Trash2 />
                        </Button>
                      </div>

                      <div className="field-row" style={{ gridTemplateColumns: '1.2fr 1fr 1fr' }}>
                        <Field label="Status">
                          <Select value={row.status} onChange={(event) => setStatus(index, event.target.value as WorkAuthorizationStatus)}>
                            {STATUS_OPTIONS.map((status) => (
                              <option key={status} value={status}>{authStatusMeta[status].label}</option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Permit type">
                          <Input
                            value={row.permitType ?? ''}
                            onChange={(event) => updateRow(index, { permitType: event.target.value || null })}
                            placeholder={row.status === 'work_permit' ? 'Skilled worker visa' : 'Optional'}
                            maxLength={200}
                          />
                        </Field>
                        <Field label="Valid until" hint={row.status === 'work_permit' && !row.validUntil ? 'Add an end date to avoid an expiring route.' : undefined}>
                          <Input type="date" value={row.validUntil ?? ''} onChange={(event) => updateRow(index, { validUntil: event.target.value || null })} />
                        </Field>
                      </div>

                      <div className="row-between mt-3">
                        <div>
                          <div className="switch-row-title">Employer sponsorship required</div>
                          <div className="switch-row-desc">
                            {row.status === 'citizen' || row.status === 'permanent_resident'
                              ? 'Not applicable: you already hold the right to work.'
                              : 'Applications are only eligible when the employer explicitly offers sponsorship.'}
                          </div>
                        </div>
                        <Switch
                          checked={row.needsSponsorship}
                          onCheckedChange={(checked) => updateRow(index, { needsSponsorship: checked })}
                          disabled={row.status === 'citizen' || row.status === 'permanent_resident'}
                          label="Employer sponsorship required"
                        />
                      </div>

                      <Field label="Evidence note" hint="Where this status comes from — permit number, expiry source, or a note for yourself.">
                        <Input
                          value={row.evidenceNote ?? ''}
                          onChange={(event) => updateRow(index, { evidenceNote: event.target.value || null })}
                          placeholder={row.status === 'none' ? 'Why no authorization exists' : 'Optional note'}
                          maxLength={2000}
                        />
                      </Field>
                    </div>
                  )
                })}
              </div>
            )}
            <div className="row mt-3">
              <span className="tiny faint">
                <ShieldCheck size={11} style={{ verticalAlign: -1 }} /> Rows replace the full set on save. Each country appears once.
              </span>
              {dirty ? <span className="spacer" /> : null}
              {dirty ? <Button variant="primary" size="sm" onClick={() => saveRows.mutate()} loading={saveRows.isPending}><Save /> Save changes</Button> : null}
            </div>
          </Panel>
        </div>

        <div className="stack-lg">
          <Panel title="How a verdict is reached">
            <div className="stack">
              {[
                { step: '1', title: 'Citizenship', desc: 'A passport for the job country is the strongest route.' },
                { step: '2', title: 'Residence', desc: 'Permanent residence is treated as an existing right to work.' },
                { step: '3', title: 'Permit validity', desc: 'Work, student, and dependent permits are checked for expiry.' },
                { step: '4', title: 'Agreements', desc: 'Free-movement blocs and bilateral routes are applied with their rule IDs.' },
                { step: '5', title: 'Sponsorship', desc: 'Without another route, the posting must explicitly offer sponsorship.' }
              ].map((item) => (
                <div className="row" key={item.step} style={{ alignItems: 'flex-start', gap: 10 }}>
                  <span className="callout-index">{item.step}</span>
                  <div>
                    <div className="small strong">{item.title}</div>
                    <div className="tiny muted">{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="divider" />
            <div className="tiny faint" style={{ lineHeight: 1.6 }}>
              Residence in a country is not the same as permission to work there. The engine only uses the records above and your citizenships.
            </div>
          </Panel>

          <Panel title="Permit health">
            <div className="stack small">
              <div className="row-between">
                <span className="muted">Records with an end date</span>
                <span>{rows.filter((row) => row.validUntil).length}</span>
              </div>
              <div className="row-between">
                <span className="muted">Expired or expiring soon</span>
                <span className={rows.some((row) => row.validUntil && new Date(row.validUntil).getTime() < Date.now() + 90 * 86_400_000) ? 'color-yellow' : ''}>
                  {rows.filter((row) => row.validUntil && new Date(row.validUntil).getTime() < Date.now() + 90 * 86_400_000).length}
                </span>
              </div>
              <div className="row-between">
                <span className="muted">Citizenship routes</span>
                <span>{citizenships.length}</span>
              </div>
            </div>
            {rows.filter((row) => row.validUntil && new Date(row.validUntil).getTime() < Date.now() + 90 * 86_400_000).length > 0 ? (
              <Notice tone="warn" className="mt-3">
                A permit expires within 90 days. Eligibility that depends on it will change; update the record after renewal.
              </Notice>
            ) : null}
          </Panel>

          <Panel title="Profile coverage">
            <div className="stack small">
              <div className="inline"><UserRound size={13} /> Citizenships: {citizenships.length}</div>
              <div className="inline"><Globe2 size={13} /> Residence country: {profile.residenceCountry ? country(profile.residenceCountry) : 'not set'}</div>
              <div className="inline"><CheckCircle2 size={13} className="color-green" /> Saved {timeAgo(profile.updatedAt, now)}</div>
              {profile.residenceCountry && !authorizationsContain(rows, profile.residenceCountry) ? (
                <div className="inline"><AlertTriangle size={13} className="color-yellow" /> No authorization row for your residence country.</div>
              ) : null}
            </div>
            {profile.residenceCountry && !authorizationsContain(rows, profile.residenceCountry) ? (
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => {
                  setRows((current) => [
                    ...current,
                    { countryCode: profile.residenceCountry!, status: 'permanent_resident', permitType: null, validFrom: null, validUntil: null, needsSponsorship: false, evidenceNote: null }
                  ])
                }}
              >
                <Plus /> Add residence country
              </Button>
            ) : null}
          </Panel>
        </div>
      </div>

      <Panel
        title="Application form answers"
        sub="Reusable, verified answers for common employer questions. Only you can mark an answer verified."
        className="mt-4"
        actions={<Button variant="secondary" size="sm" onClick={() => setAnswerEditor('new')}><Plus /> Add answer</Button>}
        flush
      >
        {answers.length === 0 ? (
          <EmptyState
            icon={Stamp}
            title="No saved answers yet"
            desc="Store answers such as notice period, right to work, or salary expectations. They are reused in guided web applications."
            action={<Button variant="secondary" onClick={() => setAnswerEditor('new')}><Plus /> Add answer</Button>}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Question</th>
                  <th>Scope</th>
                  <th>Answer</th>
                  <th>Verified</th>
                  <th>Updated</th>
                  <th style={{ width: 90 }} />
                </tr>
              </thead>
              <tbody>
                {answers.map((answer) => (
                  <tr key={answer.id}>
                    <td>
                      <div className="cell-title">{answer.questionText}</div>
                      <div className="tiny faint mono">{answer.questionKey}</div>
                    </td>
                    <td>{answer.countryCode ? <Badge tone="info">{flagEmoji(answer.countryCode)} {country(answer.countryCode)}</Badge> : <Badge>Global</Badge>}</td>
                    <td className="small" style={{ maxWidth: 300 }}>{answer.answer}</td>
                    <td>{answer.verified ? <Badge tone="success">Verified</Badge> : <Badge tone="warn">Unverified</Badge>}</td>
                    <td className="num muted">{timeAgo(answer.updatedAt)}</td>
                    <td>
                      <div className="row" style={{ gap: 2 }}>
                        <Button variant="ghost" size="sm" iconOnly onClick={() => setAnswerEditor(answer)} aria-label="Edit answer">
                          <Pencil />
                        </Button>
                        <Button variant="ghost" size="sm" iconOnly onClick={() => setDeletingAnswer(answer)} aria-label="Delete answer">
                          <Trash2 />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="tiny faint mt-3">
        {rows.length} authorization record{rows.length === 1 ? '' : 's'} · {answers.length} saved answer{answers.length === 1 ? '' : 's'} · profile updated {timeAgo(profile.updatedAt, now)}.
      </div>

      {answerEditor ? (
        <AnswerEditor
          key={answerEditor === 'new' ? 'new' : answerEditor.id}
          answer={answerEditor === 'new' ? null : answerEditor}
          onClose={() => setAnswerEditor(null)}
          onSave={(input) => upsertAnswer.mutate(input)}
          saving={upsertAnswer.isPending}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deletingAnswer)}
        onOpenChange={(open) => { if (!open) setDeletingAnswer(null) }}
        title="Delete this answer?"
        description={deletingAnswer ? `“${deletingAnswer.questionText}” will be removed from the local answer bank.` : ''}
        confirmLabel="Delete answer"
        onConfirm={() => deletingAnswer && removeAnswer.mutate(deletingAnswer.id)}
        busy={removeAnswer.isPending}
      />
    </>
  )
}

function authorizationsContain(rows: WorkAuthorizationInputDTO[], countryCode: string): boolean {
  return rows.some((row) => row.countryCode === countryCode)
}

function AnswerEditor({
  answer,
  onClose,
  onSave,
  saving
}: {
  answer: CountryAnswerDTO | null
  onClose: () => void
  onSave: (input: { id?: number; questionKey: string; questionText: string; countryCode: string | null; answer: string; verified: boolean }) => void
  saving: boolean
}) {
  const [questionText, setQuestionText] = useState(answer?.questionText ?? '')
  const [questionKey, setQuestionKey] = useState(answer?.questionKey ?? '')
  const [countryCode, setCountryCode] = useState(answer?.countryCode ?? '')
  const [text, setText] = useState(answer?.answer ?? '')
  const [verified, setVerified] = useState(answer?.verified ?? false)
  const key = questionKey || questionText.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120)
  const canSave = questionText.trim().length > 0 && text.trim().length > 0 && key.length > 0

  return (
    <Modal
      open
      onOpenChange={(open) => { if (!open) onClose() }}
      title={answer ? 'Edit saved answer' : 'Add saved answer'}
      desc="Answers are only used to prefill forms you review. Nothing is submitted automatically."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={!canSave}
            onClick={() =>
              onSave({
                id: answer?.id,
                questionKey: key,
                questionText: questionText.trim(),
                countryCode: countryCode || null,
                answer: text.trim(),
                verified
              })
            }
          >
            Save answer
          </Button>
        </>
      }
    >
      <Field label="Question" required>
        <Input value={questionText} onChange={(event) => setQuestionText(event.target.value)} placeholder="Are you authorized to work in this country?" maxLength={500} />
      </Field>
      <div className="field-row mt-3">
        <Field label="Key" required hint="Stable identifier used to match the question.">
          <Input value={key} onChange={(event) => setQuestionKey(event.target.value)} placeholder="work_authorization" maxLength={120} />
        </Field>
        <Field label="Country scope" hint="Leave global unless the answer depends on the country.">
          <CountrySelect value={countryCode} onChange={setCountryCode} placeholder="Global" />
        </Field>
      </div>
      <Field label="Answer" required className="mt-3">
        <Textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Yes — I hold a valid work permit through 2027." maxLength={4000} />
      </Field>
      <label className="check-row mt-3">
        <input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} />
        <span>
          <span className="small strong">I verified this answer</span>
          <span className="tiny faint"> · Unverified answers are shown as drafts only.</span>
        </span>
      </label>
      {answer ? <div className="tiny faint mt-3">Last updated {fmtDate(answer.updatedAt)}</div> : null}
    </Modal>
  )
}
