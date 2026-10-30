import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Briefcase,
  ChevronRight,
  Download,
  MapPin,
  RefreshCw,
  SearchX,
  SlidersHorizontal,
  Sparkles,
  Timer,
  TrendingUp,
  Users
} from 'lucide-react'
import type { EligibilityVerdict, JobStatus, RemoteType } from '@shared/types'
import { call, exportData, queryKeys } from '../lib/api'
import { useDebounced } from '../lib/hooks'
import {
  country,
  employmentLabels,
  flagEmoji,
  formatNumber,
  jobStatusMeta,
  plural,
  remoteLabels,
  salaryText,
  shortNumber,
  timeAgo,
  verdictMeta
} from '../lib/format'
import {
  Badge,
  Button,
  CountrySelect,
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

interface JobFilters {
  search: string
  verdict: EligibilityVerdict | 'all'
  status: JobStatus | 'all'
  country: string
  sourceId: string
  remoteType: RemoteType | 'all'
  sort: 'score' | 'newest' | 'company'
}

const DEFAULT_FILTERS: JobFilters = {
  search: '',
  verdict: 'all',
  status: 'active',
  country: '',
  sourceId: '',
  remoteType: 'all',
  sort: 'score'
}

function parseFilters(params: URLSearchParams): JobFilters {
  const verdict = params.get('verdict') as EligibilityVerdict | 'all' | null
  const status = params.get('status') as JobStatus | 'all' | null
  const remoteType = params.get('remote') as RemoteType | 'all' | null
  const sort = params.get('sort') as JobFilters['sort'] | null
  return {
    ...DEFAULT_FILTERS,
    verdict: verdict && verdict in verdictMeta ? verdict : 'all',
    status: status && (status === 'all' || status in jobStatusMeta) ? status : 'active',
    country: params.get('country') ?? '',
    sourceId: params.get('source') ?? '',
    remoteType: remoteType && (remoteType === 'all' || remoteType in remoteLabels) ? remoteType : 'all',
    sort: sort && ['score', 'newest', 'company'].includes(sort) ? sort : 'score'
  }
}

export default function Jobs() {
  const [params, setParams] = useSearchParams()
  const [filters, setFilters] = useState<JobFilters>(() => parseFilters(params))
  const [searchText, setSearchText] = useState(filters.search)
  const [offset, setOffset] = useState(0)
  const debouncedSearch = useDebounced(searchText, 280)
  const queryClient = useQueryClient()
  const toast = useToast()

  const applied: JobFilters = { ...filters, search: debouncedSearch }
  const filtersKey = useMemo(() => applied, [applied.search, applied.verdict, applied.status, applied.country, applied.sourceId, applied.remoteType, applied.sort])

  const bootstrap = useQuery({ queryKey: queryKeys.bootstrap, queryFn: () => call('app.bootstrap'), staleTime: 10_000 })
  const dashboard = useQuery({ queryKey: queryKeys.dashboard, queryFn: () => call('app.dashboard'), staleTime: 15_000 })

  const list = useQuery({
    queryKey: [...queryKeys.jobs(filtersKey), offset],
    queryFn: () =>
      call('jobs.list', {
        search: applied.search || undefined,
        verdict: applied.verdict,
        status: applied.status,
        country: applied.country || undefined,
        sourceId: applied.sourceId || undefined,
        remoteType: applied.remoteType,
        onlyActive: false,
        limit: PAGE_SIZE,
        offset,
        sort: applied.sort
      })
  })

  const update = (patch: Partial<JobFilters>) => {
    const next = { ...filters, ...patch }
    setFilters(next)
    setOffset(0)
    const query: Record<string, string> = {}
    if (patch.search !== undefined) setSearchText(next.search)
    if (next.verdict !== 'all') query.verdict = next.verdict
    if (next.status !== 'active') query.status = next.status
    if (next.country) query.country = next.country
    if (next.sourceId) query.source = next.sourceId
    if (next.remoteType !== 'all') query.remote = next.remoteType
    if (next.sort !== 'score') query.sort = next.sort
    setParams(query, { replace: true })
  }

  const reEvaluate = useMutation({
    mutationFn: () => call('jobs.reEvaluateAll'),
    onSuccess: (result) => {
      toast[result.errors > 0 ? 'info' : 'success'](
        `Re-evaluated ${formatNumber(result.evaluated)} job${result.evaluated === 1 ? '' : 's'}${result.errors ? ` · ${plural(result.errors, 'error')}` : ''}.`
      )
      queryClient.invalidateQueries()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const exportJobs = useMutation({
    mutationFn: () => exportData('jobs'),
    onSuccess: (result) => {
      if (result.saved && result.path) toast.success(`Jobs exported to ${result.path}`)
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const stats = dashboard.data?.jobStats
  const sources = bootstrap.data?.sources ?? []
  const items = list.data?.items ?? []
  const total = list.data?.total ?? 0
  const filtersActive =
    Boolean(filters.search) ||
    filters.verdict !== 'all' ||
    filters.status !== 'active' ||
    Boolean(filters.country) ||
    Boolean(filters.sourceId) ||
    filters.remoteType !== 'all'

  return (
    <>
      <PageHeader
        eyebrow="Pipeline"
        title="Discovered jobs"
        desc="Every posting the sources returned, with the eligibility verdict and score computed before any application is created."
        actions={
          <>
            <Button variant="ghost" onClick={() => exportJobs.mutate()} loading={exportJobs.isPending}>
              <Download /> Export
            </Button>
            <Button variant="secondary" onClick={() => reEvaluate.mutate()} loading={reEvaluate.isPending}>
              <Sparkles /> Re-evaluate
            </Button>
            <Link to="/targets">
              <Button variant="primary">
                <RefreshCw /> Scan targets
              </Button>
            </Link>
          </>
        }
      />

      <div className="stat-grid mb-4">
        <StatCard
          label="Active jobs"
          value={stats ? formatNumber(stats.active) : '—'}
          foot={
            <span>
              {stats ? `${formatNumber(stats.discoveredToday)} found today` : 'Reading pipeline'} · {stats ? `${formatNumber(stats.total)} total` : ''}
            </span>
          }
          icon={Briefcase}
        />
        <StatCard
          label="Eligible"
          value={stats ? formatNumber(stats.eligible + stats.eligibleNeedsSponsorship) : '—'}
          tone="success"
          foot={<span>{stats ? `${formatNumber(stats.eligible)} no sponsorship · ${formatNumber(stats.eligibleNeedsSponsorship)} ${stats.eligibleNeedsSponsorship === 1 ? 'needs' : 'need'} sponsorship` : ''}</span>}
          icon={TrendingUp}
        />
        <StatCard
          label="Needs review"
          value={stats ? formatNumber(stats.needsReview) : '—'}
          tone="info"
          foot={<span>Unknown sponsorship or missing evidence</span>}
          icon={SearchX}
        />
        <StatCard
          label="Not eligible"
          value={stats ? formatNumber(stats.ineligible) : '—'}
          tone="danger"
          foot={<span>{stats ? `${plural(stats.duplicates, 'duplicate')} · ${formatNumber(stats.closed)} closed` : ''}</span>}
          icon={Timer}
        />
      </div>

      <Panel flush>
        <div className="panel-head" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div className="toolbar" style={{ flex: 1 }}>
            <SearchInput value={searchText} onChange={(value) => update({ search: value })} placeholder="Search titles, companies, skills" />
            <Select
              value={filters.verdict}
              onChange={(event) => update({ verdict: event.target.value as JobFilters['verdict'] })}
              aria-label="Filter by verdict"
            >
              <option value="all">All verdicts</option>
              <option value="eligible">Eligible</option>
              <option value="eligible_needs_sponsorship_offered">Eligible if sponsored</option>
              <option value="needs_review">Needs review</option>
              <option value="ineligible">Ineligible</option>
            </Select>
            <Select
              value={filters.status}
              onChange={(event) => update({ status: event.target.value as JobFilters['status'] })}
              aria-label="Filter by job status"
            >
              <option value="active">Active</option>
              <option value="all">Any status</option>
              <option value="expired">Expired</option>
              <option value="closed">Closed</option>
              <option value="duplicate">Duplicate</option>
              <option value="removed">Removed</option>
            </Select>
            <div style={{ width: 168 }}>
              <CountrySelect
                value={filters.country || null}
                onChange={(value) => update({ country: value })}
                placeholder="All countries"
              />
            </div>
            <Select
              value={filters.sourceId}
              onChange={(event) => update({ sourceId: event.target.value })}
              aria-label="Filter by source"
            >
              <option value="">All sources</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.label}
                </option>
              ))}
            </Select>
            <Select
              value={filters.remoteType}
              onChange={(event) => update({ remoteType: event.target.value as JobFilters['remoteType'] })}
              aria-label="Filter by work arrangement"
            >
              <option value="all">Any arrangement</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">On-site</option>
              <option value="unknown">Not stated</option>
            </Select>
            <Select
              value={filters.sort}
              onChange={(event) => update({ sort: event.target.value as JobFilters['sort'] })}
              aria-label="Sort jobs"
            >
              <option value="score">Best score</option>
              <option value="newest">Newest</option>
              <option value="company">Company A–Z</option>
            </Select>
            {filtersActive ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilters(DEFAULT_FILTERS)
                  setSearchText('')
                  setOffset(0)
                  setParams({}, { replace: true })
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>
          <span className="small muted" style={{ whiteSpace: 'nowrap' }}>
            <SlidersHorizontal size={12} style={{ verticalAlign: -2 }} /> {formatNumber(total)} result{total === 1 ? '' : 's'}
          </span>
        </div>

        {list.isLoading ? (
          <PageLoading label="Loading jobs" />
        ) : list.error ? (
          <PageError error={list.error} onRetry={() => list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Briefcase}
            title={filtersActive ? 'No jobs match these filters' : 'No jobs discovered yet'}
            desc={
              filtersActive
                ? 'Relax a filter or clear the search to see the full pipeline.'
                : 'Add an enabled target country and run a scan. Postings will appear here with an eligibility verdict.'
            }
            action={
              filtersActive ? (
                <Button variant="secondary" onClick={() => { setFilters(DEFAULT_FILTERS); setSearchText(''); setOffset(0); setParams({}, { replace: true }) }}>
                  Clear filters
                </Button>
              ) : (
                <Link to="/targets">
                  <Button variant="primary">Configure targets</Button>
                </Link>
              )
            }
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table table-clickable">
                <thead>
                  <tr>
                    <th style={{ width: 44 }} />
                    <th>Job</th>
                    <th>Verdict</th>
                    <th>Score</th>
                    <th>Source</th>
                    <th>Found</th>
                    <th>Application</th>
                    <th style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {items.map((job) => {
                    const verdict = job.verdict ? verdictMeta[job.verdict] : { label: 'Not evaluated', tone: 'neutral' as const }
                    const salary = salaryText(job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod)
                    return (
                      <tr key={job.id}>
                        <td>
                          <div className="company-avatar" style={{ width: 32, height: 32, borderRadius: 9, fontSize: 11 }}>
                            {job.company
                              .split(/\s+/)
                              .filter(Boolean)
                              .slice(0, 2)
                              .map((part) => part[0]?.toUpperCase())
                              .join('') || '·'}
                          </div>
                        </td>
                        <td style={{ minWidth: 260 }}>
                          <Link to={`/jobs/${job.id}`} className="cell-title">
                            {job.title}
                          </Link>
                          <div className="cell-sub">
                            {job.company}
                            {job.countryCode ? ` · ${flagEmoji(job.countryCode)} ${country(job.countryCode)}` : job.locationRaw ? ` · ${job.locationRaw}` : ''}
                          </div>
                          <div className="row tiny faint mt-2" style={{ gap: 10 }}>
                            <span className="inline">
                              <MapPin size={10} /> {remoteLabels[job.remoteType]}
                            </span>
                            <span>{employmentLabels[job.employmentType]}</span>
                            {salary ? <span className="mono">{salary}</span> : null}
                          </div>
                        </td>
                        <td>
                          <Badge tone={verdict.tone}>{verdict.label}</Badge>
                          {job.sponsorSignal === 'sponsorship_offered' ? (
                            <div className="tiny color-green mt-2">Sponsorship offered</div>
                          ) : job.sponsorSignal === 'citizenship_or_clearance_required' ? (
                            <div className="tiny color-red mt-2">Citizenship required</div>
                          ) : null}
                        </td>
                        <td>
                          <span className={`mono strong ${job.score !== null && job.score >= 75 ? 'color-green' : job.score !== null && job.score >= 55 ? 'color-accent' : 'muted'}`}>
                            {job.score ?? '—'}
                          </span>
                        </td>
                        <td>
                          <div className="cell-title small" style={{ fontWeight: 500 }}>
                            {job.sourceName}
                          </div>
                          <div className="tiny faint">
                            {job.status === 'active' ? <span className="inline"><span className="status-dot" /> Active</span> : jobStatusMeta[job.status].label}
                          </div>
                        </td>
                        <td className="num muted" style={{ whiteSpace: 'nowrap' }}>
                          {timeAgo(job.firstSeenAt)}
                          <div className="tiny faint">verified {timeAgo(job.lastVerifiedAt)}</div>
                        </td>
                        <td>
                          {job.applicationId ? (
                            <Link to={`/applications/${job.applicationId}`}>
                              <Badge tone={job.applicationStatus === 'submitted' ? 'success' : job.applicationStatus === 'failed' ? 'danger' : 'info'}>
                                {(job.applicationStatus ?? 'draft').replace(/_/g, ' ')}
                              </Badge>
                            </Link>
                          ) : (
                            <span className="muted tiny">—</span>
                          )}
                          {job.hasEmail ? <div className="tiny color-blue mt-2">Email available</div> : null}
                        </td>
                        <td>
                          <Link to={`/jobs/${job.id}`} aria-label={`Open ${job.title}`}>
                            <Button variant="ghost" size="sm" iconOnly>
                              <ChevronRight />
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pagination total={total} limit={PAGE_SIZE} offset={offset} onChange={setOffset} />
          </>
        )}
      </Panel>

      <div className="row tiny faint mt-3" style={{ gap: 16 }}>
        <span className="inline">
          <Users size={12} /> Eligibility is decided only from your nationality, residence, permits, and quoted employer statements.
        </span>
        <span className="inline">
          <Sparkles size={12} /> Scores are deterministic; AI never changes a verdict.
        </span>
      </div>
    </>
  )
}
