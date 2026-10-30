import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Globe2,
  Mail,
  MessageSquare,
  Paperclip,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  XCircle
} from 'lucide-react'
import type { ApplicationDetailBundleDTO } from '@shared/api'
import type { ResponseKind } from '@shared/types'
import { call, openExternal, openWebRun, queryKeys } from '../lib/api'
import {
  applicationStatusMeta,
  channelMeta,
  country,
  flagEmoji,
  formatBytes,
  fmtDateTime,
  prettyJson,
  timeAgo,
  verdictMeta
} from '../lib/format'
import { useDraft, useNow } from '../lib/hooks'
import {
  Badge,
  Button,
  ConfirmDialog,
  Field,
  Input,
  KV,
  Modal,
  Notice,
  PageError,
  PageLoading,
  Panel,
  ScoreRing,
  Select,
  Textarea,
  Timeline,
  useToast
} from '../components/ui'

const RESPONSE_KINDS: { value: ResponseKind; label: string }[] = [
  { value: 'acknowledgement', label: 'Acknowledgement' },
  { value: 'interview', label: 'Interview invitation' },
  { value: 'rejection', label: 'Rejection' },
  { value: 'offer', label: 'Offer' },
  { value: 'other', label: 'Other' }
]

function confirmationSummary(confirmation: Record<string, unknown>): string {
  const note = typeof confirmation.note === 'string' ? confirmation.note.trim() : ''
  if (note) return note
  if (confirmation.adapter === 'mock') return 'Captured in the local mock outbox. No network email was sent.'
  if (confirmation.adapter === 'smtp') return 'Delivered through your SMTP mailbox.'
  return 'Recorded by the delivery adapter.'
}

export default function ApplicationDetail() {
  const { id } = useParams()
  const applicationId = Number(id)
  const bundle = useQuery({
    queryKey: queryKeys.application(applicationId),
    queryFn: () => call('applications.get', { id: applicationId }),
    enabled: Number.isFinite(applicationId) && applicationId > 0,
    refetchInterval: 10_000
  })

  if (!Number.isFinite(applicationId) || applicationId <= 0) {
    return (
      <Panel>
        <div className="empty">
          <div className="empty-title">Invalid application link</div>
          <Link to="/applications" className="mt-2">
            <Button>Back to applications</Button>
          </Link>
        </div>
      </Panel>
    )
  }

  if (bundle.isLoading) return <PageLoading label="Loading application" />
  if (bundle.error) return <PageError error={bundle.error} onRetry={() => bundle.refetch()} />
  if (!bundle.data) return <Panel><div className="empty"><div className="empty-title">Application not found</div></div></Panel>

  return <ApplicationView bundle={bundle.data} />
}

