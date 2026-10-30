import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Clock, Inbox, RotateCcw, ShieldCheck, Sparkles, UserRound, XCircle } from 'lucide-react'
import type { ApplicationListItemDTO } from '@shared/api'
import { call, queryKeys } from '../lib/api'
import {
  applicationStatusMeta,
  channelMeta,
  country,
  flagEmoji,
  fmtDateTime,
  prettyJson,
  timeAgo,
  verdictMeta
} from '../lib/format'
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Modal,
  Notice,
  PageError,
  PageHeader,
  PageLoading,
  Panel,
  ScoreRing,
  Tabs,
  Textarea,
  useToast
} from '../components/ui'

type Tab = 'awaiting_approval' | 'needs_human'

export default function Approvals() {
  const [tab, setTab] = useState<Tab>('awaiting_approval')
  const [preview, setPreview] = useState<ApplicationListItemDTO | null>(null)
  const [rejectTarget, setRejectTarget] = useState<ApplicationListItemDTO | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const queryClient = useQueryClient()
  const toast = useToast()

  const awaiting = useQuery({
    queryKey: [...queryKeys.approvals, 'awaiting'],
    queryFn: () => call('applications.list', { status: 'awaiting_approval', limit: 100 }),
    refetchInterval: 20_000
  })
  const human = useQuery({
    queryKey: [...queryKeys.approvals, 'human'],
    queryFn: () => call('applications.list', { status: 'needs_human', limit: 100 }),
    refetchInterval: 20_000
  })
  const dashboard = useQuery({ queryKey: queryKeys.dashboard, queryFn: () => call('app.dashboard'), staleTime: 15_000 })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.approvals })
    queryClient.invalidateQueries({ queryKey: ['applications'] })
    queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
    queryClient.invalidateQueries({ queryKey: ['queue'] })
    if (preview) queryClient.invalidateQueries({ queryKey: queryKeys.application(preview.id) })
  }

  const approve = useMutation({
    mutationFn: (id: number) => call('applications.approve', { id }),
    onSuccess: () => {
      setPreview(null)
      toast.success('Approved and queued. The worker will handle delivery.')
      refresh()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const retry = useMutation({
    mutationFn: (id: number) => call('applications.retry', { id }),
    onSuccess: () => {
      toast.success('Queued for another attempt.')
      refresh()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const reject = useMutation({
    mutationFn: (input: { id: number; reason: string | null }) => call('applications.reject', input),
    onSuccess: () => {
      setRejectTarget(null)
      setRejectReason('')
      setPreview(null)
      toast.info('Application rejected. Nothing was sent.')
      refresh()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const awaitingItems = awaiting.data?.items ?? []
  const humanItems = human.data?.items ?? []
  const stats = dashboard.data?.applicationStats
  const items = tab === 'awaiting_approval' ? awaitingItems : humanItems
  const activeQuery = tab === 'awaiting_approval' ? awaiting : human

  return (
    <>
      <PageHeader
        eyebrow="Review"
        title="Approvals & blocked applications"
        desc="Approve, edit, or reject prepared applications. While approval is required, nothing leaves this machine without your decision."
        actions={
          <Link to="/automation">
            <Button variant="ghost">
              <ShieldCheck /> Approval policy
            </Button>
          </Link>
        }
      />

      <div className="grid cols-3 mb-4">
        <div className="stat-card">
          <div className="stat-label">Awaiting approval</div>
          <div className="stat-value" style={{ color: 'var(--yellow)' }}>{stats?.awaitingApproval ?? awaitingItems.length}</div>
          <div className="stat-foot">Drafted and ready for a decision</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Blocked on a human</div>
          <div className="stat-value" style={{ color: 'var(--purple)' }}>{stats?.needsHuman ?? humanItems.length}</div>
          <div className="stat-foot">Missing detail or a guided web form</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Queued to send</div>
          <div className="stat-value">{stats?.queued ?? 0}</div>
          <div className="stat-foot">Approved and waiting for the worker</div>
        </div>
      </div>

      <Notice tone="info" className="mb-4">
        <span>
          Approval review is the last human checkpoint. Approving queues the exact subject and body shown in the preview. The outbox is idempotent, so a
          retry cannot send the same application twice.
        </span>
      </Notice>

      <div className="row-between mb-3" style={{ flexWrap: 'wrap', gap: 10 }}>
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { value: 'awaiting_approval', label: 'Awaiting approval', count: awaitingItems.length },
            { value: 'needs_human', label: 'Needs you', count: humanItems.length }
          ]}
        />
        <span className="tiny faint">
          <Clock size={11} style={{ verticalAlign: -1 }} /> Refreshes every 20 seconds
        </span>
      </div>

      <Panel flush>
        {activeQuery.isLoading ? (
          <PageLoading label="Loading decisions" />
        ) : activeQuery.error ? (
          <PageError error={activeQuery.error} onRetry={() => activeQuery.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={tab === 'awaiting_approval' ? ShieldCheck : UserRound}
            title={tab === 'awaiting_approval' ? 'No applications waiting for approval' : 'Nothing blocked'}
            desc={
              tab === 'awaiting_approval'
                ? 'When an eligible job is drafted, it appears here until you approve or reject it. The worker keeps discovering in the meantime.'
                : 'Applications that need a manual action — such as a guided web form — will be listed here.'
            }
            action={
              <Link to="/jobs">
                <Button variant="secondary">Review jobs</Button>
              </Link>
            }
          />
        ) : (
          <div className="list">
            {items.map((item) => {
              const status = applicationStatusMeta[item.status]
              const channel = channelMeta[item.channel]
              return (
                <div className="list-row" key={item.id} style={{ alignItems: 'flex-start', padding: '16px 18px' }}>
                  <button
                    type="button"
                    className="company-avatar"
                    style={{ border: 'none', cursor: 'pointer' }}
                    onClick={() => setPreview(item)}
                    aria-label={`Preview ${item.jobTitle}`}
                  >
                    {item.company
                      .split(/\s+/)
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((part) => part[0]?.toUpperCase())
                      .join('') || '·'}
                  </button>
                  <div className="list-row-main">
                    <div className="row wrap" style={{ gap: 6 }}>
                      <button type="button" className="cell-title" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }} onClick={() => setPreview(item)}>
                        {item.jobTitle}
                      </button>
                      <Badge tone={status.tone}>{status.label}</Badge>
                      <Badge tone={channel.tone}>{channel.label}</Badge>
                      {item.verdict ? <Badge tone={verdictMeta[item.verdict].tone}>{verdictMeta[item.verdict].label}</Badge> : null}
                      {item.score !== null ? <span className="tiny mono faint">score {item.score}</span> : null}
                    </div>
                    <div className="cell-sub">
                      {item.company}
                      {item.countryCode ? ` · ${flagEmoji(item.countryCode)} ${country(item.countryCode)}` : ''} · updated {timeAgo(item.updatedAt)}
                    </div>
                    {item.subject ? <div className="small mt-2"><span className="muted">Subject:</span> {item.subject}</div> : null}
                    {item.recipient ? <div className="tiny mono faint mt-2">to {item.recipient}</div> : null}
                    {item.lastError ? <div className="small color-yellow mt-2">{item.lastError}</div> : null}
                  </div>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {item.status === 'awaiting_approval' ? (
                      <Button variant="primary" size="sm" onClick={() => approve.mutate(item.id)} loading={approve.isPending && approve.variables === item.id}>
                        <CheckCircle2 /> Approve
                      </Button>
                    ) : null}
                    {item.status === 'needs_human' ? (
                      <Button variant="secondary" size="sm" onClick={() => retry.mutate(item.id)} loading={retry.isPending && retry.variables === item.id}>
                        <RotateCcw /> Retry
                      </Button>
                    ) : null}
                    <Button variant="ghost" size="sm" onClick={() => setRejectTarget(item)}>
                      <XCircle /> Reject
                    </Button>
                    <Link to={`/applications/${item.id}`}>
                      <Button variant="ghost" size="sm">
                        Open <ArrowRight size={12} />
                      </Button>
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Panel>

      <PreviewModal
        item={preview}
        onClose={() => setPreview(null)}
        onApprove={(id) => approve.mutate(id)}
        onReject={(item) => {
          setPreview(null)
          setRejectTarget(item)
        }}
        approving={approve.isPending}
      />

      <Modal
        open={Boolean(rejectTarget)}
        onOpenChange={(open) => { if (!open) { setRejectTarget(null); setRejectReason('') } }}
        title="Reject this application?"
        desc="Nothing will be sent. The application closes and the job stays in the pipeline."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejectTarget(null)} disabled={reject.isPending}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => rejectTarget && reject.mutate({ id: rejectTarget.id, reason: rejectReason.trim() || null })}
              loading={reject.isPending}
            >
              Reject application
            </Button>
          </>
        }
      >
        {rejectTarget ? (
          <div className="small muted mb-3">
            {rejectTarget.jobTitle} · {rejectTarget.company}
          </div>
        ) : null}
        <Field label="Reason (optional)" hint="Stored with the application for your own records.">
          <Textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} maxLength={2000} placeholder="Not a fit, wrong seniority, location…" />
        </Field>
      </Modal>
    </>
  )
}

function PreviewModal({
  item,
  onClose,
  onApprove,
  onReject,
  approving
}: {
  item: ApplicationListItemDTO | null
  onClose: () => void
  onApprove: (id: number) => void
  onReject: (item: ApplicationListItemDTO) => void
  approving: boolean
}) {
  const detail = useQuery({
    queryKey: item ? queryKeys.application(item.id) : ['application', 'none'],
    queryFn: () => call('applications.get', { id: item!.id }),
    enabled: Boolean(item)
  })

  return (
    <Modal
      open={Boolean(item)}
      onOpenChange={(open) => { if (!open) onClose() }}
      title="Review application"
      desc={item ? `${item.jobTitle} · ${item.company}` : undefined}
      size="lg"
      footer={
        item ? (
          <>
            <Button variant="ghost" onClick={() => onReject(item)}>
              <XCircle /> Reject
            </Button>
            <Link to={`/applications/${item.id}`}>
              <Button variant="secondary">Open full view</Button>
            </Link>
            {item.status === 'awaiting_approval' ? (
              <Button variant="primary" onClick={() => onApprove(item.id)} loading={approving}>
                <CheckCircle2 /> Approve and queue
              </Button>
            ) : (
              <Badge tone="warn">Resolve before approving</Badge>
            )}
          </>
        ) : null
      }
    >
      {detail.isLoading ? (
        <PageLoading label="Loading draft" />
      ) : detail.error ? (
        <PageError error={detail.error} onRetry={() => detail.refetch()} />
      ) : detail.data ? (
        <>
          <div className="row wrap mb-3" style={{ gap: 8 }}>
            <Badge tone={channelMeta[detail.data.application.channel].tone}>{channelMeta[detail.data.application.channel].label}</Badge>
            {detail.data.evaluation ? (
              <Badge tone={verdictMeta[detail.data.evaluation.verdict].tone}>{verdictMeta[detail.data.evaluation.verdict].label}</Badge>
            ) : null}
            {detail.data.application.recipient ? <span className="tiny mono faint">{detail.data.application.recipient}</span> : null}
            <span className="spacer" />
            <ScoreRing score={detail.data.evaluation?.score ?? null} size={40} />
          </div>
          {detail.data.application.status === 'needs_human' && detail.data.application.lastError ? (
            <Notice tone="warn" className="mb-3">
              {detail.data.application.lastError}
            </Notice>
          ) : null}
          <div className="field">
            <span className="label">Subject</span>
            <div className="small strong">{detail.data.application.subject ?? 'No subject recorded'}</div>
          </div>
          <div className="field mt-3">
            <span className="label">Body</span>
            <div className="prose" style={{ maxHeight: 320, overflowY: 'auto', background: 'var(--bg-elevated)', border: '1px solid var(--line)', borderRadius: 9, padding: 14 }}>
              {detail.data.application.body ?? 'No body recorded'}
            </div>
          </div>
          {detail.data.evaluation && detail.data.evaluation.reasons.length > 0 ? (
            <div className="mt-3">
              <div className="small strong mb-2">Why this application exists</div>
              <div className="stack">
                {detail.data.evaluation.reasons.map((reason, index) => (
                  <div className="small muted" key={index}>· {reason.message}</div>
                ))}
              </div>
            </div>
          ) : null}
          {detail.data.application.decisionEvidence && Object.keys(detail.data.application.decisionEvidence).length > 0 ? (
            <details className="mt-3">
              <summary className="small muted" style={{ cursor: 'pointer' }}>Routing evidence</summary>
              <pre className="pre mt-2" style={{ maxHeight: 180 }}>{prettyJson(detail.data.application.decisionEvidence)}</pre>
            </details>
          ) : null}
          <div className="tiny faint mt-3">
            <Sparkles size={11} style={{ verticalAlign: -1 }} /> Created {fmtDateTime(detail.data.application.createdAt)} · attempt {detail.data.application.attempt}
          </div>
        </>
      ) : item ? (
        <EmptyState icon={Inbox} title="Draft unavailable" desc="The application could not be loaded. Open the full view to retry." />
      ) : null}
    </Modal>
  )
}
