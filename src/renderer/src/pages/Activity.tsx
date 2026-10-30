import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Activity as ActivityIcon,
  AlertTriangle,
  Clock,
  Download,
  ExternalLink,
  Info,
  ListFilter,
  RefreshCw
} from 'lucide-react'
import type { EventDTO } from '@shared/api'
import type { Severity } from '@shared/types'
import { call, exportData } from '../lib/api'
import { fmtDateTime, humanizeCategory, plural, severityMeta, timeAgo } from '../lib/format'
import { useDebounced, useNow } from '../lib/hooks'
import {
  Badge,
  Button,
  EmptyState,
  KV,
  Modal,
  Notice,
  PageError,
  PageHeader,
  PageLoading,
  Pagination,
  Panel,
  SearchInput,
  Segmented,
  Select,
  StatCard,
  useToast
} from '../components/ui'

const PAGE_SIZE = 50

const CATEGORY_GROUPS: { label: string; categories: string[] }[] = [
  {
    label: 'Discovery',
    categories: [
      'job.discovered',
      'job.duplicate',
      'job.below_threshold',
      'job.evaluate_failed',
      'job.profile_incomplete',
      'target.polled',
      'target.saved',
      'source.fetched',
      'source.failed',
      'source.saved',
      'source.deleted',
      'source.test_ok',
      'source.test_failed'
    ]
  },
  {
    label: 'Applications',
    categories: [
      'application.created',
      'application.drafted',
      'application.awaiting_approval',
      'application.approved',
      'application.rejected',
      'application.submitted',
      'application.needs_human',
      'application.draft_edited',
      'application.retry',
      'application.limit',
      'application.status'
    ]
  },
  {
    label: 'Delivery & responses',
    categories: ['email.sent', 'email.failed', 'email.mock_sent', 'response.received']
  },
  {
    label: 'AI',
    categories: ['ai.fallback']
  },
  {
    label: 'System',
    categories: [
      'settings.updated',
      'profile.updated',
      'authorizations.updated',
      'secret.updated',
      'resume.added',
      'system.started',
      'system.startup',
      'worker.started',
      'worker.stopped',
      'worker.claim_failed',
      'task.failed',
      'schedule.failed',
      'schedule.invalid',
      'digest.generated',
      'maintenance.reaper',
      'maintenance.retention'
    ]
  }
]

