import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  BellRing,
  Briefcase,
  CalendarCheck,
  CircleAlert,
  Inbox,
  RefreshCw,
  Sparkles,
  Timer,
  Workflow
} from 'lucide-react'
import type { DailyMetricsSnapshot } from '@shared/types'
import { call } from '../lib/api'
import { machineName } from '../lib/platform'
import {
  applicationStatusMeta,
  channelMeta,
  fmtWeekday,
  humanizeCategory,
  plural,
  shortNumber,
  timeAgo,
  timeUntil,
  verdictMeta
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
  ScoreRing,
  StatCard,
  StatusDot,
  Timeline,
  useToast
} from '../components/ui'

export default function Dashboard() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()

  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: () => call('app.dashboard'), refetchInterval: 20_000 })
  const bootstrap = useQuery({ queryKey: ['bootstrap'], queryFn: () => call('app.bootstrap'), staleTime: 30_000 })

  const scan = useMutation({
    mutationFn: async () => {
      const targets = (bootstrap.data?.targets ?? []).filter((target) => target.enabled)
      for (const target of targets) await call('targets.poll', { id: target.id })
      return targets.length
    },
    onSuccess: (count) => {
      toast[count > 0 ? 'success' : 'error'](count > 0 ? `Queued ${plural(count, 'discovery scan')}.` : 'No enabled target country yet.')
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['queue'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const digest = useMutation({
    mutationFn: () => call('tasks.run', { type: 'digest.generate', payload: {} }),
    onSuccess: () => {
      toast.success('Daily digest queued for generation.')
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['daily-report'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  if (dashboard.isLoading && !dashboard.data) return <PageLoading label="Reading today’s ledger" />
  if (dashboard.error) return <PageError error={dashboard.error} onRetry={() => dashboard.refetch()} />
  const data = dashboard.data!
  const profile = bootstrap.data?.profile
  const firstName = profile?.fullName?.trim().split(/\s+/)[0] ?? ''
  const enabledTargets = (bootstrap.data?.targets ?? []).filter((target) => target.enabled)
  const readyToApply = bootstrap.data?.completeness.readyToApply ?? false
  const completeness = bootstrap.data?.completeness
  const mail = data.system.mail

  return (
    <>
      <PageHeader
        eyebrow="Autopilot · local workspace"
        title={firstName ? `${greeting()}, ${firstName}.` : 'Your desk is ready.'}
        desc={`Discovery, eligibility, and drafting run on ${machineName}. Every number below comes from stored records — nothing is estimated.`}
        actions={
          <>
            <Link to="/daily">
              <Button variant="secondary">
                <CalendarCheck /> Daily report
              </Button>
            </Link>
            <Button variant="primary" onClick={() => scan.mutate()} loading={scan.isPending} disabled={enabledTargets.length === 0}>
              <RefreshCw /> Scan now
            </Button>
          </>
        }
      />

      {data.system.paused ? (
        <Notice tone="warn" className="mb-4">
          <strong>Automation is paused.</strong> New drafts and deliveries will not start until you resume from the top bar. Stored jobs and reports remain
          available.
        </Notice>
      ) : null}
      {!data.system.paused && enabledTargets.length === 0 ? (
        <Notice tone="accent" className="mb-4">
          <strong>No enabled target country.</strong> Discovery has nowhere to run. <Link className="color-accent" to="/targets">Add a target</Link> or enable an
          existing one.
        </Notice>
      ) : null}
      {!readyToApply && completeness ? (
        <Notice tone={completeness.score < 40 ? 'danger' : 'info'} className="mb-4">
          <strong>Profile is {completeness.score}% complete.</strong> {completeness.missing.slice(0, 3).join(' · ') || 'Review your details before applications are drafted.'}{' '}
          <Link className="color-accent" to="/profile">
            Open profile
          </Link>
        </Notice>
      ) : null}

      <div className="stat-grid mb-4">
        <Link to="/applications?status=submitted" style={{ display: 'block' }}>
          <StatCard
            label="Applied today"
            value={data.digest.metrics.submitted}
            unit={data.digest.metrics.submitted === 1 ? 'application' : 'applications'}
            foot={`${data.digest.metrics.emailSubmitted} email · ${data.digest.metrics.webSubmitted} web · ${plural(data.digest.metrics.responses, 'response')}`}
            spark={data.metrics7.map((day) => day.submitted)}
            tone="success"
            icon={Inbox}
          />
        </Link>
        <Link to="/approvals" style={{ display: 'block' }}>
          <StatCard
            label="Awaiting approval"
            value={data.digest.backlog.awaitingApproval}
            unit={data.digest.backlog.awaitingApproval === 1 ? 'draft' : 'drafts'}
            foot={data.digest.backlog.awaitingApproval > 0 ? 'Review before anything is sent' : 'Nothing is waiting on you'}
            spark={data.metrics7.map((day) => day.awaitingApproval)}
            tone="warn"
            icon={BellRing}
          />
        </Link>
        <Link to="/applications?status=needs_human" style={{ display: 'block' }}>
          <StatCard
            label="Needs you"
            value={data.digest.backlog.needsHuman}
            unit="blocked"
            foot={`${plural(data.jobStats.needsReview, 'job')} awaiting eligibility review`}
            spark={data.metrics7.map((day) => day.needsHuman)}
            tone="purple"
            icon={Workflow}
          />
        </Link>
        <Link to="/jobs" style={{ display: 'block' }}>
          <StatCard
            label="Discovered today"
            value={data.jobStats.discoveredToday}
            unit={data.jobStats.discoveredToday === 1 ? 'job' : 'jobs'}
            foot={`${data.jobStats.eligible + data.jobStats.eligibleNeedsSponsorship} eligible active · ${data.jobStats.eligibleNeedsSponsorship} ${data.jobStats.eligibleNeedsSponsorship === 1 ? 'needs' : 'need'} sponsorship`}
            spark={data.metrics7.map((day) => day.jobsDiscovered)}
            tone="accent"
            icon={Briefcase}
          />
        </Link>
      </div>

      <div className="split-2">
        <div>
          <Panel
            title="Throughput · last 7 days"
            sub="Solid bars are submitted applications; faint bars are drafted applications that have not been sent."
            actions={
              <Link to="/daily">
                <Button size="sm" variant="ghost">
                  Full ledger <ArrowRight />
                </Button>
              </Link>
            }
          >
            <Bars
              items={data.metrics7.map((day) => ({
                label: fmtWeekday(day.date),
                value: day.submitted,
                soft: day.applicationsDrafted,
                title: `${day.date}: ${day.submitted} submitted, ${day.applicationsDrafted} drafted, ${day.jobsDiscovered} discovered`
              }))}
            />
            <div className="row mt-3 small muted wrap" style={{ gap: 14 }}>
              <span className="inline">
                <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--accent)', display: 'inline-block' }} /> Submitted
              </span>
              <span className="inline">
                <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--panel-3)', display: 'inline-block' }} /> Drafted
              </span>
              <span className="spacer" />
              <span className="mono">
                {weekTotal(data.metrics7, 'submitted')} submitted · {weekTotal(data.metrics7, 'applicationsDrafted')} drafted ·{' '}
                {weekTotal(data.metrics7, 'jobsDiscovered')} discovered
              </span>
            </div>
          </Panel>

          <Panel
            title="Today at a glance"
            sub={data.digest.headline}
            actions={
              <Button size="sm" variant="ghost" onClick={() => digest.mutate()} loading={digest.isPending}>
                <Sparkles /> Generate digest
              </Button>
            }
          >
            <div className="mini-grid">
              <MiniStat label="Discovered" value={data.digest.metrics.jobsDiscovered} />
              <MiniStat label="Eligible" value={data.digest.metrics.jobsEligible} tone="green" />
              <MiniStat label="Drafted" value={data.digest.metrics.applicationsDrafted} />
              <MiniStat label="Submitted" value={data.digest.metrics.submitted} tone="green" />
              <MiniStat label="Awaiting approval" value={data.digest.backlog.awaitingApproval} tone="yellow" />
              <MiniStat label="Needs you" value={data.digest.backlog.needsHuman} tone="purple" />
              <MiniStat label="Failed" value={data.digest.metrics.failed} tone="red" />
              <MiniStat label="AI fallbacks" value={data.digest.metrics.aiFallbacks} tone="yellow" />
            </div>
            <div className="row-between mt-4 small muted wrap">
              <span>Outbox: {mail.message}</span>
              <Link className="color-accent" to="/automation">
                Delivery settings
              </Link>
            </div>
          </Panel>

          <Panel
            title="Recent applications"
            sub="The most recently updated records, newest first."
            actions={
              <Link to="/applications">
                <Button size="sm" variant="ghost">
                  All applications <ArrowRight />
                </Button>
              </Link>
            }
            flush
          >
            {data.recentApplications.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title="No applications yet"
                desc="Eligible jobs are drafted automatically once your profile, authorization records, targets, and resume are ready."
                action={
                  <Link to="/jobs">
                    <Button size="sm" variant="secondary">
                      Browse jobs
                    </Button>
                  </Link>
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="table table-clickable">
                  <thead>
                    <tr>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Channel</th>
                      <th>Score</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentApplications.map((item) => {
                      const status = applicationStatusMeta[item.status]
                      const channel = channelMeta[item.channel]
                      return (
                        <tr key={item.id} onClick={() => navigate(`/applications/${item.id}`)}>
                          <td>
                            <div className="cell-title">{item.jobTitle}</div>
                            <div className="cell-sub">
                              {item.company} · {item.countryCode ?? 'location unknown'}
                            </div>
                          </td>
                          <td>
                            <Badge tone={status.tone}>{status.label}</Badge>
                          </td>
                          <td>
                            <Badge tone={channel.tone}>{channel.label}</Badge>
                          </td>
                          <td>
                            <div className="row" style={{ gap: 8 }}>
                              <ScoreRing score={item.score} size={30} />
                              <span className="mono small muted">{item.verdict ? verdictMeta[item.verdict].label : '—'}</span>
                            </div>
                          </td>
                          <td className="mono small muted nowrap" title={new Date(item.updatedAt).toLocaleString()}>
                            {timeAgo(item.updatedAt)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        <div>
          <Panel title="Backlog" sub="Current work that is not finished." flush>
            <div className="list">
              <BacklogRow to="/approvals" label="Awaiting approval" value={data.digest.backlog.awaitingApproval} tone="warn" />
              <BacklogRow to="/applications?status=needs_human" label="Needs you" value={data.digest.backlog.needsHuman} tone="purple" />
              <BacklogRow to="/applications?status=queued" label="Queued for delivery" value={data.digest.backlog.queued} tone="info" />
              <BacklogRow to="/applications?status=uncertain" label="Uncertain delivery" value={data.digest.backlog.uncertain} tone="warn" />
              <BacklogRow to="/applications?status=failed" label="Failed" value={data.digest.backlog.failed} tone="danger" />
              <BacklogRow to="/queue" label="Queue tasks" value={data.queue.pending + data.queue.running} tone="neutral" />
            </div>
            <div className="pagination">
              <span>
                {data.queue.dead > 0 ? <span className="color-red">{plural(data.queue.dead, 'dead-letter task')}</span> : 'No dead-letter tasks'}
              </span>
              <span className="spacer" />
              <Link to="/queue" className="color-accent">
                Queue
              </Link>
            </div>
          </Panel>

          <Panel title="Digest attention" sub={`Daily summary for ${data.digest.date}`}>
            {data.digest.attention.length === 0 ? (
              <div className="row small muted">
                <StatusDot tone="success" /> Nothing needs your attention.
              </div>
            ) : (
              <div className="stack">
                {data.digest.attention.map((item) => (
                  <div className="row small" key={item} style={{ alignItems: 'flex-start' }}>
                    <CircleAlert size={14} className="color-yellow" style={{ marginTop: 2, flex: 'none' }} />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            )}
            {data.digest.highlights.length > 0 ? (
              <>
                <div className="divider" />
                <div className="stack">
                  {data.digest.highlights.map((item) => (
                    <div className="small muted" key={item}>
                      {item}
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </Panel>

          <Panel
            title="Source health"
            sub={`${data.sources.filter((source) => source.enabled).length} enabled of ${data.sources.length}`}
            actions={
              <Link to="/sources">
                <Button size="sm" variant="ghost">
                  Manage
                </Button>
              </Link>
            }
            flush
          >
            <div className="list">
              {data.sources.slice(0, 6).map((source) => {
                const failing = source.consecutiveFailures > 0
                return (
                  <div className="list-row" key={source.id}>
                    <StatusDot tone={!source.enabled ? 'idle' : failing ? 'err' : source.lastSuccessAt ? 'success' : 'warn'} />
                    <div className="list-row-main">
                      <div className="small strong truncate">{source.label}</div>
                      <div className="tiny faint">
                        {source.lastSuccessAt ? `Last success ${timeAgo(source.lastSuccessAt)}` : 'Never fetched'}
                        {source.lastItemCount !== null ? ` · ${source.lastItemCount} items` : ''}
                      </div>
                    </div>
                    {failing ? <Badge tone="danger">{source.consecutiveFailures} fail</Badge> : null}
                  </div>
                )
              })}
            </div>
          </Panel>
        </div>
      </div>

      <div className="split-2 mt-4">
        <Panel
          title="Recent activity"
          sub="Worker and system events as recorded locally."
          actions={
            <Link to="/activity">
              <Button size="sm" variant="ghost">
                Open activity <ArrowRight />
              </Button>
            </Link>
          }
        >
          <Timeline
            items={data.recentEvents.map((event) => ({
              id: event.id,
              title: event.message,
              level: event.level === 'info' ? 'info' : event.level === 'warn' ? 'warn' : 'error',
              meta: (
                <>
                  <span>{humanizeCategory(event.category)}</span>
                  <span>·</span>
                  <span>{timeAgo(event.ts)}</span>
                  <span>·</span>
                  <span className="mono">{event.actor}</span>
                </>
              )
            }))}
          />
        </Panel>

        <Panel title="System" sub="Local runtime state.">
          <div className="mini-grid">
            <MiniStat label="Active jobs" value={data.jobStats.active} />
            <MiniStat label="Ineligible" value={data.jobStats.ineligible} />
            <MiniStat label="Needs review" value={data.jobStats.needsReview} tone="yellow" />
            <MiniStat label="Duplicates" value={data.jobStats.duplicates} />
          </div>
          <div className="divider" />
          <div className="stack small">
            <div className="row-between">
              <span className="muted inline">
                <Timer size={13} /> Worker
              </span>
              <span className="inline">
                <StatusDot tone={data.system.workerRunning && !data.system.paused ? 'success' : 'warn'} />{' '}
                {data.system.paused ? 'Paused' : data.system.workerRunning ? `${data.system.inFlight} in flight` : 'Stopped'}
              </span>
            </div>
            <div className="row-between">
              <span className="muted inline">
                <Workflow size={13} /> Queue
              </span>
              <span className="mono">
                {data.queue.pending} pending · {data.queue.doneToday} done today
              </span>
            </div>
            <div className="row-between">
              <span className="muted">Next scheduled task</span>
              <span className="mono">{timeUntil(data.queue.nextRunAt)}</span>
            </div>
            <div className="row-between">
              <span className="muted">AI mode</span>
              <span>{data.aiProviders.length === 0 ? 'No providers' : data.system.aiMode}</span>
            </div>
            <div className="row-between">
              <span className="muted">Discoveries today</span>
              <span className="mono">{shortNumber(data.jobStats.discoveredToday)}</span>
            </div>
          </div>
        </Panel>
      </div>
    </>
  )
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone?: 'green' | 'yellow' | 'red' | 'purple' }) {
  const color = tone === 'green' ? 'var(--green)' : tone === 'yellow' ? 'var(--yellow)' : tone === 'red' ? 'var(--red)' : tone === 'purple' ? 'var(--purple)' : undefined
  return (
    <div className="mini-stat">
      <div className="k">{label}</div>
      <div className="v" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  )
}

function BacklogRow({ to, label, value, tone }: { to: string; label: string; value: number; tone: 'warn' | 'purple' | 'info' | 'danger' | 'neutral' }) {
  return (
    <Link to={to} className="list-row">
      <span className="list-row-main small">{label}</span>
      <Badge tone={tone}>{value}</Badge>
      <ArrowRight size={13} className="faint" />
    </Link>
  )
}

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function weekTotal(days: DailyMetricsSnapshot[], key: keyof DailyMetricsSnapshot): number {
  return days.reduce((sum, day) => {
    const value = day[key]
    return sum + (typeof value === 'number' ? value : 0)
  }, 0)
}
