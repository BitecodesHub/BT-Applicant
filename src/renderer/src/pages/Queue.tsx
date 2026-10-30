import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  Clock,
  HeartPulse,
  ListChecks,
  Play,
  RotateCcw,
  Sparkles,
  XCircle
} from 'lucide-react'
import type { ScheduleDTO, TaskDTO } from '@shared/api'
import type { TaskStatus, TaskType } from '@shared/types'
import { call } from '../lib/api'
import {
  durationText,
  fmtDateTime,
  formatCron,
  humanize,
  plural,
  taskStatusMeta,
  taskTypeLabels,
  timeAgo,
  timeUntil
} from '../lib/format'
import { useNow } from '../lib/hooks'
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
  Panel,
  Select,
  StatCard,
  StatusDot,
  Tabs,
  useToast
} from '../components/ui'

type Tab = 'tasks' | 'schedules' | 'workers'

const TASK_STATUSES: (TaskStatus | 'all')[] = ['all', 'pending', 'running', 'done', 'failed', 'dead', 'cancelled']

const MANUAL_TASKS: { type: TaskType; label: string; desc: string }[] = [
  { type: 'application.reconcile', label: 'Reconcile deliveries', desc: 'Requeue queued applications and mark stale sending attempts uncertain.' },
  { type: 'metrics.rollup', label: 'Roll up metrics', desc: 'Recompute today’s stored counts for the dashboard and daily report.' },
  { type: 'digest.generate', label: 'Generate digest', desc: 'Build today’s digest summary and store it in the archive.' },
  { type: 'maintenance.retention', label: 'Run retention cleanup', desc: 'Prune events, jobs, and AI call logs past their configured retention windows.' },
  { type: 'maintenance.reaper', label: 'Reap expired leases', desc: 'Requeue or dead-letter tasks whose worker lease expired.' }
]