export default function Activity() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const now = useNow(30_000)
  const [search, setSearch] = useState('')
  const [level, setLevel] = useState<Severity | 'all'>('all')
  const [category, setCategory] = useState('all')
  const [offset, setOffset] = useState(0)
  const [detail, setDetail] = useState<EventDTO | null>(null)
  const debouncedSearch = useDebounced(search, 250)

  useEffect(() => {
    setOffset(0)
  }, [debouncedSearch, level, category])

  const filters = useMemo(
    () => ({
      search: debouncedSearch.trim() || undefined,
      level,
      category: category === 'all' ? undefined : category,
      limit: PAGE_SIZE,
      offset
    }),
    [debouncedSearch, level, category, offset]
  )

  const events = useQuery({
    queryKey: ['events', filters],
    queryFn: () => call('events.list', filters),
    refetchInterval: 15_000
  })

  const exportLog = useMutation({
    mutationFn: () => exportData('events'),
    onSuccess: (result) => {
      if (result.saved) toast.success(`Event log exported to ${result.path}`)
      else toast.info('Export cancelled.')
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  if (events.isLoading && !events.data) return <PageLoading label="Reading the activity log" />
  if (events.error) return <PageError error={events.error} onRetry={() => events.refetch()} />

  const data = events.data!
  const errors = data.items.filter((event) => event.level === 'error').length
  const warnings = data.items.filter((event) => event.level === 'warn').length
  const latest = data.items[0]?.ts ?? null
  const filtered = Boolean(debouncedSearch.trim() || level !== 'all' || category !== 'all')

  return (
    <>
      <PageHeader
        eyebrow="Local event ledger"
        title="Activity"
        desc="Every meaningful action writes an event: discovery, eligibility decisions, drafts, approvals, deliveries, AI fallbacks, and maintenance. This log is the audit trail behind every count in the app."
        actions={
          <>
            <Button variant="secondary" onClick={() => exportLog.mutate()} loading={exportLog.isPending}>
              <Download /> Export log
            </Button>
            <Button variant="ghost" iconOnly title="Refresh" onClick={() => queryClient.invalidateQueries({ queryKey: ['events'] })}>
              <RefreshCw />
            </Button>
          </>
        }
      />

      <div className="stat-grid mb-4">
        <StatCard
          label={filtered ? 'Matching events' : 'Stored events'}
          value={data.total}
          unit="records"
          foot={filtered ? 'Filters are applied on the main process' : 'Newest first, retained per your settings'}
          icon={ActivityIcon}
        />
        <StatCard label="Errors in view" value={errors} unit="events" foot={errors > 0 ? 'Inspect detail before retrying a task' : 'No errors on this page'} tone={errors > 0 ? 'danger' : 'success'} icon={AlertTriangle} />
        <StatCard label="Warnings in view" value={warnings} unit="events" foot="Warnings do not stop the pipeline by themselves" tone={warnings > 0 ? 'warn' : 'neutral'} icon={Info} />
        <StatCard label="Most recent" value={latest ? timeAgo(latest, now) : 'None'} foot={latest ? fmtDateTime(latest) : 'No events match the current filter'} icon={Clock} />
      </div>

      <Panel
        title="Event log"
        sub="Click any row to inspect the stored detail payload and linked records."
        actions={
          <div className="row" style={{ gap: 8 }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search message or category" />
            <Select value={category} onChange={(event) => setCategory(event.target.value)} style={{ width: 210 }}>
              <option value="all">All categories</option>
              {CATEGORY_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.categories.map((item) => (
                    <option key={item} value={item}>
                      {humanizeCategory(item)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </div>
        }
        flush
      >
        <div className="row-between" style={{ padding: '10px 16px', borderBottom: '1px solid var(--line-soft)' }}>
          <Segmented
            options={[
              { value: 'all', label: 'All levels' },
              { value: 'info', label: 'Info' },
              { value: 'warn', label: 'Warnings' },
              { value: 'error', label: 'Errors' }
            ]}
            value={level}
            onChange={(value) => setLevel(value)}
          />
          <span className="tiny faint inline">
            <ListFilter size={12} /> {filtered ? 'Filtered on the main process' : 'Showing the full recent ledger'}
          </span>
        </div>

        {data.items.length === 0 ? (
          <EmptyState
            icon={ActivityIcon}
            title={filtered ? 'No events match these filters' : 'No events recorded yet'}
            desc={filtered ? 'Clear the search or choose a different level or category.' : 'Worker activity will appear here after the first discovery scan or application action.'}
          />
        ) : (
          <div className="table-wrap">
            <table className="table table-clickable">
              <thead>
                <tr>
                  <th style={{ width: 150 }}>Time</th>
                  <th style={{ width: 90 }}>Level</th>
                  <th style={{ width: 200 }}>Category</th>
                  <th>Message</th>
                  <th style={{ width: 160 }}>Actor</th>
                  <th style={{ width: 100 }}>Links</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((event) => {
                  const meta = severityMeta[event.level]
                  return (
                    <tr key={event.id} onClick={() => setDetail(event)}>
                      <td>
                        <div className="mono small">{fmtDateTime(event.ts)}</div>
                        <div className="cell-sub">{timeAgo(event.ts, now)}</div>
                      </td>
                      <td>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </td>
                      <td>
                        <span className="tiny mono">{event.category}</span>
                      </td>
                      <td>
                        <div className="small">{event.message}</div>
                        {event.detail ? <div className="cell-sub">{plural(Object.keys(event.detail).length, 'detail field')}</div> : null}
                      </td>
                      <td>
                        <Badge tone={event.actor === 'user' ? 'info' : event.actor === 'system' ? 'neutral' : 'accent'}>{event.actor}</Badge>
                      </td>
                      <td onClick={(event_) => event_.stopPropagation()}>
                        <div className="row" style={{ gap: 4 }}>
                          {event.jobId ? (
                            <Link to={`/jobs/${event.jobId}`} className="btn btn-ghost btn-sm btn-icon" title="Open job">
                              <ExternalLink />
                            </Link>
                          ) : null}
                          {event.applicationId ? (
                            <Link to={`/applications/${event.applicationId}`} className="btn btn-ghost btn-sm btn-icon" title="Open application">
                              <ExternalLink />
                            </Link>
                          ) : null}
                          {!event.jobId && !event.applicationId && event.sourceId ? (
                            <Link to="/sources" className="btn btn-ghost btn-sm btn-icon" title="Open sources">
                              <ExternalLink />
                            </Link>
                          ) : null}
                          {!event.jobId && !event.applicationId && !event.sourceId && event.taskId ? (
                            <Link to="/queue" className="btn btn-ghost btn-sm btn-icon" title="Open queue">
                              <ExternalLink />
                            </Link>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination total={data.total} limit={PAGE_SIZE} offset={offset} onChange={setOffset} />
      </Panel>

      <div className="row-between mt-3 small faint wrap" style={{ gap: 8 }}>
        <span>
          Showing {data.items.length} of {data.total} matching record{data.total === 1 ? '' : 's'} · retained for the configured retention window.
        </span>
        <span>{plural(data.items.length, 'event')} loaded from the local database.</span>
      </div>

      <Modal
        open={Boolean(detail)}
        onOpenChange={(open) => {
          if (!open) setDetail(null)
        }}
        title={detail ? humanizeCategory(detail.category) : 'Event detail'}
        desc={detail ? `${fmtDateTime(detail.ts)} · actor ${detail.actor}` : undefined}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDetail(null)}>
              Close
            </Button>
            {detail?.applicationId ? (
              <Link to={`/applications/${detail.applicationId}`}>
                <Button variant="secondary">
                  <ExternalLink /> Open application
                </Button>
              </Link>
            ) : detail?.jobId ? (
              <Link to={`/jobs/${detail.jobId}`}>
                <Button variant="secondary">
                  <ExternalLink /> Open job
                </Button>
              </Link>
            ) : null}
          </>
        }
      >
        {detail ? (
          <div className="stack">
            <div className="row" style={{ gap: 8 }}>
              <Badge tone={severityMeta[detail.level].tone}>{severityMeta[detail.level].label}</Badge>
              <span className="mono tiny faint">{detail.category}</span>
            </div>
            <div className="small" style={{ lineHeight: 1.6 }}>
              {detail.message}
            </div>
            <KV
              items={[
                { k: 'Event ID', v: detail.id },
                { k: 'Timestamp', v: fmtDateTime(detail.ts) },
                { k: 'Actor', v: detail.actor },
                { k: 'Job', v: detail.jobId ? <Link className="color-accent" to={`/jobs/${detail.jobId}`}>#{detail.jobId}</Link> : '—' },
                {
                  k: 'Application',
                  v: detail.applicationId ? (
                    <Link className="color-accent" to={`/applications/${detail.applicationId}`}>
                      #{detail.applicationId}
                    </Link>
                  ) : (
                    '—'
                  )
                },
                { k: 'Source', v: detail.sourceId ?? '—' },
                { k: 'Task', v: detail.taskId ? <Link className="color-accent" to="/queue">#{detail.taskId}</Link> : '—' }
              ]}
            />
            {detail.detail ? (
              <div>
                <div className="label mb-2">Stored detail</div>
                <pre className="pre">{JSON.stringify(detail.detail, null, 2)}</pre>
              </div>
            ) : (
              <div className="small muted">This event has no structured detail payload.</div>
            )}
            <Notice tone="info" icon={Info}>
              Events are append-only. Retention cleanup removes old events in whole days; it never edits a record.
            </Notice>
          </div>
        ) : null}
      </Modal>
    </>
  )
}