function ApplicationView({ bundle }: { bundle: ApplicationDetailBundleDTO }) {
  const { application, job, evaluation, events, outbox, responses, webRun, resume } = bundle
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()
  const now = useNow(30_000)

  const draft = useDraft({ subject: application.subject ?? '', body: application.body ?? '' })
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmNote, setConfirmNote] = useState('')
  const [responseKind, setResponseKind] = useState<ResponseKind>('acknowledgement')
  const [responseNotes, setResponseNotes] = useState('')

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.application(application.id) })
    queryClient.invalidateQueries({ queryKey: ['applications'] })
    queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
    queryClient.invalidateQueries({ queryKey: ['queue'] })
  }

  const saveDraft = useMutation({
    mutationFn: () => call('applications.saveDraft', { id: application.id, subject: draft.draft.subject.trim(), body: draft.draft.body.trim() }),
    onSuccess: (updated) => {
      draft.reset({ subject: updated.subject ?? '', body: updated.body ?? '' })
      toast.success('Draft saved.')
      refresh()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const approve = useMutation({
    mutationFn: () => call('applications.approve', { id: application.id }),
    onSuccess: () => {
      toast.success('Approved and queued for delivery.')
      refresh()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const reject = useMutation({
    mutationFn: () => call('applications.reject', { id: application.id, reason: rejectReason.trim() || null }),
    onSuccess: () => {
      setRejectOpen(false)
      toast.info('Application rejected. No message was sent.')
      refresh()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const retry = useMutation({
    mutationFn: () => call('applications.retry', { id: application.id }),
    onSuccess: () => {
      toast.success('Queued for another attempt.')
      refresh()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const dispatchNow = useMutation({
    mutationFn: () => call('applications.dispatch', { id: application.id }),
    onSuccess: (result) => {
      toast[result.status === 'submitted' ? 'success' : 'info'](result.detail)
      refresh()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const regenerate = useMutation({
    mutationFn: () => call('tasks.run', { type: 'application.draft', payload: { applicationId: application.id } }),
    onSuccess: () => {
      toast.success('Draft generation queued.')
      refresh()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const recordResponse = useMutation({
    mutationFn: () => call('applications.response', { id: application.id, kind: responseKind, notes: responseNotes.trim() || null }),
    onSuccess: () => {
      setResponseNotes('')
      toast.success('Response recorded.')
      refresh()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const confirmWeb = useMutation({
    mutationFn: () => call('applications.confirmWeb', { id: application.id, note: confirmNote.trim() }),
    onSuccess: () => {
      setConfirmOpen(false)
      setConfirmNote('')
      toast.success('Submission recorded. This application is now marked submitted.')
      refresh()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const reveal = useMutation({
    mutationFn: (messageId: number) => call('outbox.reveal', { id: messageId }),
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const statusMeta = applicationStatusMeta[application.status]
  const channel = channelMeta[application.channel]
  const verdict = evaluation ? verdictMeta[evaluation.verdict] : null
  const canEdit = application.status !== 'submitted' && application.status !== 'sending' && application.status !== 'rejected'
  const isWeb = application.channel === 'web'
  const webUrl = webRun?.url ?? application.applyUrl ?? null
  const latestMessage = outbox[outbox.length - 1] ?? null

  return (
    <>
      <div className="row mb-3" style={{ gap: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/applications')}>
          <ArrowLeft /> Applications
        </button>
        <span className="faint">/</span>
        <span className="small muted truncate">
          #{application.id} · {job.title}
        </span>
      </div>

      <div className="job-hero mb-4">
        <div className="job-hero-top">
          <div className="company-avatar">
            {job.company
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((part) => part[0]?.toUpperCase())
              .join('') || '·'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row wrap mb-2" style={{ gap: 6 }}>
              <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
              <Badge tone={channel.tone}>{channel.label}</Badge>
              {verdict ? <Badge tone={verdict.tone}>{verdict.label}</Badge> : null}
              {application.attempt > 1 ? <Badge tone="warn">Attempt {application.attempt}</Badge> : null}
            </div>
            <Link to={`/jobs/${job.id}`}>
              <h1 className="job-title" style={{ fontSize: 22 }}>{job.title}</h1>
            </Link>
            <div className="job-meta">
              <span>{job.company}</span>
              <span>{job.countryCode ? `${flagEmoji(job.countryCode)} ${country(job.countryCode)}` : job.locationRaw ?? 'Location unknown'}</span>
              <span><Clock /> Updated {timeAgo(application.updatedAt, now)}</span>
              {application.recipient ? <span><Mail /> {application.recipient}</span> : null}
            </div>
          </div>
          <div className="row" style={{ gap: 6, alignItems: 'center' }}>
            <ScoreRing score={evaluation?.score ?? null} size={54} />
            <Button variant="ghost" size="sm" onClick={() => openExternal(job.url)}>
              <ExternalLink /> Job
            </Button>
          </div>
        </div>
      </div>

      {application.status === 'needs_human' ? (
        <Notice tone="warn" className="mb-4" icon={AlertTriangle}>
          <strong>This application needs you.</strong>{' '}
          {application.lastError ?? 'A required detail is missing or the employer uses a guided web form.'}{' '}
          {isWeb ? 'Open the guided form, complete it yourself, then record the submission.' : 'Fix the cause, then retry.'}
        </Notice>
      ) : null}
      {application.status === 'failed' ? (
        <Notice tone="danger" className="mb-4" icon={XCircle}>
          <strong>Delivery failed.</strong> {application.lastError ?? 'The adapter reported an error.'} The attempt counter is safe to retry; the
          idempotency key prevents a duplicate send.
        </Notice>
      ) : null}
      {application.status === 'uncertain' ? (
        <Notice tone="warn" className="mb-4" icon={AlertTriangle}>
          <strong>Delivery is uncertain.</strong> The adapter could not confirm whether the message was accepted. Check the provider before retrying to
          avoid a duplicate.
        </Notice>
      ) : null}
      {application.confirmation && application.status === 'submitted' ? (
        <Notice tone="success" className="mb-4" icon={CheckCircle2}>
          <strong>Submission recorded.</strong> {confirmationSummary(application.confirmation)}
        </Notice>
      ) : null}

      <div className="detail-grid">
        <div className="stack-lg">
          {!isWeb ? (
            <Panel
              title="Application email"
              sub={`Rendered from your template${application.templateId ? ` #${application.templateId}` : ''} · edits are saved locally`}
              actions={
                canEdit ? (
                  <Button variant="secondary" size="sm" onClick={() => saveDraft.mutate()} loading={saveDraft.isPending} disabled={!draft.dirty || !draft.draft.subject.trim() || !draft.draft.body.trim()}>
                    <Save /> Save draft
                  </Button>
                ) : (
                  <Badge tone="neutral">Read-only</Badge>
                )
              }
            >
              <div className="field">
                <span className="label">Subject</span>
                {canEdit ? (
                  <Input
                    value={draft.draft.subject}
                    onChange={(event) => draft.setDraft((current) => ({ ...current, subject: event.target.value }))}
                    placeholder="Subject line"
                    maxLength={300}
                  />
                ) : (
                  <div className="small strong">{application.subject ?? 'No subject recorded'}</div>
                )}
              </div>
              <div className="field mt-3">
                <span className="label">Body</span>
                {canEdit ? (
                  <Textarea
                    value={draft.draft.body}
                    onChange={(event) => draft.setDraft((current) => ({ ...current, body: event.target.value }))}
                    style={{ minHeight: 320, fontFamily: 'var(--font-sans)' }}
                    placeholder="Application body"
                  />
                ) : (
                  <div className="prose" style={{ maxHeight: 420, overflowY: 'auto' }}>
                    {application.body ?? 'No body recorded'}
                  </div>
                )}
              </div>
              <div className="row-between mt-3">
                <span className="tiny faint">
                  {draft.dirty ? 'Unsaved edits' : 'Synced with the stored draft'}
                  {application.recipient ? ` · will be sent to ${application.recipient}` : ''}
                </span>
                {canEdit && draft.dirty ? (
                  <Button variant="ghost" size="sm" onClick={() => draft.reset()}>
                    Discard edits
                  </Button>
                ) : null}
              </div>
              {application.status === 'draft' ? (
                <div className="row mt-3" style={{ gap: 8 }}>
                  <Button variant="secondary" size="sm" onClick={() => regenerate.mutate()} loading={regenerate.isPending}>
                    <Sparkles /> Regenerate with current profile
                  </Button>
                  <span className="tiny faint">Generation also works with AI switched off.</span>
                </div>
              ) : null}
            </Panel>
          ) : (
            <Panel
              title="Guided web application"
              sub="The app never bypasses sign-in, CAPTCHA, or anti-bot checks. It opens the employer page for you."
              actions={
                webUrl ? (
                  <Button variant="secondary" size="sm" onClick={() => openWebRun(application.id, webUrl)}>
                    <Globe2 /> Open guided window
                  </Button>
                ) : null
              }
            >
              {webRun ? (
                <>
                  <div className="row wrap mb-3" style={{ gap: 6 }}>
                    <Badge tone={webRun.status === 'submitted' ? 'success' : webRun.status === 'failed' ? 'danger' : 'warn'}>
                      {webRun.status.replace(/_/g, ' ')}
                    </Badge>
                    <span className="tiny faint mono truncate">{webRun.url}</span>
                  </div>
                  <div className="stack">
                    {webRun.steps.map((step, index) => (
                      <div className="row" key={index} style={{ alignItems: 'flex-start', gap: 10 }}>
                        <Badge tone={step.status === 'done' ? 'success' : step.status === 'failed' ? 'danger' : step.status === 'blocked' ? 'warn' : 'neutral'}>
                          {step.status}
                        </Badge>
                        <div style={{ minWidth: 0 }}>
                          <div className="small">{step.label}</div>
                          {step.detail ? <div className="tiny faint">{step.detail}</div> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                  {Object.keys(webRun.prefilled ?? {}).length > 0 ? (
                    <>
                      <div className="divider" />
                      <div className="small strong mb-2">Prefilled answers</div>
                      <KV
                        items={Object.entries(webRun.prefilled).map(([key, value]) => ({
                          k: key.replace(/_/g, ' '),
                          v: <span className="small">{typeof value === 'string' ? value : prettyJson(value)}</span>
                        }))}
                      />
                    </>
                  ) : null}
                  {webRun.lastError ? <div className="notice notice-danger mt-3">{webRun.lastError}</div> : null}
                </>
              ) : (
                <div className="small muted">
                  No guided run has been prepared yet. Approve this application to create one, or open the employer page directly.
                </div>
              )}

              {application.status !== 'submitted' ? (
                <>
                  <div className="divider" />
                  <div className="stack">
                    <div className="small strong">Already submitted on the employer site?</div>
                    <div className="small muted">
                      Complete the form yourself in the guided window, then record the confirmation note here. The app will not claim a submission
                      without your confirmation.
                    </div>
                    <div className="row">
                      <Button variant="secondary" size="sm" onClick={() => setConfirmOpen(true)} disabled={application.status !== 'queued' && application.status !== 'needs_human'}>
                        <CheckCircle2 /> Mark as submitted
                      </Button>
                      {webUrl ? (
                        <Button variant="ghost" size="sm" onClick={() => openExternal(webUrl)}>
                          Open in browser
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </>
              ) : null}
            </Panel>
          )}

          <Panel title="Job posting" actions={<Link to={`/jobs/${job.id}`}><Button variant="ghost" size="sm">Open job</Button></Link>}>
            <div className="row wrap mb-3" style={{ gap: 6 }}>
              <Badge tone={verdict?.tone ?? 'neutral'}>{verdict?.label ?? 'Not evaluated'}</Badge>
              {job.sponsorSignal ? <Badge tone="neutral">{job.sponsorSignal.replace(/_/g, ' ')}</Badge> : null}
              {job.skills.slice(0, 6).map((skill) => (
                <span className="chip" key={skill}>{skill}</span>
              ))}
            </div>
            <div className="prose" style={{ maxHeight: 360, overflowY: 'auto' }}>
              {job.descriptionText}
            </div>
          </Panel>

          <Panel title="Activity" flush>
            <div className="panel-body">
              <Timeline
                items={events.map((event) => ({
                  id: event.id,
                  title: event.message,
                  meta: `${event.category} · ${fmtDateTime(event.ts)} · ${event.actor}`,
                  level: event.level
                }))}
              />
            </div>
          </Panel>
        </div>

        <div className="stack-lg">
          <Panel title="Actions">
            <div className="stack">
              {application.status === 'awaiting_approval' ? (
                <Button variant="primary" onClick={() => approve.mutate()} loading={approve.isPending}>
                  <ShieldCheck /> Approve and queue
                </Button>
              ) : null}
              {application.status === 'queued' ? (
                <Button variant="primary" onClick={() => dispatchNow.mutate()} loading={dispatchNow.isPending}>
                  {isWeb ? <Globe2 /> : <Send />} {isWeb ? 'Prepare web run now' : 'Send now'}
                </Button>
              ) : null}
              {application.status === 'failed' || application.status === 'needs_human' ? (
                <Button variant="primary" onClick={() => retry.mutate()} loading={retry.isPending}>
                  <RotateCcw /> Retry
                </Button>
              ) : null}
              {canEdit && application.status === 'draft' ? (
                <Button variant="secondary" onClick={() => saveDraft.mutate()} loading={saveDraft.isPending} disabled={!draft.dirty}>
                  <Save /> Save draft
                </Button>
              ) : null}
              {application.status !== 'submitted' && application.status !== 'rejected' && application.status !== 'withdrawn' ? (
                <Button variant="danger" onClick={() => setRejectOpen(true)}>
                  <XCircle /> Reject
                </Button>
              ) : null}
              {application.applyUrl ? (
                <Button variant="ghost" onClick={() => openExternal(application.applyUrl!)}>
                  <ExternalLink /> Open application page
                </Button>
              ) : null}
            </div>
            <div className="tiny faint mt-3">
              {application.approvedAt ? `Approved ${fmtDateTime(application.approvedAt)}. ` : ''}
              {application.submittedAt ? `Submitted ${fmtDateTime(application.submittedAt)}.` : ''}
            </div>
          </Panel>

          <Panel title="Decision evidence">
            <KV
              items={[
                { k: 'Channel', v: <Badge tone={channel.tone}>{channel.label}</Badge> },
                { k: 'Reason', v: <span className="small">{application.channelReason}</span> },
                { k: 'Recipient', v: application.recipient ? <span className="mono tiny">{application.recipient}</span> : '—' },
                { k: 'Apply URL', v: application.applyUrl ? <span className="tiny truncate" style={{ maxWidth: 190, display: 'inline-block' }}>{application.applyUrl}</span> : '—' },
                { k: 'Attempt', v: application.attempt },
                { k: 'Created', v: fmtDateTime(application.createdAt) },
                { k: 'Updated', v: fmtDateTime(application.updatedAt) },
                { k: 'Resume', v: resume ? `${resume.fileName} · ${formatBytes(resume.sizeBytes)}` : 'Default resume' },
                { k: 'Active', v: application.active ? 'Yes' : 'No' }
              ]}
            />
            {Object.keys(application.decisionEvidence).length > 0 ? (
              <details className="mt-3">
                <summary className="small muted" style={{ cursor: 'pointer' }}>Routing evidence</summary>
                <pre className="pre mt-2" style={{ maxHeight: 220 }}>{prettyJson(application.decisionEvidence)}</pre>
              </details>
            ) : null}
          </Panel>

          <Panel title="Outbox">
            {outbox.length === 0 ? (
              <div className="small muted">No delivery attempt has been made yet.</div>
            ) : (
              <div className="stack">
                {outbox.map((message) => (
                  <div key={message.id} className="application-card" style={{ padding: 12 }}>
                    <div className="row-between">
                      <Badge tone={message.status === 'sent' ? 'success' : message.status === 'failed' ? 'danger' : 'warn'}>{message.status}</Badge>
                      <span className="tiny faint">{message.adapter}</span>
                    </div>
                    <div className="tiny mono truncate">to {message.toAddress}</div>
                    <div className="tiny faint">
                      attempt {message.attempt} · key {message.idempotencyKey}
                    </div>
                    {message.error ? <div className="tiny color-red">{message.error}</div> : null}
                    <div className="row" style={{ gap: 6 }}>
                      <Button variant="ghost" size="sm" onClick={() => reveal.mutate(message.id)} disabled={reveal.isPending}>
                        <Paperclip /> Reveal file
                      </Button>
                      <span className="tiny faint">{message.sentAt ? fmtDateTime(message.sentAt) : message.queuedAt ? `queued ${fmtDateTime(message.queuedAt)}` : ''}</span>
                    </div>
                  </div>
                ))}
                {latestMessage?.attachments.length ? (
                  <div className="tiny faint">Attachments: {latestMessage.attachments.map((item) => item.fileName).join(', ')}</div>
                ) : null}
              </div>
            )}
          </Panel>

          <Panel title="Responses" sub="Recorded by you; the app does not read your mailbox.">
            {responses.length > 0 ? (
              <div className="stack mb-3">
                {responses.map((response) => (
                  <div key={response.id} className="row-between">
                    <div>
                      <div className="small strong">{response.kind}</div>
                      <div className="tiny faint">{fmtDateTime(response.receivedAt)} · {response.channel}</div>
                      {response.notes ? <div className="tiny muted">{response.notes}</div> : null}
                    </div>
                    <MessageSquare size={14} className="faint" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="small muted mb-3">No responses recorded.</div>
            )}
            <div className="stack">
              <Select value={responseKind} onChange={(event) => setResponseKind(event.target.value as ResponseKind)} aria-label="Response kind">
                {RESPONSE_KINDS.map((kind) => (
                  <option key={kind.value} value={kind.value}>{kind.label}</option>
                ))}
              </Select>
              <Input value={responseNotes} onChange={(event) => setResponseNotes(event.target.value)} placeholder="Optional note" maxLength={2000} />
              <Button variant="secondary" size="sm" onClick={() => recordResponse.mutate()} loading={recordResponse.isPending}>
                <MessageSquare /> Record response
              </Button>
            </div>
          </Panel>

          {evaluation ? (
            <Panel title="Eligibility snapshot">
              <div className="row" style={{ gap: 14 }}>
                <ScoreRing score={evaluation.score} size={54} />
                <div>
                  <Badge tone={verdict?.tone}>{verdict?.label}</Badge>
                  <div className="tiny faint mt-2">{evaluation.requiresSponsorship ? 'Sponsorship required' : 'No sponsorship needed'}</div>
                </div>
              </div>
              <div className="stack mt-3">
                {evaluation.reasons.slice(0, 4).map((reason, index) => (
                  <div className="small muted" key={index}>· {reason.message}</div>
                ))}
              </div>
            </Panel>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title="Reject this application?"
        description={
          <div>
            <p>No message will be sent and the application will be closed. This does not delete the job or its history.</p>
            <Field label="Reason (optional)" className="mt-3">
              <Textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="Why are you skipping this one?" maxLength={2000} />
            </Field>
          </div>
        }
        confirmLabel="Reject application"
        onConfirm={() => reject.mutate()}
        busy={reject.isPending}
      />

      <Modal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Record web submission"
        desc="Only confirm after you completed the employer's form yourself."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={confirmWeb.isPending}>Cancel</Button>
            <Button variant="primary" onClick={() => confirmWeb.mutate()} loading={confirmWeb.isPending} disabled={confirmNote.trim().length < 3}>
              Mark submitted
            </Button>
          </>
        }
      >
        <Field label="Confirmation note" required hint="For example: confirmation page shown, reference number, or the time you submitted.">
          <Textarea
            value={confirmNote}
            onChange={(event) => setConfirmNote(event.target.value)}
            placeholder="Submitted on the employer site — confirmation reference ABC-123."
            minLength={3}
            maxLength={2000}
          />
        </Field>
      </Modal>
    </>
  )
}
