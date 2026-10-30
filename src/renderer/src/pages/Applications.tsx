import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { Archive, ChevronRight, Download, Inbox, RefreshCw, Send, ShieldCheck, Timer, XCircle } from 'lucide-react'
import type { ApplicationChannel, ApplicationStatus } from '@shared/types'
import { call, exportData, queryKeys } from '../lib/api'
import { useDebounced } from '../lib/hooks'
import {
  applicationStatusMeta,
  channelMeta,
  country,
  flagEmoji,
  formatNumber,
  outboxStatusMeta,
  timeAgo,
  verdictMeta
} from '../lib/format'
import {
  Badge,
  Button,
  EmptyState,
  PageError,
  PageHeader,
  PageLoading,
  Pagination,
  Panel,
  SearchInput,
  Select,
  StatCard,
  useToast
} from '../components/ui'

const PAGE_SIZE = 25
const STATUSES: (ApplicationStatus | 'all')[] = [
  'all',
  'awaiting_approval',
  'needs_human',
  'draft',
  'queued',
  'submitted',
  'failed',
  'uncertain',
  'rejected'
]

export default function Applications() {
  const [params, setParams] = useSearchParams()
  const initialStatus = (params.get('status') as ApplicationStatus | 'all' | null) ?? 'all'
  const initialChannel = (params.get('channel') as ApplicationChannel | 'all' | null) ?? 'all'
  const [status, setStatus] = useState<ApplicationStatus | 'all'>(STATUSES.includes(initialStatus) ? initialStatus : 'all')
  const [channel, setChannel] = useState<ApplicationChannel | 'all'>(
    initialChannel === 'email' || initialChannel === 'web' || initialChannel === 'manual' || initialChannel === 'all' ? initialChannel : 'all'
  )
  const [search, setSearch] = useState(params.get('search') ?? '')
  const [offset, setOffset] = useState(0)
  const debounced = useDebounced(search, 280)
  const queryClient = useQueryClient()
  const toast = useToast()

  const filters = useMemo(
    () => ({ search: debounced || undefined, status, channel, limit: PAGE_SIZE, offset }),
    [debounced, status, channel, offset]
  )

  const list = useQuery({ queryKey: queryKeys.applications(filters), queryFn: () => call('applications.list', filters) })
  const dashboard = useQuery({ queryKey: queryKeys.dashboard, queryFn: () => call('app.dashboard'), staleTime: 15_000 })
  const outbox = useQuery({
    queryKey: queryKeys.outbox('all'),
    queryFn: () => call('outbox.list', { limit: 8 }),
    staleTime: 10_000
  })

  const sync = useMutation({
    mutationFn: () => call('tasks.run', { type: 'application.reconcile' }),
    onSuccess: () => {
      toast.success('Reconciliation queued. The worker will compare local state with delivery evidence.')
      queryClient.invalidateQueries({ queryKey: ['queue'] })
      queryClient.invalidateQueries({ queryKey: ['applications'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const exportApplications = useMutation({
    mutationFn: () => exportData('applications'),
    onSuccess: (result) => {
      if (result.saved && result.path) toast.success(`Applications exported to ${result.path}`)
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const stats = dashboard.data?.applicationStats
  const items = list.data?.items ?? []
  const total = list.data?.total ?? 0

  const applyParams = (nextStatus: ApplicationStatus | 'all', nextChannel: ApplicationChannel | 'all') => {
    const query: Record<string, string> = {}
    if (nextStatus !== 'all') query.status = nextStatus
    if (nextChannel !== 'all') query.channel = nextChannel
    if (search.trim()) query.search = search.trim()
    setParams(query, { replace: true })
  }

  return (
    <>
      <PageHeader
        eyebrow="Pipeline"
        title="Applications"
        desc="Every draft, approval, delivery, and response — tracked locally with the evidence used to choose each channel."
        actions={
          <>
            <Button variant="ghost" onClick={() => exportApplications.mutate()} loading={exportApplications.isPending}>
              <Download /> Export
            </Button>
            <Button variant="secondary" onClick={() => sync.mutate()} loading={sync.isPending}>
              <RefreshCw /> Reconcile
            </Button>
            <Link to="/approvals">
              <Button variant="primary">
                <ShieldCheck /> Review approvals
                {stats?.awaitingApproval ? <span className="badge badge-accent">{stats.awaitingApproval}</span> : null}
              </Button>
            </Link>
          </>
        }
      />

      <div className="stat-grid mb-4">
        <StatCard label="Awaiting approval" value={stats ? formatNumber(stats.awaitingApproval) : '—'} tone="warn" icon={Timer} foot={<span>Prepared and waiting for your decision</span>} />
        <StatCard label="Needs you" value={stats ? formatNumber(stats.needsHuman) : '—'} tone="purple" icon={ShieldCheck} foot={<span>Blocked on a missing detail or guided form</span>} />
        <StatCard label="Submitted" value={stats ? formatNumber(stats.submitted) : '—'} tone="success" icon={Send} foot={<span>{stats ? `${stats.emailSubmitted} email · ${stats.webSubmitted} web` : ''}</span>} />
        <StatCard label="Failed / uncertain" value={stats ? formatNumber(stats.failed + stats.uncertain) : '—'} tone="danger" icon={XCircle} foot={<span>Safe to retry; nothing is resent twice</span>} />
      </div>

      <Panel flush>
        <div className="panel-head" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div className="toolbar" style={{ flex: 1 }}>
            <SearchInput value={search} onChange={(value) => { setSearch(value); setOffset(0) }} placeholder="Search title, company, recipient" />
            <Select
              value={status}
              onChange={(event) => {
                const next = event.target.value as ApplicationStatus | 'all'
                setStatus(next)
                setOffset(0)
                applyParams(next, channel)
              }}
              aria-label="Filter by status"
            >
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value === 'all' ? 'All statuses' : applicationStatusMeta[value].label}
                </option>
              ))}
            </Select>
            <Select
              value={channel}
              onChange={(event) => {
                const next = event.target.value as ApplicationChannel | 'all'
                setChannel(next)
                setOffset(0)
                applyParams(status, next)
              }}
              aria-label="Filter by channel"
            >
              <option value="all">All channels</option>
              <option value="email">Email</option>
              <option value="web">Web form</option>
              <option value="manual">Manual</option>
            </Select>
          </div>
          <span className="small muted">
            <Inbox size={12} style={{ verticalAlign: -2 }} /> {formatNumber(total)} application{total === 1 ? '' : 's'}
          </span>
        </div>

        {list.isLoading ? (
          <PageLoading label="Loading applications" />
        ) : list.error ? (
          <PageError error={list.error} onRetry={() => list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Archive}
            title={status === 'all' && !search ? 'No applications yet' : 'Nothing matches these filters'}
            desc={
              status === 'all' && !search
                ? 'Eligible jobs with a complete profile become drafts automatically. They appear here before anything is sent.'
                : 'Adjust the status, channel, or search text to see other applications.'
            }
            action={
              <Link to="/jobs">
                <Button variant="secondary">Browse jobs</Button>
              </Link>
            }
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table table-clickable">
                <thead>
                  <tr>
                    <th>Application</th>
                    <th>Status</th>
                    <th>Channel</th>
                    <th>Verdict</th>
                    <th>Destination</th>
                    <th>Attempt</th>
                    <th>Updated</th>
                    <th style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td style={{ minWidth: 260 }}>
                        <Link to={`/applications/${item.id}`} className="cell-title">
                          {item.jobTitle}
                        </Link>
                        <div className="cell-sub">
                          {item.company}
                          {item.countryCode ? ` · ${flagEmoji(item.countryCode)} ${country(item.countryCode)}` : ''}
                          {item.subject ? ` · ${item.subject}` : ''}
                        </div>
                      </td>
                      <td>
                        <Badge tone={applicationStatusMeta[item.status].tone}>{applicationStatusMeta[item.status].label}</Badge>
                        {item.lastError ? <div className="tiny color-red mt-2 truncate" style={{ maxWidth: 220 }}>{item.lastError}</div> : null}
                      </td>
                      <td>
                        <Badge tone={channelMeta[item.channel].tone}>{channelMeta[item.channel].label}</Badge>
                      </td>
                      <td>
                        {item.verdict ? (
                          <div>
                            <Badge tone={verdictMeta[item.verdict].tone}>{verdictMeta[item.verdict].label}</Badge>
                            {item.score !== null ? <div className="tiny faint mono mt-2">score {item.score}</div> : null}
                          </div>
                        ) : (
                          <span className="muted tiny">—</span>
                        )}
                      </td>
                      <td>
                        <div className="tiny mono truncate" style={{ maxWidth: 220 }}>
                          {item.recipient ?? item.applyUrl ?? '—'}
                        </div>
                      </td>
                      <td className="num muted">{item.attempt}</td>
                      <td className="num muted" style={{ whiteSpace: 'nowrap' }}>
                        {timeAgo(item.updatedAt)}
                      </td>
                      <td>
                        <Link to={`/applications/${item.id}`} aria-label={`Open application ${item.id}`}>
                          <Button variant="ghost" size="sm" iconOnly>
                            <ChevronRight />
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination total={total} limit={PAGE_SIZE} offset={offset} onChange={setOffset} />
          </>
        )}
      </Panel>

      <Panel
        className="mt-4"
        title="Latest outbox messages"
        sub="Mock mode writes .eml files locally. SMTP mode is available only when the kill switch is off."
        flush
      >
        {(outbox.data ?? []).length === 0 ? (
          <div className="empty" style={{ padding: 30 }}>
            <div className="empty-desc">No outbound messages recorded yet.</div>
          </div>
        ) : (
          <div className="list">
            {(outbox.data ?? []).map((message) => (
              <div className="list-row" key={message.id}>
                <Badge tone={outboxStatusMeta[message.status].tone}>{outboxStatusMeta[message.status].label}</Badge>
                <div className="list-row-main">
                  <div className="small strong truncate">{message.subject}</div>
                  <div className="tiny faint truncate">
                    to {message.toAddress} · {message.adapter} · {timeAgo(message.sentAt ?? message.queuedAt)}
                    {message.jobTitle ? ` · ${message.jobTitle}` : ''}
                  </div>
                </div>
                <Link to={`/applications/${message.applicationId}`}>
                  <Button variant="ghost" size="sm">Open</Button>
                </Link>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  )
}