export default function Queue() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const now = useNow(15_000)
  const [tab, setTab] = useState<Tab>('tasks')
  const [status, setStatus] = useState<TaskStatus | 'all'>('all')
  const [type, setType] = useState<TaskType | 'all'>('all')
  const [detail, setDetail] = useState<TaskDTO | null>(null)

  const query = useQuery({ queryKey: ['queue'], queryFn: () => call('tasks.page'), refetchInterval: 8_000 })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['queue'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    void queryClient.invalidateQueries({ queryKey: ['daily-report'] })
  }

  const retry = useMutation({
    mutationFn: (id: number) => call('tasks.retry', { id }),
    onSuccess: () => {
      toast.success('Task re-queued for another attempt.')
      refresh()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const cancel = useMutation({
    mutationFn: (id: number) => call('tasks.cancel', { id }),
    onSuccess: () => {
      toast.info('Cancellation recorded. A running task stops at its next checkpoint.')
      refresh()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const run = useMutation({
    mutationFn: (taskType: TaskType) => call('tasks.run', { type: taskType, payload: {} }),
    onSuccess: (_result, taskType) => {
      toast.success(`${taskTypeLabels[taskType]} queued.`)
      refresh()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const toggleSchedule = useMutation({
    mutationFn: (input: { id: number; enabled: boolean }) => call('tasks.scheduleToggle', input),
    onSuccess: (_schedules, input) => {
      toast.info(input.enabled ? 'Schedule enabled.' : 'Schedule disabled.')
      refresh()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const data = query.data
  const tasks = useMemo(() => {
    if (!data) return []
    return data.tasks.filter((task) => (status === 'all' || task.status === status) && (type === 'all' || task.type === type))
  }, [data, status, type])

  if (query.isLoading && !data) return <PageLoading label="Reading the durable queue" />
  if (query.error) return <PageError error={query.error} onRetry={() => query.refetch()} />

  const queue = data!.queue
  const schedules = data!.schedules
  const heartbeats = data!.heartbeats
  const liveWorkers = heartbeats.filter((beat) => now - beat.lastSeenAt < 60_000).length
  const activeSchedules = schedules.filter((schedule) => schedule.enabled).length
  const attention = tasks.filter((task) => task.status === 'dead' || task.status === 'failed').length
  const nextRun = (() => {
    const pending = queue.nextRunAt
    const scheduled = schedules
      .filter((schedule) => schedule.enabled && schedule.nextRunAt)
      .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))[0] ?? null
    if (pending && (!scheduled?.nextRunAt || pending <= scheduled.nextRunAt)) return { at: pending, label: 'Queued task' }
    if (scheduled?.nextRunAt) return { at: scheduled.nextRunAt, label: `Schedule · ${taskTypeLabels[scheduled.taskType]}` }
    return null
  })()

  return (
    <>
      <PageHeader
        eyebrow="Durable queue"
        title="Queue"
        desc="Every unit of work is a stored task with a lease, attempts, and an idempotency key. Nothing lives only in memory, so an interrupted scan or delivery can be recovered without duplication."
        actions={
          <Button variant="secondary" onClick={() => query.refetch()} loading={query.isFetching}>
            <RotateCcw /> Refresh
          </Button>
        }
      />

      {queue.dead > 0 ? (
        <Notice tone="danger" className="mb-4" icon={AlertTriangle}>
          <strong>{plural(queue.dead, 'task')} in the dead-letter queue.</strong> Inspect the error, fix the underlying cause, then retry. Dead tasks are never
          silently dropped.
        </Notice>
      ) : null}

      <div className="stat-grid mb-4">
        <StatCard label="Pending" value={queue.pending} unit={queue.pending === 1 ? 'task' : 'tasks'} foot={queue.oldestPendingAt ? `Oldest scheduled ${timeAgo(queue.oldestPendingAt, now)}` : 'Queue is empty'} icon={ListChecks} />
        <StatCard label="Running" value={queue.running} unit="in flight" foot={`${liveWorkers} live worker${liveWorkers === 1 ? '' : 's'}`} tone={queue.running > 0 ? 'info' : 'neutral'} icon={Activity} />
        <StatCard label="Completed today" value={queue.doneToday} unit={queue.doneToday === 1 ? 'task' : 'tasks'} foot={`${attention} visible failure${attention === 1 ? '' : 's'} in this view`} tone="success" icon={Sparkles} />
        <StatCard
          label="Next run"
          value={nextRun ? timeUntil(nextRun.at, now) : 'None'}
          foot={nextRun ? `${nextRun.label} · ${fmtDateTime(nextRun.at)}` : 'Nothing queued or scheduled'}
          tone={nextRun ? 'accent' : 'neutral'}
          icon={CalendarClock}
        />
      </div>

      <Tabs
        options={[
          { value: 'tasks', label: 'Tasks', count: data!.tasks.length },
          { value: 'schedules', label: 'Schedules', count: schedules.length },
          { value: 'workers', label: 'Workers', count: heartbeats.length }
        ]}
        value={tab}
        onChange={(value) => setTab(value)}
      />

      {tab === 'tasks' ? (
        <div className="split-2 mt-3">
          <div>
            <Panel
              title="Task ledger"
              sub="Most recently created tasks first. Showing up to 250 records."
              actions={
                <div className="row" style={{ gap: 6 }}>
                  <Select value={status} onChange={(event) => setStatus(event.target.value as TaskStatus | 'all')} style={{ width: 132 }}>
                    {TASK_STATUSES.map((item) => (
                      <option key={item} value={item}>
                        {item === 'all' ? 'All statuses' : taskStatusMeta[item].label}
                      </option>
                    ))}
                  </Select>
                  <Select value={type} onChange={(event) => setType(event.target.value as TaskType | 'all')} style={{ width: 190 }}>
                    <option value="all">All task types</option>
                    {(Object.keys(taskTypeLabels) as TaskType[]).map((item) => (
                      <option key={item} value={item}>
                        {taskTypeLabels[item]}
                      </option>
                    ))}
                  </Select>
                </div>
              }
              flush
            >
              {tasks.length === 0 ? (
                <EmptyState
                  icon={ListChecks}
                  title={data!.tasks.length === 0 ? 'No tasks recorded yet' : 'No task matches these filters'}
                  desc={
                    data!.tasks.length === 0
                      ? 'Scheduled scans, drafts, dispatches, and maintenance tasks appear here as the worker claims them.'
                      : 'Change the status or type filter to see other queued work.'
                  }
                />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Task</th>
                        <th>Status</th>
                        <th>Scheduled</th>
                        <th>Attempts</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.map((task) => {
                        const meta = taskStatusMeta[task.status]
                        const retryable = task.status === 'dead' || task.status === 'failed' || task.status === 'cancelled'
                        const cancellable = task.status === 'pending' || task.status === 'running'
                        return (
                          <tr key={task.id} style={{ cursor: 'pointer' }} onClick={() => setDetail(task)}>
                            <td>
                              <div className="cell-title">
                                <span className="mono faint">#{task.id}</span> {taskTypeLabels[task.type]}
                              </div>
                              <div className="cell-sub">
                                {Object.keys(task.payload).length > 0 ? plural(Object.keys(task.payload).length, 'payload field') : 'No payload'}
                                {task.lastError ? ` · ${task.lastError.slice(0, 80)}` : ''}
                              </div>
                            </td>
                            <td>
                              <Badge tone={meta.tone}>{meta.label}</Badge>
                              {task.cancelRequested ? <div className="tiny color-yellow mt-2">Cancel requested</div> : null}
                            </td>
                            <td className="mono small muted nowrap">{timeUntil(task.runAt, now)}</td>
                            <td className="mono small">
                              {task.attempts}/{task.maxAttempts}
                            </td>
                            <td>
                              <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }} onClick={(event) => event.stopPropagation()}>
                                {retryable ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    iconOnly
                                    aria-label="Retry task"
                                    title="Retry task"
                                    onClick={() => retry.mutate(task.id)}
                                    loading={retry.isPending && retry.variables === task.id}
                                  >
                                    <RotateCcw />
                                  </Button>
                                ) : null}
                                {cancellable ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    iconOnly
                                    aria-label="Cancel task"
                                    title="Cancel task"
                                    onClick={() => cancel.mutate(task.id)}
                                    loading={cancel.isPending && cancel.variables === task.id}
                                  >
                                    <XCircle />
                                  </Button>
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
            </Panel>

            <Panel title="Manual actions" sub="Enqueue a maintenance or reporting task at high priority. Nothing here sends an application.">
              <div className="stack">
                {MANUAL_TASKS.map((item) => (
                  <div key={item.type} className="row-between" style={{ gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="small strong">{item.label}</div>
                      <div className="tiny faint mt-2">{item.desc}</div>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => run.mutate(item.type)}
                      loading={run.isPending && run.variables === item.type}
                      disabled={run.isPending}
                      style={{ flex: 'none' }}
                    >
                      <Play /> Run now
                    </Button>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <div>
            <Panel title="Queue health" sub="Derived from stored task rows.">
              <div className="stack">
                <Row label="Pending" value={queue.pending} />
                <Row label="Running" value={queue.running} />
                <Row label="Done today" value={queue.doneToday} />
                <Row label="Dead-letter" value={queue.dead} danger={queue.dead > 0} />
                <Row label="Cancelled" value={queue.cancelled} />
                <div className="divider" />
                <div className="row-between">
                  <span className="small muted">Oldest pending</span>
                  <span className="mono small">{queue.oldestPendingAt ? timeAgo(queue.oldestPendingAt, now) : '—'}</span>
                </div>
                <div className="row-between">
                  <span className="small muted">Next pending task</span>
                  <span className="mono small">{queue.nextRunAt ? timeUntil(queue.nextRunAt, now) : '—'}</span>
                </div>
                <div className="row-between">
                  <span className="small muted">Worker loop</span>
                  <span className="small inline">
                    <StatusDot tone={liveWorkers > 0 ? 'success' : 'warn'} pulse={liveWorkers > 0} />
                    {liveWorkers > 0 ? 'Heartbeat live' : 'No recent heartbeat'}
                  </span>
                </div>
              </div>
            </Panel>

            <Panel title="How recovery works" sub="Durable by construction, not by hope.">
              <div className="stack small muted" style={{ lineHeight: 1.65 }}>
                <div className="row" style={{ alignItems: 'flex-start', gap: 9 }}>
                  <Clock size={14} className="color-green" style={{ marginTop: 2, flex: 'none' }} />
                  <span>Tasks are claimed atomically with a lease. A crashed worker’s lease expires and the task is requeued by the reaper.</span>
                </div>
                <div className="row" style={{ alignItems: 'flex-start', gap: 9 }}>
                  <RotateCcw size={14} className="color-green" style={{ marginTop: 2, flex: 'none' }} />
                  <span>Retries use exponential backoff with jitter. After the maximum attempts the task becomes dead-letter and stays visible.</span>
                </div>
                <div className="row" style={{ alignItems: 'flex-start', gap: 9 }}>
                  <ListChecks size={14} className="color-green" style={{ marginTop: 2, flex: 'none' }} />
                  <span>Idempotency keys prevent a retried task from creating a second application or a second delivery attempt.</span>
                </div>
                <div className="row" style={{ alignItems: 'flex-start', gap: 9 }}>
                  <HeartPulse size={14} className="color-green" style={{ marginTop: 2, flex: 'none' }} />
                  <span>Startup recovery requeues interrupted work only when the attempt budget allows; otherwise it is marked dead for inspection.</span>
                </div>
              </div>
            </Panel>

            <Notice tone="info">
              Pausing automation stops the worker from claiming new work. It does not delete queued tasks; resuming continues where the queue left off.
            </Notice>
          </div>
        </div>
      ) : null}

      {tab === 'schedules' ? (
        <div className="split-2 mt-3">
          <Panel
            title="Recurring schedules"
            sub={`${activeSchedules} enabled of ${schedules.length}. Cron expressions are evaluated in each schedule’s time zone.`}
            flush
          >
            {schedules.length === 0 ? (
              <EmptyState
                icon={CalendarClock}
                title="No schedules yet"
                desc="Enable a target country or add one to create discovery schedules. Digest and maintenance schedules are created by the app."
              />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Schedule</th>
                      <th>Cadence</th>
                      <th>Next run</th>
                      <th>Last result</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {schedules.map((schedule) => (
                      <ScheduleRow
                        key={schedule.id}
                        schedule={schedule}
                        now={now}
                        busy={toggleSchedule.isPending && toggleSchedule.variables?.id === schedule.id}
                        onToggle={(enabled) => toggleSchedule.mutate({ id: schedule.id, enabled })}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <div>
            <Panel title="Schedule windows" sub="Local time zone, human-readable cadence." flush>
              <div className="list">
                {schedules.map((schedule) => (
                  <div className="list-row" key={schedule.id}>
                    <StatusDot tone={schedule.enabled ? 'success' : 'idle'} />
                    <div className="list-row-main">
                      <div className="small strong">{taskTypeLabels[schedule.taskType]}</div>
                      <div className="tiny faint">
                        {formatCron(schedule.cron)} · {schedule.timezone}
                      </div>
                    </div>
                    <span className="mono tiny faint">{schedule.nextRunAt ? fmtDateTime(schedule.nextRunAt) : '—'}</span>
                  </div>
                ))}
                {schedules.length === 0 ? <div className="small muted" style={{ padding: 16 }}>No schedules registered.</div> : null}
              </div>
            </Panel>
            <Notice tone="info">
              Schedules enqueue ordinary tasks; they do not execute work inside the scheduler. If the app was closed at the scheduled moment, the task runs the
              next time the worker starts.
            </Notice>
          </div>
        </div>
      ) : null}

      {tab === 'workers' ? (
        <div className="split-2 mt-3">
          <Panel title="Worker heartbeats" sub="A worker writes a heartbeat while it is alive and while it holds a task." flush>
            {heartbeats.length === 0 ? (
              <EmptyState icon={HeartPulse} title="No heartbeat recorded" desc="Start the desktop app and the worker loop will register here within a few seconds." />
            ) : (
              <div className="list">
                {heartbeats.map((beat) => {
                  const live = now - beat.lastSeenAt < 60_000
                  return (
                    <div className="list-row" key={beat.id} style={{ alignItems: 'flex-start' }}>
                      <StatusDot tone={live ? 'success' : 'warn'} pulse={live} />
                      <div className="list-row-main">
                        <div className="row wrap" style={{ gap: 8 }}>
                          <span className="small strong mono">{beat.id}</span>
                          <Badge tone={live ? 'success' : 'warn'}>{live ? 'Live' : 'Stale'}</Badge>
                          <Badge tone="neutral">{beat.status}</Badge>
                        </div>
                        <div className="tiny faint mt-2" style={{ lineHeight: 1.6 }}>
                          Started {fmtDateTime(beat.startedAt)} · last seen {timeAgo(beat.lastSeenAt, now)}
                          <br />
                          Current task {beat.currentTaskId ? `#${beat.currentTaskId}` : 'none'} · version {beat.appVersion ?? 'unknown'}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Panel>
          <Panel title="Interpreting heartbeats" sub="What the worker guarantees.">
            <div className="stack small muted" style={{ lineHeight: 1.65 }}>
              <p>
                A live heartbeat does not mean work is flowing; it means the loop is running and able to claim tasks. Check <em>Pending</em> and <em>Running</em> on
                the tasks tab to see actual throughput.
              </p>
              <p>
                A stale heartbeat with a paused workspace is expected after closing the window. A stale heartbeat while the app is open indicates the worker loop
                stopped and should be investigated from Diagnostics.
              </p>
              <p>Only one desktop instance owns a worker. Duplicate launches share the database but not the lease, so a task cannot be claimed twice.</p>
            </div>
          </Panel>
        </div>
      ) : null}

      <Modal
        open={Boolean(detail)}
        onOpenChange={(open) => {
          if (!open) setDetail(null)
        }}
        title={detail ? `${taskTypeLabels[detail.type]} · #${detail.id}` : 'Task'}
        desc={detail ? `Created ${fmtDateTime(detail.createdAt)} · status ${taskStatusMeta[detail.status].label}` : undefined}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDetail(null)}>
              Close
            </Button>
            {detail && (detail.status === 'dead' || detail.status === 'failed' || detail.status === 'cancelled') ? (
              <Button variant="secondary" onClick={() => retry.mutate(detail.id)} loading={retry.isPending}>
                <RotateCcw /> Retry task
              </Button>
            ) : null}
          </>
        }
      >
        {detail ? (
          <div className="stack">
            <KV
              items={[
                { k: 'Status', v: <Badge tone={taskStatusMeta[detail.status].tone}>{taskStatusMeta[detail.status].label}</Badge> },
                { k: 'Priority', v: detail.priority },
                { k: 'Attempts', v: `${detail.attempts} of ${detail.maxAttempts}` },
                { k: 'Scheduled for', v: fmtDateTime(detail.runAt) },
                { k: 'Lease owner', v: detail.leaseOwner ?? '—' },
                { k: 'Lease expires', v: detail.leaseExpiresAt ? fmtDateTime(detail.leaseExpiresAt) : '—' },
                { k: 'Idempotency key', v: <span className="mono tiny">{detail.idempotencyKey ?? '—'}</span> },
                { k: 'Completed', v: detail.completedAt ? fmtDateTime(detail.completedAt) : '—' },
                { k: 'Duration so far', v: durationText((detail.completedAt ?? Date.now()) - detail.createdAt) }
              ]}
            />
            {detail.lastError ? (
              <Notice tone="danger" icon={AlertTriangle}>
                <strong>Last error</strong>
                <pre className="pre mt-2" style={{ whiteSpace: 'pre-wrap' }}>
                  {detail.lastError}
                </pre>
              </Notice>
            ) : null}
            <div>
              <div className="label mb-2">Payload</div>
              <pre className="pre">{JSON.stringify(detail.payload, null, 2)}</pre>
            </div>
            {detail.result ? (
              <div>
                <div className="label mb-2">Result</div>
                <pre className="pre">{JSON.stringify(detail.result, null, 2)}</pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  )
}

function Row({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="row-between">
      <span className="small muted">{label}</span>
      <span className={danger ? 'mono small color-red' : 'mono small'}>{value}</span>
    </div>
  )
}

function ScheduleRow({
  schedule,
  now,
  busy,
  onToggle
}: {
  schedule: ScheduleDTO
  now: number
  busy: boolean
  onToggle: (enabled: boolean) => void
}) {
  return (
    <tr>
      <td>
        <div className="cell-title">{taskTypeLabels[schedule.taskType]}</div>
        <div className="cell-sub mono">{schedule.key}</div>
      </td>
      <td>
        <div className="small">{formatCron(schedule.cron)}</div>
        <div className="cell-sub mono">{schedule.timezone}</div>
      </td>
      <td>
        <div className="small nowrap">{schedule.enabled ? (schedule.nextRunAt ? timeUntil(schedule.nextRunAt, now) : 'Not scheduled') : 'Disabled'}</div>
        <div className="cell-sub">{schedule.nextRunAt ? fmtDateTime(schedule.nextRunAt) : '—'}</div>
      </td>
      <td>
        <div className="small">{schedule.lastRunAt ? timeAgo(schedule.lastRunAt, now) : 'Never'}</div>
        <div className="cell-sub truncate" title={schedule.lastResult ?? undefined}>
          {schedule.lastResult ? humanize(schedule.lastResult) : '—'}
        </div>
      </td>
      <td>
        <Button size="sm" variant={schedule.enabled ? 'ghost' : 'secondary'} onClick={() => onToggle(!schedule.enabled)} loading={busy}>
          {schedule.enabled ? <XCircle /> : <Play />}
          {schedule.enabled ? 'Disable' : 'Enable'}
        </Button>
      </td>
    </tr>
  )
}
