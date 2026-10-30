import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CalendarClock,
  Clock,
  Globe2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2
} from 'lucide-react'
import type { TargetCountryDTO } from '@shared/api'
import { call, queryKeys } from '../lib/api'
import { country, employmentLabels, flagEmoji, formatCron, plural, timeAgo } from '../lib/format'
import {
  Badge,
  Button,
  ChipEditor,
  ConfirmDialog,
  CountrySelect,
  EmptyState,
  Field,
  Input,
  Modal,
  Notice,
  PageError,
  PageHeader,
  PageLoading,
  Panel,
  Select,
  Switch,
  useToast
} from '../components/ui'

const EMPLOYMENT_OPTIONS = ['full_time', 'part_time', 'contract', 'internship', 'temporary'] as const
const REMOTE_OPTIONS: { value: TargetCountryDTO['remotePreference']; label: string }[] = [
  { value: 'any', label: 'Any arrangement' },
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'On-site' }
]
const TITLE_SUGGESTIONS = ['DevOps Engineer', 'Platform Engineer', 'Site Reliability Engineer', 'Cloud Engineer', 'Infrastructure Engineer', 'Software Engineer']
const SENIORITY_SUGGESTIONS = ['junior', 'mid', 'senior', 'staff', 'lead', 'principal', 'director']
const SCHEDULE_PRESETS = [
  { label: 'Every weekday at 08:00', cron: '0 8 * * 1-5' },
  { label: 'Every day at 08:00', cron: '0 8 * * *' },
  { label: 'Every 6 hours', cron: '0 */6 * * *' },
  { label: 'Every 30 minutes', cron: '*/30 * * * *' }
]

