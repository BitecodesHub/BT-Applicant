import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Briefcase,
  Building2,
  CalendarDays,
  ExternalLink,
  FileText,
  Flag,
  Globe2,
  Link2,
  Mail,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Timer
} from 'lucide-react'
import { call, openExternal, queryKeys } from '../lib/api'
import {
  applicationStatusMeta,
  authorizationBasisLabels,
  channelMeta,
  countryWithCode,
  employmentLabels,
  flagEmoji,
  fmtDateTime,
  humanize,
  jobStatusMeta,
  remoteLabels,
  salaryText,
  sponsorMeta,
  timeAgo,
  verdictMeta
} from '../lib/format'
import {
  Badge,
  Button,
  EmptyState,
  KV,
  Meter,
  PageError,
  PageHeader,
  PageLoading,
  Panel,
  ScoreRing,
  Timeline,
  useToast
} from '../components/ui'
import { useNow } from '../lib/hooks'

export default function JobDetail() {
  const { id } = useParams()
  const jobId = Number(id)
  const queryClient = useQueryClient()
  const toast = useToast()
  const now = useNow(60_000)

  const bundle = useQuery({
    queryKey: queryKeys.job(jobId),
    queryFn: () => call('jobs.get', { id: jobId }),
    enabled: Number.isFinite(jobId) && jobId > 0,
    refetchInterval: 30_000
  })

  const evaluate = useMutation({
    mutationFn: () => call('jobs.evaluate', { id: jobId }),
    onSuccess: (result) => {
      const meta = verdictMeta[result.verdict]
      toast[result.verdict === 'ineligible' ? 'info' : 'success'](`${meta.label} · score ${result.score}. ${result.reason}`)
      queryClient.invalidateQueries({ queryKey: queryKeys.job(jobId) })
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
      queryClient.invalidateQueries({ queryKey: ['applications'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  if (!Number.isFinite(jobId) || jobId <= 0) {
    return <EmptyState title="Invalid job link" desc="The job identifier in the address is not valid." action={<Link to="/jobs"><Button>Back to jobs</Button></Link>} />
  }

  if (bundle.isLoading) return <PageLoading label="Loading job" />
  if (bundle.error) return <PageError error={bundle.error} onRetry={() => bundle.refetch()} />
  if (!bundle.data) return <EmptyState title="Job not found" desc="This posting is no longer in the local database." />

  const { job, evaluation, application, relatedApplications, events, emailEvidence } = bundle.data
  const verdict = evaluation ? verdictMeta[evaluation.verdict] : null
  const salary = salaryText(job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod)
  const applyTarget = job.applyUrl ?? job.url
  const scoreParts = evaluation
    ? [
        { label: 'Title match', value: evaluation.scoreBreakdown.titleMatch, max: 30 },
        { label: 'Skill match', value: evaluation.scoreBreakdown.skillMatch, max: 30 },
        { label: 'Location fit', value: evaluation.scoreBreakdown.locationFit, max: 15 },
        { label: 'Salary fit', value: evaluation.scoreBreakdown.salaryFit, max: 10 },
        { label: 'Freshness', value: evaluation.scoreBreakdown.freshness, max: 10 },
        { label: 'Source quality', value: evaluation.scoreBreakdown.sourceQuality, max: 5 }
      ]
    : []

  return (
    <>
      <div className="row mb-3" style={{ gap: 10 }}>
        <Link to="/jobs">
          <Button variant="ghost" size="sm">
            <ArrowLeft /> Jobs
          </Button>
        </Link>
        <span className="faint">/</span>
        <span className="small muted truncate">{job.title}</span>
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
              <Badge tone={jobStatusMeta[job.status].tone}>{jobStatusMeta[job.status].label}</Badge>
              {verdict ? <Badge tone={verdict.tone} icon={ShieldCheck}>{verdict.label}</Badge> : <Badge>Not evaluated</Badge>}
              <Badge tone={sponsorMeta[job.sponsorSignal].tone}>{sponsorMeta[job.sponsorSignal].label}</Badge>
              {job.applicationEmail ? <Badge tone="info" icon={Mail}>Email route</Badge> : null}
            </div>
            <h1 className="job-title">{job.title}</h1>
            <div className="job-meta">
              <span><Building2 /> {job.company}</span>
              <span><MapPin /> {job.countryCode ? `${flagEmoji(job.countryCode)} ${countryWithCode(job.countryCode)}` : job.locationRaw ?? 'Location not stated'}</span>
              <span><Globe2 /> {remoteLabels[job.remoteType]}</span>
              <span><Briefcase /> {employmentLabels[job.employmentType]}</span>
              {salary ? <span className="mono color-green">{salary}</span> : null}
              <span><CalendarDays /> {job.postedAt ? `Posted ${timeAgo(job.postedAt, now)}` : `Found ${timeAgo(job.firstSeenAt, now)}`}</span>
            </div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <Button variant="ghost" size="sm" onClick={() => openExternal(job.url)}>
              <ExternalLink /> Original
            </Button>
            <Button variant="secondary" size="sm" onClick={() => evaluate.mutate()} loading={evaluate.isPending}>
              <Sparkles /> {evaluation ? 'Evaluate again' : 'Evaluate'}
            </Button>
            {application ? (
              <Link to={`/applications/${application.id}`}>
                <Button variant="primary" size="sm">
                  <FileText /> Open application
                </Button>
              </Link>
            ) : (
              <Button variant="primary" size="sm" onClick={() => evaluate.mutate()} loading={evaluate.isPending}>
                <Flag /> Check & queue
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="detail-grid">
        <div className="stack-lg">
          <Panel
            title="Eligibility assessment"
            sub="Deterministic rules over citizenship, residence, permits, and the employer's own wording."
            actions={evaluation ? <Badge tone={verdict?.tone ?? 'neutral'}>{verdict?.label}</Badge> : <Badge>Not evaluated</Badge>}
          >
            {!evaluation ? (
              <div className="empty" style={{ padding: '28px 12px' }}>
                <div className="empty-title">No assessment yet</div>
                <div className="empty-desc">
                  Run an evaluation to compute the verdict against your work-authorization profile. Unknown evidence never counts as eligible.
                </div>
                <Button variant="primary" size="sm" className="mt-2" onClick={() => evaluate.mutate()} loading={evaluate.isPending}>
                  <Sparkles /> Evaluate this job
                </Button>
              </div>
            ) : (
              <>
                <div className="row" style={{ gap: 18, alignItems: 'flex-start' }}>
                  <ScoreRing score={evaluation.score} size={72} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row wrap" style={{ gap: 6 }}>
                      <Badge tone={verdict?.tone}>{verdict?.label}</Badge>
                      <Badge tone="neutral">{authorizationBasisLabels[evaluation.authorizationBasis ?? 'none'] ?? 'No basis'}</Badge>
                      {evaluation.requiresSponsorship ? <Badge tone="warn">Sponsorship required</Badge> : <Badge tone="success">No sponsorship needed</Badge>}
                      {evaluation.matchedBloc ? <Badge tone="info">{evaluation.matchedBloc}</Badge> : null}
                    </div>
                    <p className="small muted mt-2" style={{ lineHeight: 1.6 }}>
                      Scored {evaluation.score}/100 with the current profile. Profile fingerprint {evaluation.profileHash?.slice(0, 10) ?? '—'} · evaluated{' '}
                      {timeAgo(evaluation.evaluatedAt, now)}.
                    </p>
                  </div>
                </div>

                <div className="divider" />

                <div className="stack">
                  {evaluation.reasons.length === 0 ? (
                    <div className="small muted">No rule explanations were recorded.</div>
                  ) : (
                    evaluation.reasons.map((reason, index) => (
                      <div className="list-row" key={`${reason.code}-${index}`} style={{ padding: '9px 0', alignItems: 'flex-start' }}>
                        <Badge tone={verdict?.tone ?? 'neutral'}>{humanize(reason.code)}</Badge>
                        <div className="list-row-main">
                          <div className="small">{reason.message}</div>
                          {reason.evidence ? <div className="evidence mt-2">{reason.evidence}</div> : null}
                          {reason.ruleId ? <div className="tiny faint mono mt-2">Rule {reason.ruleId}</div> : null}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {scoreParts.length > 0 ? (
                  <>
                    <div className="divider" />
                    <div className="row-between mb-3">
                      <span className="small strong">Score components</span>
                      <span className="tiny faint">Penalties {evaluation.scoreBreakdown.penalties}</span>
                    </div>
                    <div className="stack">
                      {scoreParts.map((part) => (
                        <div key={part.label}>
                          <div className="row-between tiny mb-2">
                            <span className="muted">{part.label}</span>
                            <span className="mono">
                              {part.value}/{part.max}
                            </span>
                          </div>
                          <Meter value={Math.max(0, part.value)} max={part.max} />
                        </div>
                      ))}
                    </div>
                    {evaluation.scoreBreakdown.notes.length > 0 ? (
                      <ul className="small muted mt-3" style={{ paddingLeft: 18, lineHeight: 1.7 }}>
                        {evaluation.scoreBreakdown.notes.map((note, index) => (
                          <li key={index}>{note}</li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                ) : null}
              </>
            )}
          </Panel>

          {job.workAuthStatements.length > 0 || emailEvidence ? (
            <Panel title="Quoted employer wording" sub="Evidence is copied from the posting — nothing is inferred from a job title.">
              <div className="stack">
                {job.workAuthStatements.map((statement, index) => (
                  <div className="evidence" key={index}>
                    “{statement.quote}”
                    <span className="evidence-source mono">Rule {statement.ruleId} · offset {statement.offset}</span>
                  </div>
                ))}
                {emailEvidence ? (
                  <div>
                    <div className="row-between mb-2">
                      <span className="small strong">Application email</span>
                      <Badge tone="info">{emailEvidence.email}</Badge>
                    </div>
                    {emailEvidence.evidence ? <div className="evidence">“{emailEvidence.evidence}”</div> : <div className="small muted">Email was discovered from structured data on the posting page.</div>}
                  </div>
                ) : null}
              </div>
            </Panel>
          ) : null}

          <Panel
            title="Job description"
            sub={`${job.sourceName} · external id ${job.externalId}`}
            actions={
              <Button variant="ghost" size="sm" onClick={() => openExternal(job.url)}>
                <ExternalLink /> Open posting
              </Button>
            }
          >
            {job.requirements.length > 0 ? (
              <div className="mb-4">
                <div className="small strong mb-2">Requirements</div>
                <ul className="small muted" style={{ paddingLeft: 18, lineHeight: 1.7 }}>
                  {job.requirements.map((requirement, index) => (
                    <li key={index}>{requirement}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {job.skills.length > 0 ? (
              <div className="chip-list mb-4">
                {job.skills.map((skill) => (
                  <span className="chip" key={skill}>
                    {skill}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="prose">{job.descriptionText || 'The source did not provide a description.'}</div>
          </Panel>

          <Panel title="History for this posting" flush>
            <div className="panel-body">
              <Timeline
                items={events.map((event) => ({
                  id: event.id,
                  title: event.message,
                  meta: (
                    <span>
                      {event.category} · {fmtDateTime(event.ts)} · {event.actor}
                      {event.detail ? ` · ${JSON.stringify(event.detail)}` : ''}
                    </span>
                  ),
                  level: event.level,
                  ts: event.ts
                }))}
              />
            </div>
          </Panel>
        </div>

        <div className="stack-lg">
          <Panel title="Application" sub={application ? 'An application already exists for this posting.' : 'Nothing has been sent for this job.'}>
            {application ? (
              <div className="stack">
                <div className="row-between">
                  <Badge tone={applicationStatusMeta[application.status].tone}>{applicationStatusMeta[application.status].label}</Badge>
                  <span className="tiny faint">attempt {application.attempt}</span>
                </div>
                <div className="small muted">
                  {channelMeta[application.channel].label} · created {timeAgo(application.createdAt, now)}
                </div>
                {application.subject ? <div className="small strong">{application.subject}</div> : null}
                {application.recipient ? (
                  <div className="tiny mono faint truncate">{application.recipient}</div>
                ) : application.applyUrl ? (
                  <div className="tiny mono faint truncate">{application.applyUrl}</div>
                ) : null}
                {application.lastError ? <div className="small color-red">{application.lastError}</div> : null}
                <Link to={`/applications/${application.id}`}>
                  <Button variant="primary" className="full">
                    <FileText /> Open application
                  </Button>
                </Link>
                {relatedApplications.length > 1 ? (
                  <div>
                    <div className="tiny faint mb-2">Other attempts</div>
                    <div className="stack">
                      {relatedApplications
                        .filter((item) => item.id !== application.id)
                        .map((item) => (
                          <Link to={`/applications/${item.id}`} key={item.id} className="row-between small">
                            <span>#{item.id} · {item.status.replace(/_/g, ' ')}</span>
                            <span className="tiny faint">{fmtDateTime(item.updatedAt)}</span>
                          </Link>
                        ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="stack">
                <div className="small muted" style={{ lineHeight: 1.6 }}>
                  Evaluating this posting may create a draft if it is eligible, scores at or above your minimum, and your profile is complete.
                </div>
                <Button variant="primary" onClick={() => evaluate.mutate()} loading={evaluate.isPending}>
                  <Sparkles /> Evaluate and prepare
                </Button>
                <div className="tiny faint">Nothing is ever sent without approval while approval is required in Automation settings.</div>
              </div>
            )}
          </Panel>

          <Panel title="Application destination">
            <KV
              items={[
                {
                  k: 'Apply URL',
                  v: job.applyUrl ? (
                    <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 0, height: 'auto' }} onClick={() => openExternal(job.applyUrl!)}>
                      <span className="truncate" style={{ maxWidth: 190 }}>{job.applyUrl}</span> <ExternalLink size={11} />
                    </button>
                  ) : (
                    <span className="muted">Not provided</span>
                  )
                },
                {
                  k: 'Email',
                  v: job.applicationEmail ? (
                    <span className="mono tiny">{job.applicationEmail}</span>
                  ) : (
                    <span className="muted">Not found</span>
                  )
                },
                {
                  k: 'Instructions',
                  v: job.applicationInstructions ? <span className="small">{job.applicationInstructions}</span> : <span className="muted">—</span>
                }
              ]}
            />
            <div className="tiny faint mt-3" style={{ lineHeight: 1.5 }}>
              Emails are only used when the posting itself publishes them. Addresses are never guessed.
            </div>
          </Panel>

          <Panel title="Sponsorship evidence">
            {job.sponsorEvidence ? (
              <div className="stack">
                <Badge tone={sponsorMeta[job.sponsorEvidence.signal].tone}>{sponsorMeta[job.sponsorEvidence.signal].label}</Badge>
                {job.sponsorEvidence.quote ? <div className="evidence">“{job.sponsorEvidence.quote}”</div> : <div className="small muted">No direct quote was captured.</div>}
                <div className="tiny faint">
                  Source: {job.sponsorEvidence.source}
                  {job.sponsorEvidence.model ? ` · ${job.sponsorEvidence.model}` : ''}
                  {job.sponsorEvidence.confidence !== undefined ? ` · confidence ${Math.round(job.sponsorEvidence.confidence * 100)}%` : ''}
                  {job.sponsorEvidence.ruleId ? ` · rule ${job.sponsorEvidence.ruleId}` : ''}
                </div>
              </div>
            ) : (
              <div className="small muted">No sponsorship signal was detected in the posting text.</div>
            )}
          </Panel>

          <Panel title="Provenance">
            <KV
              items={[
                { k: 'Source', v: job.sourceName },
                { k: 'Source ID', v: <span className="mono tiny">{job.sourceId}</span> },
                { k: 'External ID', v: <span className="mono tiny">{job.externalId}</span> },
                { k: 'First seen', v: fmtDateTime(job.firstSeenAt) },
                { k: 'Last verified', v: `${fmtDateTime(job.lastVerifiedAt)} (${timeAgo(job.lastVerifiedAt, now)})` },
                { k: 'Posted', v: job.postedAt ? fmtDateTime(job.postedAt) : 'Not stated' },
                { k: 'Expires', v: job.expiresAt ? fmtDateTime(job.expiresAt) : 'Not stated' },
                { k: 'Dedupe key', v: <span className="mono tiny">{job.dedupeKey.slice(0, 24)}…</span> },
                { k: 'Fingerprint', v: <span className="mono tiny">{job.fingerprint.slice(0, 16)}…</span> }
              ]}
            />
          </Panel>

          <Panel title="Policy check">
            <div className="stack small muted" style={{ lineHeight: 1.6 }}>
              <div className="inline"><BadgeCheck size={14} className="color-green" /> Verdicts rely on nationality, residence, permits, and quoted employer text.</div>
              <div className="inline"><AlertTriangle size={14} className="color-yellow" /> An unknown sponsorship signal can never produce an eligible verdict.</div>
              <div className="inline"><Timer size={14} className="color-blue" /> Postings are re-verified on every discovery scan.</div>
              <div className="inline"><Link2 size={14} className="color-accent" /> Original posting: <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 0 }} onClick={() => openExternal(job.url)}>open</button></div>
            </div>
          </Panel>
        </div>
      </div>
    </>
  )
}
