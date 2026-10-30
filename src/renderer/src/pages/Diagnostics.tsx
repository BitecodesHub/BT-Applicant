import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Cpu,
  FileText,
  FolderOpen,
  Gauge,
  HardDrive,
  Info,
  ListChecks,
  Mail,
  Plug,
  RefreshCw,
  Server,
  Sparkles,
  Workflow,
  XCircle,
  type LucideIcon
} from 'lucide-react'
import type { BootstrapDTO, DiagnosticsDTO, EventDTO } from '@shared/api'
import type { Tone } from '../lib/format'
import { call, openPath } from '../lib/api'
import { fmtDateTime, formatBytes, humanizeCategory, plural, severityMeta, timeAgo, timeUntil } from '../lib/format'
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
  StatCard,
  StatusDot,
  useToast
} from '../components/ui'

export default function Diagnostics() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const now = useNow(20_000)
  const [reportOpen, setReportOpen] = useState(false)
  const [selectedError, setSelectedError] = useState<EventDTO | null>(null)

  const diagnostics = useQuery({ queryKey: ['diagnostics'], queryFn: () => call('app.diagnostics'), refetchInterval: 20_000 })
  const bootstrap = useQuery({ queryKey: ['bootstrap'], queryFn: () => call('app.bootstrap'), staleTime: 20_000 })

  const checks = useMemo(() => {
    if (!diagnostics.data) return []
    return buildChecks(diagnostics.data, bootstrap.data ?? null, now)
  }, [diagnostics.data, bootstrap.data, now])

  if (diagnostics.isLoading && !diagnostics.data) return <PageLoading label="Running local diagnostics" />
  if (diagnostics.error) return <PageError error={diagnostics.error} onRetry={() => diagnostics.refetch()} />

  const data = diagnostics.data!
  const failing = checks.filter((check) => check.tone === 'danger')
  const warnings = checks.filter((check) => check.tone === 'warn')
  const failingSources = data.sourceHealth.filter((source) => source.enabled && (source.consecutiveFailures > 0 || Boolean(source.lastError)))
  const openCircuits = data.aiProviders.filter((provider) => provider.circuitState !== 'closed')
  const latestBeat = data.heartbeats[0] ?? null
  const report = buildReport(data, checks)

  const openFolder = async () => {
    try {
      await openPath(data.userDataDir)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(report)
      toast.success('Diagnostics report copied to the clipboard.')
    } catch {
      toast.error('The clipboard is unavailable. Select the report text and copy it manually.')
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Local health"
        title="Diagnostics"
        desc="Everything this app knows about its own runtime: database, queue, worker leases, source health, AI circuits, and retained errors. Nothing is sent off this Mac."
        actions={
          <>
            <Button variant="secondary" onClick={() => setReportOpen(true)}>
              <FileText /> Export report
            </Button>
            <Button variant="ghost" iconOnly title="Refresh" onClick={() => queryClient.invalidateQueries({ queryKey: ['diagnostics'] })}>
              <RefreshCw />
            </Button>
          </>
        }
      />

      {failing.length > 0 ? (
        <Notice tone="danger" className="mb-4" icon={XCircle}>
          <strong>{plural(failing.length, 'blocking check')} failed.</strong> {failing.map((check) => check.label).join(' · ')}. The workspace may still store
          data, but the affected pipeline stage will not run until resolved.
        </Notice>
      ) : warnings.length > 0 ? (
        <Notice tone="warn" className="mb-4" icon={AlertTriangle}>
          <strong>{plural(warnings.length, 'check')} need attention.</strong> {warnings.map((check) => check.label).join(' · ')}. These do not stop the
          pipeline by themselves.
        </Notice>
      ) : (
        <Notice tone="success" className="mb-4" icon={CheckCircle2}>
          <strong>All checks passed.</strong> The worker, database, sources, and delivery guardrails are in a healthy state.
        </Notice>
      )}

      <div className="stat-grid mb-4">
        <StatCard label="Database" value={formatBytes(data.dbSizeBytes)} unit="on disk" foot={`Schema version ${data.schemaVersion} · SQLite`} icon={HardDrive} />
        <StatCard
          label="Worker"
          value={data.system.paused ? 'Paused' : data.system.workerRunning ? 'Running' : 'Stopped'}
          foot={latestBeat ? `Heartbeat ${timeAgo(latestBeat.lastSeenAt, now)} · ${data.system.inFlight} in flight` : 'No heartbeat recorded'}
          tone={data.system.paused ? 'warn' : data.system.workerRunning ? 'success' : 'danger'}
          icon={Server}
        />
        <StatCard label="Queue" value={data.queue.pending + data.queue.running} unit="active tasks" foot={`${data.queue.dead} dead · ${data.queue.doneToday} done today`} tone={data.queue.dead > 0 ? 'warn' : 'success'} icon={ListChecks} />
        <StatCard label="Retained errors" value={data.recentErrors.length} unit="events" foot={data.recentErrors[0] ? `Latest ${timeAgo(data.recentErrors[0].ts, now)}` : 'No error-level events stored'} tone={data.recentErrors.length > 0 ? 'danger' : 'success'} icon={AlertTriangle} />
      </div>

      <div className="split-2">
        <div>
          <Panel title="Readiness checklist" sub="Each check reflects stored state, not an assumption." flush>
            <div className="list">
              {checks.map((check) => (
                <div className="list-row" key={check.label} style={{ alignItems: 'flex-start' }}>
                  <CheckIcon tone={check.tone} />
                  <div className="list-row-main">
                    <div className="row wrap" style={{ gap: 8 }}>
                      <span className="small strong">{check.label}</span>
                      <Badge tone={check.tone}>{check.status}</Badge>
                    </div>
                    <div className="tiny faint mt-2" style={{ lineHeight: 1.6 }}>
                      {check.detail}
                    </div>
                  </div>
                  {check.to ? (
                    <Link to={check.to} className="tiny color-accent nowrap">
                      Open
                    </Link>
                  ) : null}
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            title="Source health"
            sub={`${data.sourceHealth.length} source${data.sourceHealth.length === 1 ? '' : 's'} · ${failingSources.length} failing`}
            actions={
              <Link to="/sources">
                <Button size="sm" variant="ghost">
                  Manage sources
                </Button>
              </Link>
            }
            flush
          >
            {data.sourceHealth.length === 0 ? (
              <EmptyState icon={Plug} title="No sources configured" desc="Add a source on the Sources page so discovery has somewhere to look." />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Last success</th>
                      <th>Failures</th>
                      <th>State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sourceHealth.map((source) => {
                      const failingSource = source.consecutiveFailures > 0 || Boolean(source.lastError)
                      return (
                        <tr key={source.id}>
                          <td>
                            <div className="cell-title">{source.label}</div>
                            <div className="cell-sub mono">{source.connector}</div>
                          </td>
                          <td className="small muted nowrap">{source.lastSuccessAt ? timeAgo(source.lastSuccessAt, now) : 'Never'}</td>
                          <td className="mono small">{source.consecutiveFailures}</td>
                          <td>
                            <Badge tone={!source.enabled ? 'neutral' : failingSource ? 'danger' : source.lastSuccessAt ? 'success' : 'warn'}>
                              {!source.enabled ? 'Disabled' : failingSource ? 'Failing' : source.lastSuccessAt ? 'Healthy' : 'Untested'}
                            </Badge>
                            {source.lastError ? <div className="tiny color-red mt-2 truncate" title={source.lastError}>{source.lastError}</div> : null}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel
            title="Recent errors"
            sub="The last error-level events stored locally. Click one for the full payload."
            actions={
              <Link to="/activity">
                <Button size="sm" variant="ghost">
                  Full activity
                </Button>
              </Link>
            }
            flush
          >
            {data.recentErrors.length === 0 ? (
              <EmptyState icon={CheckCircle2} title="No stored errors" desc="Error-level events appear here when a task, source, or delivery fails. Warnings are tracked separately." />
            ) : (
              <div className="list">
                {data.recentErrors.map((error) => (
                  <button
                    key={error.id}
                    type="button"
                    className="list-row"
                    style={{ textAlign: 'left', background: 'transparent', border: 0, width: '100%', color: 'inherit', cursor: 'pointer' }}
                    onClick={() => setSelectedError(error)}
                  >
                    <StatusDot tone="err" />
                    <div className="list-row-main">
                      <div className="small">{error.message}</div>
                      <div className="tiny faint mt-2">
                        {humanizeCategory(error.category)} · {fmtDateTime(error.ts)} · actor {error.actor}
                      </div>
                    </div>
                    <Badge tone={severityMeta[error.level].tone}>{severityMeta[error.level].label}</Badge>
                  </button>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div>
          <Panel
            title="Runtime"
            sub="Version and storage information for this installation."
            actions={
              <Button size="sm" variant="secondary" onClick={openFolder}>
                <FolderOpen /> Data folder
              </Button>
            }
          >
            <KV
              items={[
                { k: 'App version', v: data.system.version },
                { k: 'Platform', v: data.system.platform },
                { k: 'Schema', v: `v${data.schemaVersion}` },
                { k: 'Time zone', v: data.system.timeZone },
                { k: 'Database', v: <span className="mono tiny" style={{ wordBreak: 'break-all' }}>{data.databasePath}</span> },
                { k: 'User data', v: <span className="mono tiny" style={{ wordBreak: 'break-all' }}>{data.userDataDir}</span> },
                ...Object.entries(data.versions)
                  .filter(([key]) => ['electron', 'chrome', 'node', 'v8'].includes(key))
                  .map(([key, value]) => ({ k: key, v: value }))
              ]}
            />
            <div className="divider" />
            <div className="row small muted" style={{ gap: 8 }}>
              <Cpu size={13} /> Local SQLite · no server process, no cloud database.
            </div>
          </Panel>

          <Panel title="Database & queue" sub="State of the durable store.">
            <div className="mini-grid">
              <MiniStat label="Jobs" value={data.counts.jobs} />
              <MiniStat label="Applications" value={data.counts.applications} />
              <MiniStat label="Events today" value={data.counts.eventsToday} />
              <MiniStat label="Pending tasks" value={data.counts.pendingTasks} />
            </div>
            <div className="divider" />
            <KV
              items={[
                { k: 'Database size', v: formatBytes(data.dbSizeBytes) },
                { k: 'Active jobs', v: data.counts.activeJobs },
                { k: 'Awaiting approval', v: data.counts.awaitingApproval },
                { k: 'Needs you', v: data.counts.needsHuman },
                { k: 'Queue pending', v: data.queue.pending },
                { k: 'Queue running', v: data.queue.running },
                { k: 'Dead-letter', v: data.queue.dead },
                { k: 'Next scheduled task', v: data.queue.nextRunAt ? timeUntil(data.queue.nextRunAt, now) : 'None' }
              ]}
            />
            <div className="mt-3">
              <Link to="/queue" className="small color-accent inline">
                Open queue <Workflow size={12} />
              </Link>
            </div>
          </Panel>

          <Panel title="Worker heartbeats" sub="A heartbeat is written while the worker loop is alive." flush>
            {data.heartbeats.length === 0 ? (
              <div className="small muted" style={{ padding: 16 }}>
                No heartbeat recorded. Start the app and wait a few seconds.
              </div>
            ) : (
              <div className="list">
                {data.heartbeats.map((beat) => {
                  const live = now - beat.lastSeenAt < 60_000
                  return (
                    <div className="list-row" key={beat.id}>
                      <StatusDot tone={live ? 'success' : 'warn'} pulse={live} />
                      <div className="list-row-main">
                        <div className="small strong mono">{beat.id}</div>
                        <div className="tiny faint">
                          {beat.status} · current task {beat.currentTaskId ? `#${beat.currentTaskId}` : 'none'} · seen {timeAgo(beat.lastSeenAt, now)}
                        </div>
                      </div>
                      <span className="mono tiny faint">{beat.appVersion ?? '—'}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </Panel>

          <Panel
            title="AI circuits"
            sub={`${plural(data.aiCallsToday, 'call')} today · ${plural(data.aiFallbacksToday, 'fallback')} · mode ${data.system.aiMode}`}
            actions={
              <Link to="/ai">
                <Button size="sm" variant="ghost">
                  Configure
                </Button>
              </Link>
            }
            flush
          >
            {data.aiProviders.length === 0 ? (
              <div className="small muted" style={{ padding: 16 }}>
                No providers in the saved chain.
              </div>
            ) : (
              <div className="list">
                {data.aiProviders.map((provider) => (
                  <div className="list-row" key={provider.id}>
                    <StatusDot
                      tone={provider.circuitState === 'open' ? 'err' : provider.circuitState === 'half_open' ? 'warn' : provider.configured ? 'success' : 'idle'}
                    />
                    <div className="list-row-main">
                      <div className="small strong">{provider.label}</div>
                      <div className="tiny faint">
                        {provider.model || 'model not set'} ·{' '}
                        {provider.lastSuccessAt ? `last success ${timeAgo(provider.lastSuccessAt, now)}` : 'no success yet'}
                        {provider.consecutiveFailures > 0 ? ` · ${plural(provider.consecutiveFailures, 'failure')}` : ''}
                      </div>
                      {provider.lastError ? <div className="tiny color-red truncate">{provider.lastError}</div> : null}
                    </div>
                    <Badge tone={provider.circuitState === 'closed' ? 'success' : provider.circuitState === 'half_open' ? 'warn' : 'danger'}>
                      {provider.circuitState.replace('_', '-')}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
            <div className="pagination">
              <span className="tiny faint inline">
                <Sparkles size={11} /> AI is optional; fallback drafting never blocks.
              </span>
              <span className="spacer" />
              <span className="tiny faint">{plural(openCircuits.length, 'open circuit')}</span>
            </div>
          </Panel>

          <Panel title="Retention & delivery" sub="Stored policy currently in force.">
            <KV
              items={[
                { k: 'Events retained', v: `${data.retention.eventsDays} days` },
                { k: 'Jobs retained', v: `${data.retention.jobsDays} days` },
                { k: 'AI call logs', v: `${data.retention.aiCallsDays} days` },
                { k: 'Outbound adapter', v: data.system.mail.mode === 'smtp' ? 'Live SMTP' : 'Mock outbox' },
                { k: 'Kill switch', v: data.system.mail.killSwitch ? 'Engaged' : 'Off' },
                { k: 'SMTP configured', v: data.system.mail.smtpConfigured ? 'Yes' : 'No' },
                { k: 'SMTP credential', v: data.system.mail.credentialPresent ? 'Present in keychain' : 'Missing' }
              ]}
            />
            <div className="row small muted mt-3" style={{ gap: 8 }}>
              <Mail size={13} /> {data.system.mail.message}
            </div>
            <div className="mt-3">
              <Link to="/automation" className="small color-accent inline">
                Open automation & outbound <Gauge size={12} />
              </Link>
            </div>
          </Panel>

          <Notice tone="info" icon={Info}>
            Diagnostic output contains local file paths but no API keys, SMTP password, candidate profile, or application text. Review the report before sharing
            it.
          </Notice>
        </div>
      </div>

      <Modal
        open={reportOpen}
        onOpenChange={setReportOpen}
        title="Diagnostics report"
        desc="Plain text suitable for a bug report. Review before sharing."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReportOpen(false)}>
              Close
            </Button>
            <Button variant="primary" onClick={copyReport}>
              <Copy /> Copy report
            </Button>
          </>
        }
      >
        <textarea className="textarea mono" readOnly value={report} rows={22} style={{ minHeight: 420 }} aria-label="Diagnostics report" />
      </Modal>

      <Modal
        open={Boolean(selectedError)}
        onOpenChange={(open) => {
          if (!open) setSelectedError(null)
        }}
        title={selectedError ? humanizeCategory(selectedError.category) : 'Error detail'}
        desc={selectedError ? fmtDateTime(selectedError.ts) : undefined}
        size="lg"
        footer={
          <Button variant="ghost" onClick={() => setSelectedError(null)}>
            Close
          </Button>
        }
      >
        {selectedError ? (
          <div className="stack">
            <Notice tone="danger" icon={AlertTriangle}>
              {selectedError.message}
            </Notice>
            <KV
              items={[
                { k: 'Event ID', v: selectedError.id },
                { k: 'Level', v: <Badge tone={severityMeta[selectedError.level].tone}>{severityMeta[selectedError.level].label}</Badge> },
                { k: 'Actor', v: selectedError.actor },
                { k: 'Job', v: selectedError.jobId ?? '—' },
                { k: 'Application', v: selectedError.applicationId ?? '—' },
                { k: 'Source', v: selectedError.sourceId ?? '—' },
                { k: 'Task', v: selectedError.taskId ?? '—' }
              ]}
            />
            {selectedError.detail ? (
              <div>
                <div className="label mb-2">Stored detail</div>
                <pre className="pre">{JSON.stringify(selectedError.detail, null, 2)}</pre>
              </div>
            ) : (
              <div className="small muted">No structured detail was stored with this error.</div>
            )}
          </div>
        ) : null}
      </Modal>
    </>
  )
}

interface Check {
  label: string
  status: string
  detail: string
  tone: 'success' | 'warn' | 'danger' | 'info'
  to?: string
}

function buildChecks(data: DiagnosticsDTO, bootstrap: BootstrapDTO | null, now: number): Check[] {
  const checks: Check[] = []
  const liveWorkers = data.heartbeats.filter((beat) => now - beat.lastSeenAt < 60_000).length

  checks.push({
    label: 'Worker loop',
    status: data.system.paused ? 'Paused' : data.system.workerRunning ? 'Running' : 'Stopped',
    tone: data.system.paused ? 'warn' : data.system.workerRunning && liveWorkers > 0 ? 'success' : data.system.workerRunning ? 'warn' : 'danger',
    detail: data.system.paused
      ? 'Automation is paused. Queued work waits; stored data is unaffected.'
      : data.system.workerRunning
        ? `${plural(liveWorkers, 'live heartbeat')}, ${plural(data.system.inFlight, 'task')} in flight.`
        : 'The worker loop is not running. Restart the desktop app.',
    to: '/queue'
  })

  if (bootstrap) {
    checks.push({
      label: 'Profile readiness',
      status: bootstrap.completeness.readyToApply ? 'Ready' : `${bootstrap.completeness.score}% complete`,
      tone: bootstrap.completeness.readyToApply ? 'success' : bootstrap.completeness.score < 40 ? 'danger' : 'warn',
      detail: bootstrap.completeness.readyToApply
        ? 'Required profile fields are present; eligibility can use them.'
        : bootstrap.completeness.missing.slice(0, 4).join(' · ') || 'Review the profile for missing fields.',
      to: '/profile'
    })
    checks.push({
      label: 'Work authorization',
      status: bootstrap.authorizations.length > 0 ? plural(bootstrap.authorizations.length, 'record') : 'No records',
      tone: bootstrap.authorizations.length > 0 ? 'success' : 'warn',
      detail:
        bootstrap.authorizations.length > 0
          ? 'Citizenship and permit facts are available to the eligibility rules.'
          : 'Without authorization records most foreign postings will be marked needs review.',
      to: '/authorization'
    })
    const enabledTargets = bootstrap.targets.filter((target) => target.enabled)
    checks.push({
      label: 'Discovery target',
      status: enabledTargets.length > 0 ? `${enabledTargets.length} enabled` : 'None enabled',
      tone: enabledTargets.length > 0 ? 'success' : 'danger',
      detail:
        enabledTargets.length > 0
          ? enabledTargets.map((target) => target.countryCode).join(', ')
          : 'Discovery has nowhere to run. Add or enable a target country.',
      to: '/targets'
    })
    checks.push({
      label: 'Resume library',
      status: bootstrap.resumes.length > 0 ? plural(bootstrap.resumes.length, 'file') : 'Empty',
      tone: bootstrap.resumes.length > 0 ? 'success' : 'warn',
      detail: bootstrap.resumes.length > 0 ? 'Application emails can attach a resume.' : 'Email drafts have no attachment until a resume is added.',
      to: '/resumes'
    })
  }

  const enabledSources = data.sourceHealth.filter((source) => source.enabled)
  const failingSources = enabledSources.filter((source) => source.consecutiveFailures > 0 || source.lastError)
  const sourcesUnavailable = enabledSources.length === 0 || (enabledSources.length > 0 && failingSources.length === enabledSources.length)
  checks.push({
    label: 'Source connectivity',
    status:
      enabledSources.length === 0
        ? 'No sources'
        : failingSources.length === 0
          ? 'Healthy'
          : `${failingSources.length} of ${enabledSources.length} failing`,
    tone: enabledSources.length === 0 ? 'warn' : failingSources.length === 0 ? 'success' : sourcesUnavailable ? 'danger' : 'warn',
    detail:
      enabledSources.length === 0
        ? 'No enabled source can provide jobs.'
        : failingSources.length > 0
          ? `${failingSources.map((source) => source.label).join(' · ')}${sourcesUnavailable ? '' : '; other enabled sources still deliver.'}`
          : `${plural(enabledSources.length, 'enabled source')} with no recorded failure.`,
    to: '/sources'
  })

  checks.push({
    label: 'Delivery guardrails',
    status: data.system.mail.killSwitch ? 'Kill switch on' : data.system.mail.mode === 'smtp' ? 'Live SMTP' : 'Mock outbox',
    tone: data.system.mail.killSwitch || data.system.mail.mode === 'mock' ? 'success' : 'warn',
    detail: data.system.mail.message,
    to: '/automation'
  })

  checks.push({
    label: 'AI overlay',
    status: data.system.aiMode === 'enhanced' ? (openProviderCount(data) > 0 ? 'Available' : 'No provider') : data.system.aiMode === 'off' ? 'Off' : 'Simulated outage',
    tone: data.system.aiMode === 'off' ? 'success' : openProviderCount(data) > 0 ? 'success' : 'info',
    detail: `${plural(data.aiCallsToday, 'call')} today, ${plural(data.aiFallbacksToday, 'deterministic fallback')}. AI failures never stop the pipeline.`,
    to: '/ai'
  })

  checks.push({
    label: 'Dead-letter tasks',
    status: data.queue.dead > 0 ? `${data.queue.dead} dead` : 'Clear',
    tone: data.queue.dead > 0 ? 'danger' : 'success',
    detail: data.queue.dead > 0 ? 'Inspect errors in the queue and retry after fixing the cause.' : 'No task has exhausted its retry budget.',
    to: '/queue'
  })

  checks.push({
    label: 'Stored errors',
    status: data.recentErrors.length > 0 ? `${data.recentErrors.length} recent` : 'None',
    tone: data.recentErrors.length > 0 ? 'warn' : 'success',
    detail: data.recentErrors[0]
      ? `Latest: ${data.recentErrors[0].message}`
      : 'No error-level events are currently retained.',
    to: '/activity'
  })

  return checks
}

function openProviderCount(data: DiagnosticsDTO): number {
  return data.aiProviders.filter((provider) => provider.configured && provider.circuitState !== 'open').length
}

function buildReport(data: DiagnosticsDTO, checks: Check[]): string {
  const lines: string[] = []
  lines.push('BT Applicant diagnostics report')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push(`App version: ${data.system.version}`)
  lines.push(`Platform: ${data.system.platform} · time zone ${data.system.timeZone}`)
  lines.push(`Schema: v${data.schemaVersion} · database ${formatBytes(data.dbSizeBytes)}`)
  lines.push(`Paths: ${data.databasePath} | ${data.userDataDir}`)
  lines.push('')
  lines.push('READINESS')
  for (const check of checks) lines.push(`- [${check.status}] ${check.label}: ${check.detail}`)
  lines.push('')
  lines.push('RUNTIME')
  lines.push(`Worker running: ${data.system.workerRunning} · paused: ${data.system.paused} · in flight: ${data.system.inFlight}`)
  lines.push(`Queue: ${data.queue.pending} pending, ${data.queue.running} running, ${data.queue.dead} dead, ${data.queue.doneToday} done today`)
  lines.push(`Counts: ${data.counts.jobs} jobs, ${data.counts.applications} applications, ${data.counts.eventsToday} events today`)
  lines.push(`Mail: ${data.system.mail.message}`)
  lines.push(`AI: mode ${data.system.aiMode}, ${data.aiCallsToday} calls today, ${data.aiFallbacksToday} fallbacks`)
  for (const provider of data.aiProviders) {
    lines.push(`  - ${provider.label}: ${provider.configured ? 'configured' : 'not configured'}, circuit ${provider.circuitState}${provider.lastError ? `, error ${provider.lastError}` : ''}`)
  }
  const failingSources = data.sourceHealth.filter((source) => source.consecutiveFailures > 0 || source.lastError)
  lines.push(`Sources failing: ${failingSources.length}`)
  for (const source of failingSources) lines.push(`  - ${source.label}: ${source.lastError ?? 'unknown error'}`)
  lines.push('')
  lines.push(`RECENT ERRORS (${data.recentErrors.length})`)
  for (const error of data.recentErrors.slice(0, 15)) {
    lines.push(`- ${new Date(error.ts).toISOString()} [${error.category}] ${error.message}`)
  }
  lines.push('')
  lines.push('VERSIONS')
  for (const [key, value] of Object.entries(data.versions)) lines.push(`${key}: ${value}`)
  return lines.join('\n')
}

function CheckIcon({ tone }: { tone: Tone }) {
  const Icon: LucideIcon = tone === 'success' ? CheckCircle2 : tone === 'danger' ? XCircle : tone === 'warn' ? AlertTriangle : Info
  const color = tone === 'success' ? 'var(--green)' : tone === 'danger' ? 'var(--red)' : tone === 'warn' ? 'var(--yellow)' : 'var(--blue)'
  return <Icon size={15} style={{ color, marginTop: 2, flex: 'none' }} />
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="mini-stat">
      <div className="k">{label}</div>
      <div className="v">{value}</div>
    </div>
  )
}
