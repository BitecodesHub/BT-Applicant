import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  ExternalLink,
  Globe2,
  History,
  KeyRound,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Trash2,
  XCircle
} from 'lucide-react'
import type { ConnectorDTO, SourceDTO } from '@shared/api'
import { call, openExternal, queryKeys } from '../lib/api'
import { country, durationText, fmtDateTime, humanize, plural, timeAgo } from '../lib/format'
import { keychainName } from '../lib/platform'
import {
  Badge,
  Button,
  ConfirmDialog,
  CountryChips,
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
import { slugify } from '../lib/format'

export default function Sources() {
  const [editing, setEditing] = useState<SourceDTO | null | 'new'>(null)
  const [testing, setTesting] = useState<SourceDTO | null>(null)
  const [history, setHistory] = useState<SourceDTO | null>(null)
  const [deleting, setDeleting] = useState<SourceDTO | null>(null)
  const queryClient = useQueryClient()
  const toast = useToast()

  const bootstrap = useQuery({ queryKey: queryKeys.bootstrap, queryFn: () => call('app.bootstrap'), staleTime: 10_000 })
  const sourcesQuery = useQuery({ queryKey: queryKeys.sources, queryFn: () => call('sources.list') })
  const connectorsQuery = useQuery({ queryKey: queryKeys.connectors, queryFn: () => call('sources.connectors'), staleTime: 60_000 })
  const secrets = useQuery({ queryKey: queryKeys.secrets, queryFn: () => call('secrets.list'), staleTime: 10_000 })

  const toggle = useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) => call('sources.toggle', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sources })
      queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success('Source updated.')
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const remove = useMutation({
    mutationFn: (id: string) => call('sources.delete', { id }),
    onSuccess: () => {
      setDeleting(null)
      queryClient.invalidateQueries({ queryKey: queryKeys.sources })
      queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast.info('Source removed. Jobs already discovered are kept.')
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const sources = sourcesQuery.data ?? []
  const connectors = connectorsQuery.data ?? []
  const targets = bootstrap.data?.targets ?? []
  const enabled = sources.filter((source) => source.enabled).length
  const failing = sources.filter((source) => source.consecutiveFailures > 0 && source.enabled).length
  const secretKeys = secrets.data ?? []

  return (
    <>
      <PageHeader
        eyebrow="Sources"
        title="Discovery connectors"
        desc="Public job APIs and career pages, each with its own rate limit and provenance. No scraping bypasses, no CAPTCHAs, no guessed endpoints."
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus /> Add source
          </Button>
        }
      />

      <div className="stat-grid mb-4">
        <div className="stat-card">
          <div className="stat-label">Configured sources</div>
          <div className="stat-value">{sources.length}</div>
          <div className="stat-foot">{enabled} enabled</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Healthy</div>
          <div className="stat-value" style={{ color: 'var(--green)' }}>{sources.filter((source) => source.enabled && source.consecutiveFailures === 0 && source.lastSuccessAt).length}</div>
          <div className="stat-foot">Last fetch succeeded</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Failing</div>
          <div className="stat-value" style={{ color: failing ? 'var(--red)' : 'var(--muted)' }}>{failing}</div>
          <div className="stat-foot">Repeated failures back off automatically</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Connector types</div>
          <div className="stat-value">{connectors.length}</div>
          <div className="stat-foot">Public, documented APIs only</div>
        </div>
      </div>

      <Notice tone="info" className="mb-4">
        <span>
          Credentials are stored in {keychainName} through Electron safeStorage, never in the SQLite database or logs. A source only
          contributes postings for the countries you assign to it.
        </span>
      </Notice>

      <Panel
        title="Sources"
        sub={sourcesQuery.isFetching ? 'Refreshing…' : 'Health reflects actual fetch results.'}
        actions={
          <Button variant="ghost" size="sm" onClick={() => { sourcesQuery.refetch(); connectorsQuery.refetch(); secrets.refetch() }} loading={sourcesQuery.isFetching}>
            <RefreshCw /> Refresh
          </Button>
        }
        flush
      >
        {sourcesQuery.isLoading ? (
          <PageLoading label="Loading sources" />
        ) : sourcesQuery.error ? (
          <PageError error={sourcesQuery.error} onRetry={() => sourcesQuery.refetch()} />
        ) : sources.length === 0 ? (
          <EmptyState
            icon={Plug}
            title="No sources configured"
            desc="Add a public job API or an ATS board to begin discovering postings. Start with a company board you already follow."
            action={<Button variant="primary" onClick={() => setEditing('new')}><Plus /> Add source</Button>}
          />
        ) : (
          <div className="list">
            {sources.map((source) => (
              <SourceRow
                key={source.id}
                source={source}
                onToggle={(value) => toggle.mutate({ id: source.id, enabled: value })}
                onTest={() => setTesting(source)}
                onHistory={() => setHistory(source)}
                onEdit={() => setEditing(source)}
                onDelete={() => setDeleting(source)}
              />
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Connector catalog" sub="Everything the runtime can speak to without private credentials." className="mt-4" flush>
        {connectorsQuery.isLoading ? (
          <PageLoading label="Loading connectors" />
        ) : (
          <div className="list">
            {connectors.map((connector) => (
              <div className="list-row" key={connector.id} style={{ alignItems: 'flex-start' }}>
                <div className="empty-icon" style={{ width: 32, height: 32, borderRadius: 9 }}>
                  <Database size={14} />
                </div>
                <div className="list-row-main">
                  <div className="row wrap" style={{ gap: 6 }}>
                    <span className="small strong">{connector.label}</span>
                    <Badge tone={connector.kind === 'ats' ? 'success' : connector.kind === 'government' ? 'info' : 'neutral'}>{connector.kind}</Badge>
                    {connector.requiresCredentials ? <Badge tone="warn" icon={KeyRound}>Credentials</Badge> : <Badge>No key</Badge>}
                    <Badge tone={connector.canProvideApplicationEmail ? 'accent' : 'neutral'}>
                      {connector.canProvideApplicationEmail ? 'May expose email' : 'No email'}
                    </Badge>
                  </div>
                  <div className="small muted mt-2" style={{ lineHeight: 1.55 }}>{connector.notes}</div>
                  <div className="tiny faint mt-2">
                    {connector.countries === 'global' ? 'Global' : connector.countries.map((code) => country(code)).join(', ')}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => openExternal(connector.docsUrl)}>
                  <ExternalLink /> Docs
                </Button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {editing ? (
        <SourceEditor
          key={editing === 'new' ? 'new' : editing.id}
          source={editing === 'new' ? null : editing}
          connectors={connectors}
          secretKeys={secretKeys}
          existingIds={sources.map((source) => source.id)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            queryClient.invalidateQueries({ queryKey: queryKeys.sources })
            queryClient.invalidateQueries({ queryKey: queryKeys.secrets })
            queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap })
            queryClient.invalidateQueries({ queryKey: ['dashboard'] })
          }}
        />
      ) : null}

      {testing ? (
        <TestSourceModal source={testing} targets={targets.map((target) => target.countryCode)} onClose={() => setTesting(null)} />
      ) : null}

      {history ? <SourceHistoryModal source={history} onClose={() => setHistory(null)} /> : null}

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => { if (!open) setDeleting(null) }}
        title="Remove this source?"
        description={
          deleting
            ? `${deleting.label} will stop being polled, and its stored credentials will be removed from ${keychainName}. Jobs already stored from this source are retained, along with their provenance.`
            : ''
        }
        confirmLabel="Remove source"
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        busy={remove.isPending}
      />
    </>
  )
}

function SourceRow({
  source,
  onToggle,
  onTest,
  onHistory,
  onEdit,
  onDelete
}: {
  source: SourceDTO
  onToggle: (value: boolean) => void
  onTest: () => void
  onHistory: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const failing = source.consecutiveFailures > 0
  const health = !source.enabled
    ? { label: 'Disabled', tone: 'neutral' as const }
    : failing
      ? { label: `${source.consecutiveFailures} failure${source.consecutiveFailures === 1 ? '' : 's'}`, tone: 'danger' as const }
      : source.lastSuccessAt
        ? { label: 'Healthy', tone: 'success' as const }
        : { label: 'Not run yet', tone: 'warn' as const }

  return (
    <div className="list-row" style={{ alignItems: 'flex-start', padding: '16px 18px' }}>
      <div style={{ paddingTop: 2 }}>
        <Switch checked={source.enabled} onCheckedChange={onToggle} label={`Enable ${source.label}`} />
      </div>
      <div className="list-row-main">
        <div className="row wrap" style={{ gap: 6 }}>
          <span className="cell-title">{source.label}</span>
          <Badge tone={health.tone}>{health.label}</Badge>
          <Badge>{source.connector}</Badge>
          <span className="tiny mono faint">{source.id}</span>
        </div>
        <div className="tiny muted mt-2">
          {source.countries.length > 0 ? source.countries.map((code) => country(code)).join(' · ') : 'All eligible countries'} ·{' '}
          {source.rateLimitPerMinute}/min · last success {timeAgo(source.lastSuccessAt)}
          {source.lastItemCount !== null ? ` · ${plural(source.lastItemCount, 'item')} last run` : ''}
        </div>
        {source.lastError ? (
          <div className="small color-red mt-2" style={{ lineHeight: 1.5 }}>
            <AlertTriangle size={12} style={{ verticalAlign: -2 }} /> {source.lastError}
            <span className="tiny faint"> · {timeAgo(source.lastErrorAt)}</span>
          </div>
        ) : null}
      </div>
      <div className="row" style={{ gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <Button variant="ghost" size="sm" onClick={onTest}>
          <RefreshCw /> Test
        </Button>
        <Button variant="ghost" size="sm" onClick={onHistory}>
          <History /> History
        </Button>
        <Button variant="ghost" size="sm" iconOnly onClick={onEdit} aria-label={`Edit ${source.label}`}>
          <Pencil />
        </Button>
        <Button variant="ghost" size="sm" iconOnly onClick={onDelete} aria-label={`Delete ${source.label}`}>
          <Trash2 />
        </Button>
      </div>
    </div>
  )
}

function SourceEditor({
  source,
  connectors,
  secretKeys,
  existingIds,
  onClose,
  onSaved
}: {
  source: SourceDTO | null
  connectors: ConnectorDTO[]
  secretKeys: string[]
  existingIds: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [connectorId, setConnectorId] = useState(source?.connector ?? connectors[0]?.id ?? 'greenhouse')
  const connector = connectors.find((item) => item.id === connectorId)
  const [label, setLabel] = useState(source?.label ?? '')
  const [id, setId] = useState(source?.id ?? '')
  const [enabled, setEnabled] = useState(source?.enabled ?? true)
  const [countries, setCountries] = useState<string[]>(source?.countries ?? [])
  const [rateLimit, setRateLimit] = useState(source?.rateLimitPerMinute ?? 30)
  const initialBoards = useMemo(() => {
    const raw = source?.config?.boards
    if (!Array.isArray(raw)) return ''
    return raw
      .map((item) => (typeof item === 'string' ? item : typeof item === 'object' && item && 'token' in item ? String((item as { token: unknown }).token) : ''))
      .filter(Boolean)
      .join(', ')
  }, [source])
  const [boards, setBoards] = useState(initialBoards)
  const [urls, setUrls] = useState(Array.isArray(source?.config?.urls) ? (source?.config.urls as string[]).join('\n') : '')
  const [credentials, setCredentials] = useState<Record<string, string>>({})

  const isBoardConnector = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable'].includes(connectorId)
  const isJsonLd = connectorId === 'jsonld'
  const suggestedId = slugify(label) || 'source'
  const resolvedId = source ? source.id : id || suggestedId
  const duplicateId = !source && existingIds.includes(resolvedId)

  const save = useMutation({
    mutationFn: async () => {
      const config: Record<string, unknown> = { ...(source?.config ?? {}) }
      if (isBoardConnector) {
        config.boards = boards
          .split(',')
          .map((token) => token.trim())
          .filter(Boolean)
      }
      if (isJsonLd) {
        config.urls = urls
          .split('\n')
          .map((url) => url.trim())
          .filter(Boolean)
      }
      if (isBoardConnector || isJsonLd) {
        for (const key of Object.keys(config)) {
          if (key !== 'boards' && key !== 'urls') delete config[key]
        }
      } else {
        for (const key of Object.keys(config)) delete config[key]
      }
      const saved = await call('sources.save', {
        id: resolvedId,
        connector: connectorId,
        label: label.trim(),
        config,
        enabled,
        countries,
        rateLimitPerMinute: Math.max(1, Math.min(300, Math.round(rateLimit)))
      })
      const entered = Object.entries(credentials).filter(([, value]) => value.trim().length > 0)
      for (const [key, value] of entered) {
        await call('secrets.set', { key: `source.${resolvedId}.${key}`, value: value.trim() })
      }
      return { saved, credentialsSaved: entered.length }
    },
    onSuccess: (result) => {
      toast.success(`Source saved${result.credentialsSaved ? ` · ${plural(result.credentialsSaved, 'credential')} stored in ${keychainName}` : ''}.`)
      onSaved()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const configValid = isBoardConnector
    ? boards.split(',').some((token) => token.trim().length > 0)
    : isJsonLd
      ? urls.split('\n').some((url) => url.trim().startsWith('http'))
      : true
  const canSave = label.trim().length >= 2 && resolvedId.length >= 2 && !duplicateId && configValid

  return (
    <Modal
      open
      onOpenChange={(open) => { if (!open) onClose() }}
      title={source ? 'Edit source' : 'Add source'}
      desc={source ? `${source.label} · ${source.connector}` : 'Choose a public connector and point it at the boards or pages you care about.'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!canSave}>
            {source ? 'Save changes' : 'Add source'}
          </Button>
        </>
      }
    >
      <div className="field-row">
        <Field label="Connector" required hint={connector?.notes}>
          <Select
            value={connectorId}
            onChange={(event) => {
              setConnectorId(event.target.value)
              setCredentials({})
            }}
            disabled={Boolean(source)}
          >
            {connectors.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label} ({item.kind})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Label" required hint="Shown in job provenance and filters.">
          <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Greenhouse — fintech boards" maxLength={200} />
        </Field>
      </div>

      <div className="field-row mt-3">
        <Field
          label="Source ID"
          required
          hint={source ? 'The identifier is permanent once created.' : duplicateId ? 'This ID already exists. Choose another.' : 'Lowercase letters, numbers, and hyphens.'}
        >
          <Input
            value={source ? source.id : id}
            onChange={(event) => setId(slugify(event.target.value))}
            placeholder={suggestedId}
            disabled={Boolean(source)}
            maxLength={80}
          />
        </Field>
        <Field label="Rate limit per minute" hint="Requests are spaced under this limit.">
          <Input
            type="number"
            min={1}
            max={300}
            value={rateLimit}
            onChange={(event) => setRateLimit(Number(event.target.value) || 30)}
          />
        </Field>
      </div>

      {isBoardConnector ? (
        <Field
          label="Board tokens"
          required
          hint={
            <>
              Comma-separated company slugs. For Greenhouse or Lever this is the first path segment of the public board URL; for Ashby, SmartRecruiters,
              and Workable it is the organization slug.
            </>
          }
          className="mt-3"
        >
          <Input value={boards} onChange={(event) => setBoards(event.target.value)} placeholder="stripe, figma, northwind" />
        </Field>
      ) : null}

      {isJsonLd ? (
        <Field label="Career page URLs" required hint="One public career page per line. Pages must publish schema.org JobPosting JSON-LD." className="mt-3">
          <textarea
            className="textarea"
            value={urls}
            onChange={(event) => setUrls(event.target.value)}
            placeholder={'https://example.com/careers\nhttps://another.example/jobs'}
            rows={4}
          />
        </Field>
      ) : null}

      {!isBoardConnector && !isJsonLd ? (
        <Notice tone="neutral" className="mt-3">
          This connector searches by the role titles and country configured in Targets. No extra source configuration is needed.
        </Notice>
      ) : null}

      <Field label="Countries" hint="Leave empty to let the source serve every target country it supports." className="mt-3">
        <CountryChips values={countries} onChange={setCountries} />
      </Field>

      {connector && connector.credentialFields.length > 0 ? (
        <div className="form-section mt-3">
          <div className="form-section-title">Credentials</div>
          <div className="form-section-desc">Stored in {keychainName}. Existing values are never displayed again.</div>
          <div className="stack">
            {connector.credentialFields.map((field) => {
              const saved = secretKeys.includes(`source.${resolvedId}.${field.key}`)
              return (
                <Field
                  key={field.key}
                  label={field.label}
                  required={!saved}
                  hint={
                    saved
                      ? 'A value is already stored. Leave blank to keep it.'
                      : field.hint
                  }
                >
                  <Input
                    type="password"
                    autoComplete="off"
                    value={credentials[field.key] ?? ''}
                    onChange={(event) => setCredentials((current) => ({ ...current, [field.key]: event.target.value }))}
                    placeholder={saved ? 'Saved securely' : 'Enter value'}
                  />
                </Field>
              )
            })}
          </div>
        </div>
      ) : null}

      <div className="switch-row mt-3">
        <div className="switch-row-text">
          <div className="switch-row-title">Enabled for discovery</div>
          <div className="switch-row-desc">Disabled sources keep their history but are not polled.</div>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} label="Enabled for discovery" />
      </div>
    </Modal>
  )
}

function TestSourceModal({ source, targets, onClose }: { source: SourceDTO; targets: string[]; onClose: () => void }) {
  const defaultCountry = source.countries[0] ?? targets[0] ?? 'US'
  const [countryCode, setCountryCode] = useState(defaultCountry)
  const test = useMutation({
    mutationFn: () =>
      call('sources.test', {
        id: source.id,
        connector: source.connector,
        config: source.config,
        countryCode
      })
  })

  return (
    <Modal
      open
      onOpenChange={(open) => { if (!open) onClose() }}
      title="Test connection"
      desc={`${source.label} · one page is fetched and discarded`}
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}
    >
      <Field label="Test country" hint="The connector sees this country as the target market.">
        <CountrySelect value={countryCode} onChange={(value) => setCountryCode(value)} />
      </Field>
      <div className="row mt-3">
        <Button variant="primary" onClick={() => test.mutate()} loading={test.isPending} disabled={!countryCode}>
          <RefreshCw /> Run test
        </Button>
        <span className="tiny faint">Nothing is imported by a connection test.</span>
      </div>
      {test.data ? (
        <div className={`notice ${test.data.ok ? 'notice-success' : 'notice-danger'} mt-3`} style={{ borderColor: test.data.ok ? 'color-mix(in srgb, var(--green) 30%, transparent)' : undefined }}>
          <div>
            <div className="row" style={{ gap: 6 }}>
              {test.data.ok ? <CheckCircle2 size={14} className="color-green" /> : <XCircle size={14} className="color-red" />}
              <span className="small strong">{test.data.ok ? 'Connection succeeded' : 'Connection failed'}</span>
              {test.data.latencyMs !== undefined ? <span className="tiny faint mono">{durationText(test.data.latencyMs)}</span> : null}
            </div>
            <div className="small muted mt-2">{test.data.message}</div>
            {test.data.sampleTitles && test.data.sampleTitles.length > 0 ? (
              <ul className="small muted mt-2" style={{ paddingLeft: 18 }}>
                {test.data.sampleTitles.slice(0, 5).map((title, index) => (
                  <li key={index}>{title}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
      {test.error ? <Notice tone="danger" className="mt-3">{test.error instanceof Error ? test.error.message : String(test.error)}</Notice> : null}
    </Modal>
  )
}

function SourceHistoryModal({ source, onClose }: { source: SourceDTO; onClose: () => void }) {
  const history = useQuery({
    queryKey: ['source-history', source.id],
    queryFn: () => call('sources.history', { id: source.id })
  })

  return (
    <Modal
      open
      onOpenChange={(open) => { if (!open) onClose() }}
      title="Fetch history"
      desc={`${source.label} · most recent runs`}
      size="lg"
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}
    >
      {history.isLoading ? (
        <PageLoading label="Loading history" />
      ) : (history.data ?? []).length === 0 ? (
        <EmptyState icon={Clock} title="No fetch history yet" desc="Run a discovery scan to create the first entry." />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Started</th>
                <th>Status</th>
                <th>Items</th>
                <th>New</th>
                <th>Duration</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {(history.data ?? []).map((fetch) => (
                <tr key={fetch.id}>
                  <td className="num">{fmtDateTime(fetch.startedAt)}</td>
                  <td>
                    <Badge tone={fetch.status === 'success' ? 'success' : fetch.status === 'failed' ? 'danger' : 'neutral'}>{humanize(fetch.status)}</Badge>
                  </td>
                  <td className="num">{fetch.items}</td>
                  <td className="num">{fetch.newItems}</td>
                  <td className="num muted">{fetch.durationMs !== null ? durationText(fetch.durationMs) : '—'}</td>
                  <td className="small color-red" style={{ maxWidth: 260 }}>{fetch.error ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}
