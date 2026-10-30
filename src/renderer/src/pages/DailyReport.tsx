import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowRight, CalendarCheck, ChevronLeft, ChevronRight, CircleAlert, Sparkles } from 'lucide-react'
import { call } from '../lib/api'
import {
  dateKey,
  fmtDate,
  fmtDay,
  fmtWeekday,
  humanizeCategory,
  plural,
  timeAgo
} from '../lib/format'
import {
  Badge,
  Bars,
  Button,
  EmptyState,
  Notice,
  PageError,
  PageHeader,
  PageLoading,
  Panel,
  StatCard,
  StatusDot,
  Timeline,
  useToast
} from '../components/ui'

export default function DailyReport() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [selectedDate, setSelectedDate] = useState<string | undefined>(undefined)

  const report = useQuery({
    queryKey: ['daily-report', selectedDate ?? 'today'],
    queryFn: () => call('app.dailyReport', selectedDate ? { date: selectedDate } : undefined),
    refetchInterval: 30_000
  })

  const generate = useMutation({
    mutationFn: (date: string) => call('tasks.run', { type: 'digest.generate', payload: { date } }),
    onSuccess: () => {
      toast.success('Digest queued. It will appear in the archive shortly.')
      void queryClient.invalidateQueries({ queryKey: ['daily-report'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  if (report.isLoading && !report.data) return <PageLoading label="Building the daily ledger" />
  if (report.error) return <PageError error={report.error} onRetry={() => report.refetch()} />
  const data = report.data!
  const metrics = data.metrics
  const date = data.date
  const isToday = date === dateKey()

  const shift = (days: number) => {
    const base = new Date(`${date}T12:00:00`)
    base.setDate(base.getDate() + days)
    const next = dateKey(base)
    if (next > dateKey()) return
    setSelectedDate(next)
  }

  return (
    <>
      <PageHeader
        eyebrow="Daily ledger"
        title={isToday ? 'Today’s report' : fmtDay(date)}
        desc="Every count is derived from stored events and application records for the selected day. Selection dates use your local time zone."
        actions={
          <>
            <div className="row" style={{ gap: 4 }}>
              <Button size="sm" variant="ghost" iconOnly aria-label="Previous day" onClick={() => shift(-1)}>
                <ChevronLeft />
              </Button>
              <input
                className="input input-sm"
                type="date"
                value={date}
                max={dateKey()}
                onChange={(event) => setSelectedDate(event.target.value || undefined)}
                style={{ width: 150 }}
                aria-label="Report date"
              />
              <Button size="sm" variant="ghost" iconOnly aria-label="Next day" disabled={isToday} onClick={() => shift(1)}>
                <ChevronRight />
              </Button>
            </div>
            {isToday ? null : (
              <Button size="sm" variant="secondary" onClick={() => setSelectedDate(undefined)}>
                Today
              </Button>
            )}
            <Button variant="primary" onClick={() => generate.mutate(date)} loading={generate.isPending}>
              <Sparkles /> Generate digest
            </Button>
          </>
        }
      />

      <div className="stat-grid mb-4">
        <StatCard
          label="Applied"
          value={metrics.submitted}
          unit={metrics.submitted === 1 ? 'application' : 'applications'}
          foot={`${metrics.emailSubmitted} email · ${metrics.webSubmitted} web`}
          spark={data.days.map((day) => day.submitted)}
          tone="success"
        />
        <StatCard
          label="Awaiting approval"
          value={data.backlog.awaitingApproval}
          unit="current backlog"
          foot="Drafts prepared on this or earlier days"
          spark={data.days.map((day) => day.awaitingApproval)}
          tone="warn"
        />
        <StatCard
          label="Needs you"
          value={data.backlog.needsHuman}
          unit="current backlog"
          foot={`${metrics.needsHuman} raised on ${fmtDay(date)}`}
          spark={data.days.map((day) => day.needsHuman)}
          tone="purple"
        />
        <StatCard
          label="Responses"
          value={metrics.responses}
          unit="recorded"
          foot={`${plural(metrics.emailsSent, 'email')} sent · ${metrics.emailsFailed} failed`}
          spark={data.days.map((day) => day.responses)}
          tone="info"
        />
      </div>

      {metrics.sourcesFailed > 0 ? (
        <Notice tone="warn" className="mb-4">
          {plural(metrics.sourcesFailed, 'source')} failed on {fmtDay(date)}. <Link className="color-accent" to="/sources">Review source health</Link>.
        </Notice>
      ) : null}
      {metrics.aiFallbacks > 0 ? (
        <Notice tone="info" className="mb-4">
          AI was unavailable {plural(metrics.aiFallbacks, 'time')} on this day. Drafting continued deterministically; no application was skipped.
        </Notice>
      ) : null}

      <div className="split-2">
        <div>
          <Panel
            title={`Digest · ${fmtDay(date)}`}
            sub={data.digest.headline}
            actions={
              <Link to="/activity">
                <Button size="sm" variant="ghost">
                  Event log <ArrowRight />
                </Button>
              </Link>
            }
          >
            <div className="mini-grid">
              <Mini label="Discovered" value={metrics.jobsDiscovered} />
              <Mini label="Eligible" value={metrics.jobsEligible} tone="green" />
              <Mini label="Drafted" value={metrics.applicationsDrafted} />
              <Mini label="Submitted" value={metrics.submitted} tone="green" />
            </div>
            {data.digest.attention.length > 0 ? (
              <>
                <div className="divider" />
                <div className="stack">
                  {data.digest.attention.map((item) => (
                    <div className="row small" key={item} style={{ alignItems: 'flex-start' }}>
                      <CircleAlert size={14} className="color-yellow" style={{ marginTop: 2, flex: 'none' }} />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="row small muted mt-3">
                <StatusDot tone="success" /> Nothing is waiting on you from this day’s work.
              </div>
            )}
            {data.digest.highlights.length > 0 ? (
              <>
                <div className="divider" />
                <div className="stack small muted">
                  {data.digest.highlights.map((item) => (
                    <div key={item}>{item}</div>
                  ))}
                </div>
              </>
            ) : null}
          </Panel>

          <Panel
            title="Activity · last 14 days"
            sub="Solid = submitted applications · faint = drafted applications"
          >
            <Bars
              items={data.days.map((day) => ({
                label: fmtWeekday(day.date),
                value: day.submitted,
                soft: day.applicationsDrafted,
                title: `${day.date}: ${day.submitted} submitted, ${day.applicationsDrafted} drafted, ${day.jobsDiscovered} discovered`
              }))}
            />
            <div className="row small muted mt-3 wrap" style={{ gap: 14 }}>
              <span className="mono">{sum(data.days, 'submitted')} submitted</span>
              <span className="mono">{sum(data.days, 'applicationsDrafted')} drafted</span>
              <span className="mono">{sum(data.days, 'jobsDiscovered')} discovered</span>
              <span className="spacer" />
              <span>Queue: {data.queue.pending} pending · {data.queue.doneToday} done today</span>
            </div>
          </Panel>

          <Panel title="Recorded activity" sub="Stored event categories, day by day." flush>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th className="right">Count</th>
                    <th>Source of truth</th>
                  </tr>
                </thead>
                <tbody>
                  <MetricRow label="Jobs discovered" value={metrics.jobsDiscovered} source="job.discovered" />
                  <MetricRow label="Jobs eligible" value={metrics.jobsEligible} source="job.eligible (distinct job)" />
                  <MetricRow label="Jobs ineligible" value={metrics.jobsIneligible} source="job.ineligible (distinct job)" />
                  <MetricRow label="Applications drafted" value={metrics.applicationsDrafted} source="application.drafted" />
                  <MetricRow label="Awaiting approval (raised)" value={metrics.awaitingApproval} source="application.awaiting_approval" />
                  <MetricRow label="Submitted" value={metrics.submitted} source="application.submitted" />
                  <MetricRow label="Submitted by email" value={metrics.emailSubmitted} source="application.submitted · channel=email" />
                  <MetricRow label="Submitted by web" value={metrics.webSubmitted} source="application.submitted · channel=web" />
                  <MetricRow label="Failed" value={metrics.failed} source="application.failed" />
                  <MetricRow label="Uncertain" value={metrics.uncertain} source="application.uncertain" />
                  <MetricRow label="Needs human" value={metrics.needsHuman} source="application.needs_human" />
                  <MetricRow label="Email messages sent" value={metrics.emailsSent} source="email.sent" />
                  <MetricRow label="Email messages failed" value={metrics.emailsFailed} source="email.failed" />
                  <MetricRow label="Sources failed" value={metrics.sourcesFailed} source="source.failed (distinct source)" />
                  <MetricRow label="AI fallbacks" value={metrics.aiFallbacks} source="ai.fallback" />
                  <MetricRow label="Responses recorded" value={metrics.responses} source="response.received" />
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <div>
          <Panel title="Current backlog" sub="Backlog is not date-bound; it is the present state of the pipeline." flush>
            <div className="list">
              <BacklogLink to="/approvals" label="Awaiting approval" value={data.backlog.awaitingApproval} />
              <BacklogLink to="/applications?status=needs_human" label="Needs you" value={data.backlog.needsHuman} />
              <BacklogLink to="/applications?status=queued" label="Queued" value={data.backlog.queued} />
              <BacklogLink to="/applications?status=uncertain" label="Uncertain" value={data.backlog.uncertain} />
              <BacklogLink to="/applications?status=failed" label="Failed" value={data.backlog.failed} />
            </div>
          </Panel>

          <Panel
            title="Digest archive"
            sub={`${plural(data.digests.length, 'stored digest')}`}
            flush
          >
            {data.digests.length === 0 ? (
              <EmptyState
                icon={CalendarCheck}
                title="No digests stored yet"
                desc="Generate one now, or wait for the scheduled evening digest."
                action={
                  <Button size="sm" variant="secondary" onClick={() => generate.mutate(date)} loading={generate.isPending}>
                    <Sparkles /> Generate
                  </Button>
                }
              />
            ) : (
              <div className="list">
                {data.digests.slice(0, 10).map((digest) => (
                  <button
                    key={digest.date}
                    type="button"
                    className="list-row"
                    style={{ textAlign: 'left', background: 'transparent', border: 0, cursor: 'pointer', width: '100%', color: 'inherit' }}
                    onClick={() => setSelectedDate(digest.date)}
                  >
                    <div className="list-row-main">
                      <div className="small strong">{fmtDay(digest.date)}</div>
                      <div className="tiny faint truncate">{digest.headline}</div>
                    </div>
                    <div className="stack" style={{ gap: 2, alignItems: 'flex-end' }}>
                      <Badge tone={digest.metrics.submitted > 0 ? 'success' : 'neutral'}>{digest.metrics.submitted} sent</Badge>
                      <span className="tiny faint">{digest.backlog.awaitingApproval} waiting</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Recent events" sub={isToday ? 'Today’s stored events.' : 'Today’s events; historical event pages follow retention.'}>
            {data.events.length === 0 ? (
              <div className="small muted">No events recorded today.</div>
            ) : (
              <Timeline
                items={data.events.slice(0, 12).map((event) => ({
                  id: event.id,
                  title: event.message,
                  level: event.level === 'info' ? 'info' : event.level === 'warn' ? 'warn' : 'error',
                  meta: (
                    <>
                      <span>{humanizeCategory(event.category)}</span>
                      <span>·</span>
                      <span>{timeAgo(event.ts)}</span>
                    </>
                  )
                }))}
              />
            )}
            <div className="mt-3">
              <Link to="/activity" className="small color-accent inline">
                Open full activity <ArrowRight size={12} />
              </Link>
            </div>
          </Panel>
        </div>
      </div>
    </>
  )
}

function Mini({ label, value, tone }: { label: string; value: number; tone?: 'green' }) {
  return (
    <div className="mini-stat">
      <div className="k">{label}</div>
      <div className="v" style={tone === 'green' ? { color: 'var(--green)' } : undefined}>
        {value}
      </div>
    </div>
  )
}

function MetricRow({ label, value, source }: { label: string; value: number; source: string }) {
  return (
    <tr>
      <td className="cell-title">{label}</td>
      <td className="num right">{value}</td>
      <td className="mono tiny faint">{source}</td>
    </tr>
  )
}

function BacklogLink({ to, label, value }: { to: string; label: string; value: number }) {
  return (
    <Link to={to} className="list-row">
      <span className="list-row-main small">{label}</span>
      <span className="mono small">{value}</span>
      <ArrowRight size={13} className="faint" />
    </Link>
  )
}

function sum(days: { submitted: number; applicationsDrafted: number; jobsDiscovered: number }[], key: 'submitted' | 'applicationsDrafted' | 'jobsDiscovered'): number {
  return days.reduce((total, day) => total + day[key], 0)
}