export default function Targets() {
  const [editor, setEditor] = useState<TargetCountryDTO | 'new' | null>(null)
  const [deleting, setDeleting] = useState<TargetCountryDTO | null>(null)
  const queryClient = useQueryClient()
  const toast = useToast()

  const bootstrap = useQuery({ queryKey: queryKeys.bootstrap, queryFn: () => call('app.bootstrap'), staleTime: 10_000 })
  const targetsQuery = useQuery({ queryKey: queryKeys.targets, queryFn: () => call('targets.list') })
  const dashboard = useQuery({ queryKey: queryKeys.dashboard, queryFn: () => call('app.dashboard'), staleTime: 15_000 })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.targets })
    queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap })
    queryClient.invalidateQueries({ queryKey: ['queue'] })
    queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const toggle = useMutation({
    mutationFn: (input: { id: number; enabled: boolean }) => call('targets.toggle', input),
    onSuccess: refresh,
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const poll = useMutation({
    mutationFn: (id: number) => call('targets.poll', { id }),
    onSuccess: () => {
      toast.success('Discovery scan queued for this country.')
      queryClient.invalidateQueries({ queryKey: ['queue'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const remove = useMutation({
    mutationFn: (id: number) => call('targets.delete', { id }),
    onSuccess: () => {
      setDeleting(null)
      toast.info('Target removed. Discovered jobs and applications are kept.')
      refresh()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const targets = targetsQuery.data ?? []
  const sources = bootstrap.data?.sources ?? []
  const timeZone = bootstrap.data?.system.timeZone ?? 'UTC'
  const enabled = targets.filter((target) => target.enabled).length
  const discoveredToday = dashboard.data?.jobStats.discoveredToday ?? 0

  return (
    <>
      <PageHeader
        eyebrow="Pipeline"
        title="Target countries"
        desc="Where you want to work, which roles you want, and when the discovery scan should run. Each target has its own schedule and source scope."
        actions={
          <Button variant="primary" onClick={() => setEditor('new')}>
            <Plus /> Add target
          </Button>
        }
      />

      <div className="stat-grid mb-4">
        <div className="stat-card">
          <div className="stat-label">Targets</div>
          <div className="stat-value">{targets.length}</div>
          <div className="stat-foot">{enabled} enabled</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Discovered today</div>
          <div className="stat-value">{discoveredToday}</div>
          <div className="stat-foot">Across every enabled target</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Sources in use</div>
          <div className="stat-value">{sources.filter((source) => source.enabled).length}</div>
          <div className="stat-foot">Enabled connectors</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Time zone</div>
          <div className="stat-value" style={{ fontSize: 16, letterSpacing: 0, paddingTop: 6 }}>{timeZone}</div>
          <div className="stat-foot">Schedules are evaluated in this zone</div>
        </div>
      </div>

      <Notice tone="info" className="mb-4">
        <span>
          Work authorization is evaluated per job country before anything is drafted. Add a target only for countries where you are eligible or where
          the employer explicitly offers sponsorship.
        </span>
      </Notice>

      {targetsQuery.isLoading ? (
        <Panel><PageLoading label="Loading targets" /></Panel>
      ) : targetsQuery.error ? (
        <Panel><PageError error={targetsQuery.error} onRetry={() => targetsQuery.refetch()} /></Panel>
      ) : targets.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Globe2}
            title="No target country yet"
            desc="Pick a country, add the role titles you want, and the worker will start scanning on a schedule."
            action={<Button variant="primary" onClick={() => setEditor('new')}><Plus /> Add target</Button>}
          />
        </Panel>
      ) : (
        <div className="grid cols-2">
          {targets.map((target) => {
            const targetSources = sources.filter((source) => target.sources.includes(source.id))
            const schedule = formatCron(target.scheduleCron)
            return (
              <Panel key={target.id} className={target.enabled ? undefined : 'muted'}>
                <div className="row-between mb-3" style={{ alignItems: 'flex-start' }}>
                  <div>
                    <div className="row" style={{ gap: 8 }}>
                      <span style={{ fontSize: 20 }}>{flagEmoji(target.countryCode)}</span>
                      <div>
                        <div className="panel-title">{country(target.countryCode)}</div>
                        <div className="tiny faint mono">{target.countryCode}</div>
                      </div>
                      {target.enabled ? <Badge tone="success">Scanning</Badge> : <Badge>Paused</Badge>}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 4 }}>
                    <Switch
                      checked={target.enabled}
                      onCheckedChange={(value) => toggle.mutate({ id: target.id, enabled: value })}
                      label={`Enable ${country(target.countryCode)}`}
                    />
                    <Button variant="ghost" size="sm" iconOnly onClick={() => setEditor(target)} aria-label="Edit target">
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="sm" iconOnly onClick={() => setDeleting(target)} aria-label="Delete target">
                      <Trash2 />
                    </Button>
                  </div>
                </div>

                <div className="row wrap mb-3" style={{ gap: 6 }}>
                  <Badge tone="info">{REMOTE_OPTIONS.find((option) => option.value === target.remotePreference)?.label ?? target.remotePreference}</Badge>
                  {target.employmentTypes.slice(0, 3).map((type) => (
                    <Badge key={type}>{employmentLabels[type as keyof typeof employmentLabels] ?? type}</Badge>
                  ))}
                  {target.seniority.map((level) => (
                    <Badge key={level} tone="purple">{level}</Badge>
                  ))}
                </div>

                <div className="small muted mb-2">Roles</div>
                <div className="chip-list mb-3">
                  {target.jobTitles.length > 0 ? target.jobTitles.map((title) => (
                    <span className="chip" key={title}>{title}</span>
                  )) : <span className="small muted">No role titles yet — the pre-filter keeps everything.</span>}
                </div>

                <div className="grid cols-2" style={{ gap: 10 }}>
                  <div className="mini-stat">
                    <div className="k">Schedule</div>
                    <div className="v" style={{ fontSize: 13, fontFamily: 'inherit', letterSpacing: 0 }}>{schedule}</div>
                    <div className="tiny faint mt-2">{target.timezone}</div>
                  </div>
                  <div className="mini-stat">
                    <div className="k">Last scan</div>
                    <div className="v" style={{ fontSize: 13, fontFamily: 'inherit', letterSpacing: 0 }}>{target.lastRunAt ? timeAgo(target.lastRunAt) : 'Never'}</div>
                    <div className="tiny faint mt-2">{target.sources.length ? `${plural(target.sources.length, 'pinned source')}` : 'All enabled sources'}</div>
                  </div>
                </div>

                {target.keywords.length > 0 ? (
                  <div className="tiny faint mt-3">Keywords: {target.keywords.join(' · ')}</div>
                ) : null}
                {target.excludeKeywords.length > 0 ? (
                  <div className="tiny faint mt-2">Excludes: {target.excludeKeywords.join(' · ')}</div>
                ) : null}
                {targetSources.length > 0 ? (
                  <div className="tiny faint mt-2">Sources: {targetSources.map((source) => source.label).join(' · ')}</div>
                ) : null}
                {target.minSalary !== null ? (
                  <div className="tiny faint mt-2">
                    Minimum {target.minSalary.toLocaleString()} {target.currency ?? ''}
                  </div>
                ) : null}

                <div className="row mt-3" style={{ gap: 8 }}>
                  <Button variant="secondary" size="sm" onClick={() => poll.mutate(target.id)} loading={poll.isPending && poll.variables === target.id}>
                    <RefreshCw /> Scan now
                  </Button>
                  <span className="spacer" />
                  <span className="tiny faint">Updated {timeAgo(target.updatedAt)}</span>
                </div>
              </Panel>
            )
          })}
        </div>
      )}

      <Panel title="How scanning works" className="mt-4">
        <div className="grid cols-3" style={{ gap: 14 }}>
          <div>
            <div className="small strong mb-2"><Clock size={13} style={{ verticalAlign: -2 }} /> Cron per country</div>
            <div className="small muted">
              Each enabled target gets its own scheduled scan. The scheduler runs inside the desktop app; if the app was closed, the next launch
              resumes the schedule without replaying missed runs.
            </div>
          </div>
          <div>
            <div className="small strong mb-2"><CalendarClock size={13} style={{ verticalAlign: -2 }} /> Source scope</div>
            <div className="small muted">
              Pin a target to specific sources, or leave the list empty to use every enabled source. Rate limits are enforced per source, not per
              country.
            </div>
          </div>
          <div>
            <div className="small strong mb-2"><AlertTriangle size={13} style={{ verticalAlign: -2 }} /> Eligibility before work</div>
            <div className="small muted">
              A posting only becomes an application when the country, sponsorship signal, score, and profile completeness all pass the deterministic
              rules.
            </div>
          </div>
        </div>
      </Panel>

      {editor ? (
        <TargetEditor
          key={editor === 'new' ? 'new' : editor.id}
          target={editor === 'new' ? null : editor}
          existing={targets}
          sources={sources}
          timeZone={timeZone}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null)
            refresh()
          }}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => { if (!open) setDeleting(null) }}
        title="Remove this target?"
        description={
          deleting
            ? `Discovery for ${country(deleting.countryCode)} will stop and its schedule will be deleted. Jobs and applications already found are not deleted.`
            : ''
        }
        confirmLabel="Remove target"
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        busy={remove.isPending}
      />
    </>
  )
}

function TargetEditor({
  target,
  existing,
  sources,
  timeZone,
  onClose,
  onSaved
}: {
  target: TargetCountryDTO | null
  existing: TargetCountryDTO[]
  sources: { id: string; label: string; enabled: boolean; connector: string }[]
  timeZone: string
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [countryCode, setCountryCode] = useState(target?.countryCode ?? '')
  const [enabled, setEnabled] = useState(target?.enabled ?? true)
  const [remotePreference, setRemotePreference] = useState<TargetCountryDTO['remotePreference']>(target?.remotePreference ?? 'any')
  const [employmentTypes, setEmploymentTypes] = useState<string[]>(target?.employmentTypes ?? ['full_time'])
  const [jobTitles, setJobTitles] = useState<string[]>(target?.jobTitles ?? [])
  const [keywords, setKeywords] = useState<string[]>(target?.keywords ?? [])
  const [excludeKeywords, setExcludeKeywords] = useState<string[]>(target?.excludeKeywords ?? [])
  const [seniority, setSeniority] = useState<string[]>(target?.seniority ?? [])
  const [minSalary, setMinSalary] = useState(target?.minSalary !== null && target?.minSalary !== undefined ? String(target.minSalary) : '')
  const [currency, setCurrency] = useState(target?.currency ?? '')
  const [scheduleCron, setScheduleCron] = useState(target?.scheduleCron ?? '0 8 * * 1-5')
  const [zone, setZone] = useState(target?.timezone ?? timeZone)
  const [selectedSources, setSelectedSources] = useState<string[]>(target?.sources ?? [])

  const toggleEmployment = (value: string) => {
    setEmploymentTypes((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]))
  }
  const toggleSource = (value: string) => {
    setSelectedSources((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]))
  }

  const save = useMutation({
    mutationFn: () =>
      call('targets.save', {
        id: target?.id,
        input: {
          countryCode,
          enabled,
          remotePreference,
          employmentTypes,
          jobTitles,
          keywords,
          excludeKeywords,
          minSalary: minSalary.trim() ? Number(minSalary) : null,
          currency: currency.trim() ? currency.trim().toUpperCase() : null,
          seniority,
          scheduleCron: scheduleCron.trim(),
          timezone: zone.trim(),
          sources: selectedSources
        }
      }),
    onSuccess: () => {
      toast.success('Target saved and schedule synchronized.')
      onSaved()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const canSave = Boolean(countryCode) && scheduleCron.trim().split(/\s+/).length === 5 && zone.trim().length > 0 && jobTitles.length > 0

  return (
    <Modal
      open
      onOpenChange={(open) => { if (!open) onClose() }}
      title={target ? `Edit ${country(target.countryCode)} target` : 'Add target country'}
      desc="The worker scans this country on the schedule below, using your role titles as the search query."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!canSave}>
            {target ? 'Save target' : 'Add target'}
          </Button>
        </>
      }
    >
      <div className="field-row">
        <Field label="Country" required hint="Only countries you have authorized or where sponsorship is explicitly offered.">
          <CountrySelect
            value={countryCode}
            onChange={setCountryCode}
            exclude={existing.filter((item) => item.id !== target?.id).map((item) => item.countryCode)}
            placeholder="Choose a country"
          />
        </Field>
        <Field label="Work arrangement">
          <Select value={remotePreference} onChange={(event) => setRemotePreference(event.target.value as typeof remotePreference)}>
            {REMOTE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="field mt-3">
        <span className="label">Employment types</span>
        <div className="chip-list">
          {EMPLOYMENT_OPTIONS.map((type) => {
            const selected = employmentTypes.includes(type)
            return (
              <button
                key={type}
                type="button"
                className="chip"
                style={selected ? { borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-soft)' } : { cursor: 'pointer' }}
                onClick={() => toggleEmployment(type)}
              >
                {employmentLabels[type]}
              </button>
            )
          })}
        </div>
      </div>

      <div className="field mt-3">
        <span className="label">Role titles <span className="req">*</span></span>
        <ChipEditor values={jobTitles} onChange={setJobTitles} suggestions={TITLE_SUGGESTIONS} placeholder="e.g. DevOps Engineer" />
        <span className="hint">These become the source search queries and the title score baseline.</span>
      </div>

      <div className="field-row mt-3">
        <Field label="Include keywords" hint="Optional. Used as an additional match signal.">
          <ChipEditor values={keywords} onChange={setKeywords} placeholder="kubernetes, terraform" />
        </Field>
        <Field label="Exclude keywords" hint="Postings containing any of these are skipped.">
          <ChipEditor values={excludeKeywords} onChange={setExcludeKeywords} placeholder="unpaid, commission only" />
        </Field>
      </div>

      <div className="field-row mt-3">
        <Field label="Seniority" hint="Optional. Used by the score notes and your own filtering.">
          <ChipEditor values={seniority} onChange={setSeniority} suggestions={SENIORITY_SUGGESTIONS} placeholder="senior, lead" />
        </Field>
        <div className="field-row" style={{ gridTemplateColumns: '1fr 90px' }}>
          <Field label="Minimum salary" hint="Annual amount used for salary fit.">
            <Input type="number" min={0} value={minSalary} onChange={(event) => setMinSalary(event.target.value)} placeholder="Optional" />
          </Field>
          <Field label="Currency">
            <Input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase().slice(0, 3))} placeholder="EUR" maxLength={3} />
          </Field>
        </div>
      </div>

      <div className="form-section mt-3">
        <div className="form-section-title">Schedule</div>
        <div className="form-section-desc">Cron expressions are validated against the selected time zone before saving.</div>
        <div className="field-row">
          <Field label="Preset">
            <Select
              value={SCHEDULE_PRESETS.find((preset) => preset.cron === scheduleCron)?.cron ?? ''}
              onChange={(event) => { if (event.target.value) setScheduleCron(event.target.value) }}
            >
              <option value="">Custom</option>
              {SCHEDULE_PRESETS.map((preset) => (
                <option key={preset.cron} value={preset.cron}>{preset.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Cron expression" required hint={`Five fields · ${formatCron(scheduleCron) || 'invalid expression'}`}>
            <Input className="mono" value={scheduleCron} onChange={(event) => setScheduleCron(event.target.value)} placeholder="0 8 * * 1-5" />
          </Field>
        </div>
        <Field label="Time zone" required hint="IANA name such as Europe/Berlin or America/New_York." className="mt-3">
          <Input value={zone} onChange={(event) => setZone(event.target.value)} placeholder={timeZone} />
        </Field>
      </div>

      <div className="form-section mt-3">
        <div className="form-section-title">Sources</div>
        <div className="form-section-desc">Leave everything unchecked to use every enabled source.</div>
        <div className="stack">
          {sources.map((source) => (
            <label className="check-row" key={source.id} style={{ padding: '7px 0' }}>
              <input
                type="checkbox"
                checked={selectedSources.includes(source.id)}
                onChange={() => toggleSource(source.id)}
                disabled={!source.enabled}
              />
              <span>
                <span className="small strong">{source.label}</span>
                <span className="tiny faint"> · {source.connector}{source.enabled ? '' : ' · disabled'}</span>
              </span>
            </label>
          ))}
          {sources.length === 0 ? <div className="small muted">No sources configured.</div> : null}
        </div>
      </div>

      <div className="switch-row mt-3">
        <div className="switch-row-text">
          <div className="switch-row-title">Scan this country automatically</div>
          <div className="switch-row-desc">
            {target?.lastRunAt ? `Last scan ${timeAgo(target.lastRunAt)}. ` : ''}
            {scheduleCron.split(/\s+/).length === 5 ? 'Runs follow this cron schedule in the selected time zone.' : 'Fix the cron expression to schedule runs.'}
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} label="Scan this country automatically" />
      </div>
    </Modal>
  )
}
