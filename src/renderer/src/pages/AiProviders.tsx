import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  CircleAlert,
  Cloud,
  Cpu,
  FlaskConical,
  Gauge,
  KeyRound,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  XCircle,
  type LucideIcon
} from 'lucide-react'
import type { AiProviderStatusDTO, AiTestResultDTO } from '@shared/api'
import type { AiProviderId } from '@shared/types'
import type { AiSettings } from '@shared/settings'
import { call } from '../lib/api'
import { aiModeLabels, plural, timeAgo } from '../lib/format'
import {
  Badge,
  Button,
  ConfirmDialog,
  Field,
  Input,
  Notice,
  PageError,
  PageHeader,
  PageLoading,
  Panel,
  Select,
  StatCard,
  StatusDot,
  SwitchRow,
  useToast
} from '../components/ui'

interface ProviderInfo {
  label: string
  model: string
  local: boolean
  key: string | null
  description: string
  icon: LucideIcon
}

const PROVIDER_INFO: Record<AiProviderId, ProviderInfo> = {
  ollama: {
    label: 'Ollama (local)',
    model: 'llama3.2',
    local: true,
    key: null,
    description: 'Runs on this Mac through a local server. No API key and no cloud request.',
    icon: Cpu
  },
  anthropic: {
    label: 'Anthropic Claude',
    model: 'claude-sonnet-4-5',
    local: false,
    key: 'ai.anthropic',
    description: 'Cloud API. The key is stored in the macOS keychain and sent only to Anthropic.',
    icon: Cloud
  },
  openai: {
    label: 'OpenAI',
    model: 'gpt-5',
    local: false,
    key: 'ai.openai',
    description: 'Cloud API. Reasoning models are called with completion-token limits automatically.',
    icon: Cloud
  },
  gemini: {
    label: 'Google Gemini',
    model: 'gemini-2.5-pro',
    local: false,
    key: 'ai.gemini',
    description: 'Cloud API through Google AI Studio. Used only when included in the chain.',
    icon: Cloud
  },
  openai_compatible: {
    label: 'OpenAI-compatible endpoint',
    model: 'local-model',
    local: true,
    key: 'ai.openai_compatible',
    description: 'Any server that implements the OpenAI chat-completions shape, such as LM Studio or vLLM.',
    icon: FlaskConical
  }
}

const PROVIDER_IDS: AiProviderId[] = ['ollama', 'anthropic', 'openai', 'gemini', 'openai_compatible']

export default function AiProviders() {
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => call('settings.get'), staleTime: 10_000 })
  const status = useQuery({ queryKey: ['ai-status'], queryFn: () => call('ai.status'), refetchInterval: 30_000 })
  const secrets = useQuery({ queryKey: ['secrets'], queryFn: () => call('secrets.list'), staleTime: 10_000 })

  if (settings.isLoading && !settings.data) return <PageLoading label="Reading AI configuration" />
  if (settings.error) return <PageError error={settings.error} onRetry={() => settings.refetch()} />

  return (
    <AiWorkspace
      initial={settings.data!.ai}
      status={status.data ?? []}
      secretKeys={secrets.data ?? []}
      statusLoading={status.isLoading}
      secretsLoading={secrets.isLoading}
    />
  )
}

function AiWorkspace({
  initial,
  status,
  secretKeys,
  statusLoading,
  secretsLoading
}: {
  initial: AiSettings
  status: AiProviderStatusDTO[]
  secretKeys: string[]
  statusLoading: boolean
  secretsLoading: boolean
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [baseline, setBaseline] = useState<AiSettings>(initial)
  const [draft, setDraft] = useState<AiSettings>(initial)
  const [keyInputs, setKeyInputs] = useState<Partial<Record<AiProviderId, string>>>({})
  const [testResult, setTestResult] = useState<AiTestResultDTO | null>(null)
  const [removeKeyFor, setRemoveKeyFor] = useState<AiProviderId | null>(null)
  const [addProvider, setAddProvider] = useState<AiProviderId | ''>('')

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [draft, baseline])
  const invalid = draft.chain.length === 0

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
    void queryClient.invalidateQueries({ queryKey: ['ai-status'] })
    void queryClient.invalidateQueries({ queryKey: ['diagnostics'] })
    void queryClient.invalidateQueries({ queryKey: ['secrets'] })
  }

  const save = useMutation({
    mutationFn: () => call('settings.save', { section: 'ai', value: draft }),
    onSuccess: (result) => {
      setBaseline(result.ai)
      setDraft(result.ai)
      toast.success('AI settings saved.')
      refresh()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const storeKey = useMutation({
    mutationFn: (provider: AiProviderId) => call('secrets.set', { key: PROVIDER_INFO[provider].key!, value: keyInputs[provider]!.trim() }),
    onSuccess: (_keys, provider) => {
      setKeyInputs((current) => ({ ...current, [provider]: '' }))
      toast.success(`${PROVIDER_INFO[provider].label} key stored in the macOS keychain.`)
      refresh()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const deleteKey = useMutation({
    mutationFn: (provider: AiProviderId) => call('secrets.delete', { key: PROVIDER_INFO[provider].key! }),
    onSuccess: (_keys, provider) => {
      toast.success(`${PROVIDER_INFO[provider].label} key removed.`)
      setRemoveKeyFor(null)
      refresh()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const test = useMutation({
    mutationFn: () => call('ai.test'),
    onSuccess: (result) => {
      setTestResult(result)
      if (result.ok) toast.success(`Connected through ${PROVIDER_INFO[result.provider!]?.label ?? result.provider}.`)
      else toast.info('No provider answered. Deterministic drafting remains active.')
      refresh()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const health = useMemo(() => new Map(status.map((item) => [item.id, item])), [status])
  const configuredCount = PROVIDER_IDS.filter((id) => isConfigured(id, draft, secretKeys)).length
  const openCircuits = status.filter((item) => item.circuitState !== 'closed').length
  const unused = PROVIDER_IDS.filter((id) => !draft.chain.includes(id))
  const modeTone = draft.mode === 'enhanced' ? 'purple' : draft.mode === 'off' ? 'success' : 'warn'

  const move = (index: number, delta: number) => {
    const next = [...draft.chain]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    const [item] = next.splice(index, 1)
    if (!item) return
    next.splice(target, 0, item)
    setDraft({ ...draft, chain: next })
  }

  const removeFromChain = (provider: AiProviderId) => {
    if (draft.chain.length === 1) {
      toast.error('The chain must contain at least one provider.')
      return
    }
    setDraft({ ...draft, chain: draft.chain.filter((item) => item !== provider) })
  }

  const addToChain = () => {
    if (!addProvider) return
    setDraft({ ...draft, chain: [...draft.chain, addProvider] })
    setAddProvider('')
  }

  return (
    <>
      <PageHeader
        eyebrow="Optional overlay"
        title="AI providers"
        desc="AI improves wording when it is available. Discovery, eligibility, routing, drafting, and sending never depend on a model answering. Turn it off at any time and the pipeline keeps running."
        actions={
          <>
            <Button variant="secondary" onClick={() => test.mutate()} loading={test.isPending} disabled={!draft.chain.length}>
              <FlaskConical /> Test connectivity
            </Button>
            <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty || invalid}>
              {dirty ? 'Save AI settings' : 'Saved'}
            </Button>
          </>
        }
      />

      {dirty ? (
        <Notice tone="warn" className="mb-4">
          AI settings have unsaved changes. <Button variant="ghost" size="sm" onClick={() => setDraft(baseline)}>Discard changes</Button>
        </Notice>
      ) : null}

      <div className="stat-grid mb-4">
        <StatCard
          label="Operating mode"
          value={aiModeLabels[draft.mode]}
          unit=""
          foot={draft.mode === 'enhanced' ? 'Failures fall back to deterministic drafts' : 'No AI call will be attempted'}
          tone={modeTone}
          icon={Sparkles}
        />
        <StatCard
          label="Configured providers"
          value={configuredCount}
          unit={`of ${PROVIDER_IDS.length}`}
          foot="Key present or local endpoint set"
          tone={configuredCount > 0 ? 'success' : 'warn'}
          icon={KeyRound}
        />
        <StatCard
          label="Fallback chain"
          value={draft.chain.length}
          unit="providers"
          foot={draft.chain.length ? draft.chain.map((id) => PROVIDER_INFO[id].label).join(' → ') : 'Chain is empty'}
          tone={draft.chain.length ? 'accent' : 'danger'}
          icon={Gauge}
        />
        <StatCard
          label="Circuit breakers"
          value={openCircuits}
          unit="open"
          foot={openCircuits > 0 ? 'Failing providers are skipped until half-open probes succeed' : 'All circuits closed'}
          tone={openCircuits > 0 ? 'warn' : 'success'}
          icon={ShieldCheck}
        />
      </div>

      <div className="split-2">
        <div>
          <Panel title="Operating mode" sub="Choose how much AI involvement this workspace permits.">
            <div className="stack">
              <ModeOption
                active={draft.mode === 'enhanced'}
                title="AI enhanced"
                tone="purple"
                icon={Sparkles}
                onClick={() => setDraft({ ...draft, mode: 'enhanced' })}
                desc="Try the providers below in order. If every provider fails, times out, or hits the daily cap, the deterministic draft is used and an ai.fallback event is recorded."
              />
              <ModeOption
                active={draft.mode === 'off'}
                title="AI-free deterministic"
                tone="success"
                icon={ShieldCheck}
                onClick={() => setDraft({ ...draft, mode: 'off' })}
                desc="No provider is contacted. Templates, rule-based eligibility, scoring, routing, and email delivery all continue normally. This is fully offline."
              />
              <ModeOption
                active={draft.mode === 'simulated_outage'}
                title="Simulated AI outage"
                tone="warn"
                icon={CircleAlert}
                onClick={() => setDraft({ ...draft, mode: 'simulated_outage' })}
                desc="Every AI request fails deliberately. Use this to verify the fallback path, the event log, and daily metrics without disconnecting the network."
              />
            </div>
            {draft.mode !== 'enhanced' ? (
              <Notice tone="info" className="mt-3">
                In this mode no AI request leaves the machine, even if keys are stored. Keys remain in the keychain and can be used again by switching back
                to AI enhanced.
              </Notice>
            ) : null}
          </Panel>

          <Panel
            title="Provider chain"
            sub="Tried top to bottom. Unconfigured providers are skipped automatically."
            actions={
              <Badge tone={draft.mode === 'enhanced' ? 'purple' : 'neutral'}>{draft.mode === 'enhanced' ? 'Active order' : 'Stored order'}</Badge>
            }
            flush
          >
            {draft.chain.length === 0 ? (
              <div className="empty">
                <div className="empty-title">The chain is empty</div>
                <div className="empty-desc">Add at least one provider before saving. With no provider, enhanced mode cannot call a model.</div>
              </div>
            ) : (
              <div className="list">
                {draft.chain.map((provider, index) => {
                  const info = PROVIDER_INFO[provider]
                  const Icon = info.icon
                  const state = health.get(provider)
                  const configured = isConfigured(provider, draft, secretKeys)
                  return (
                    <div className="list-row" key={provider} style={{ alignItems: 'flex-start', paddingTop: 14, paddingBottom: 14 }}>
                      <span className="callout-index" style={{ width: 18, textAlign: 'left' }}>
                        {index + 1}
                      </span>
                      <Icon size={16} className={configured ? 'color-accent' : 'faint'} style={{ marginTop: 3, flex: 'none' }} />
                      <div className="list-row-main">
                        <div className="row wrap" style={{ gap: 8 }}>
                          <span className="strong small">{info.label}</span>
                          {info.local ? <Badge tone="success">Local</Badge> : <Badge tone="info">Cloud</Badge>}
                          {configured ? <Badge tone="success">Configured</Badge> : <Badge tone="warn">Needs setup</Badge>}
                          {state ? (
                            <Badge
                              tone={state.circuitState === 'closed' ? 'success' : state.circuitState === 'half_open' ? 'warn' : 'danger'}
                            >
                              Circuit {state.circuitState.replace('_', '-')}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="tiny faint mt-2" style={{ lineHeight: 1.6 }}>
                          Model <span className="mono">{draft.models[provider] || info.model}</span>
                          {state?.lastSuccessAt ? ` · last success ${timeAgo(state.lastSuccessAt)}` : ' · no successful call yet'}
                          {state && state.consecutiveFailures > 0 ? ` · ${plural(state.consecutiveFailures, 'consecutive failure')}` : ''}
                          <br />
                          {info.description}
                        </div>
                        {state?.lastError ? <div className="tiny color-red mt-2 truncate" title={state.lastError}>{state.lastError}</div> : null}
                      </div>
                      <div className="row" style={{ gap: 2, flex: 'none' }}>
                        <Button size="sm" variant="ghost" iconOnly aria-label={`Move ${info.label} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                          <ArrowUp />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          iconOnly
                          aria-label={`Move ${info.label} down`}
                          disabled={index === draft.chain.length - 1}
                          onClick={() => move(index, 1)}
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          iconOnly
                          aria-label={`Remove ${info.label} from chain`}
                          disabled={draft.chain.length === 1}
                          onClick={() => removeFromChain(provider)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {unused.length > 0 ? (
              <div className="row" style={{ padding: '12px 16px', borderTop: '1px solid var(--line-soft)', gap: 8 }}>
                <Select value={addProvider} onChange={(event) => setAddProvider(event.target.value as AiProviderId | '')} style={{ maxWidth: 280 }}>
                  <option value="">Add a provider to the chain…</option>
                  {unused.map((provider) => (
                    <option key={provider} value={provider}>
                      {PROVIDER_INFO[provider].label}
                    </option>
                  ))}
                </Select>
                <Button size="sm" variant="secondary" onClick={addToChain} disabled={!addProvider}>
                  <Plus /> Add
                </Button>
                <span className="spacer" />
                <span className="tiny faint">Not every configured provider needs to be in the chain.</span>
              </div>
            ) : null}
          </Panel>

          <Panel title="Models & runtime" sub="Applied to every request; provider-specific defaults are pre-filled.">
            <div className="grid-2">
              {PROVIDER_IDS.map((provider) => (
                <Field key={provider} label={PROVIDER_INFO[provider].label} hint={PROVIDER_INFO[provider].local ? 'Local model name' : 'API model identifier'}>
                  <Input
                    value={draft.models[provider] ?? ''}
                    onChange={(event) => setDraft({ ...draft, models: { ...draft.models, [provider]: event.target.value } })}
                    placeholder={PROVIDER_INFO[provider].model}
                    className="mono"
                  />
                </Field>
              ))}
            </div>
            <div className="divider" />
            <div className="grid-2">
              <Field label="Ollama base URL" hint="Local server address. No key is required.">
                <Input
                  value={draft.ollamaBaseUrl}
                  onChange={(event) => setDraft({ ...draft, ollamaBaseUrl: event.target.value })}
                  placeholder="http://127.0.0.1:11434"
                  className="mono"
                />
              </Field>
              <Field label="Compatible base URL" hint="OpenAI-compatible endpoint, without /chat/completions.">
                <Input
                  value={draft.compatibleBaseUrl}
                  onChange={(event) => setDraft({ ...draft, compatibleBaseUrl: event.target.value })}
                  placeholder="http://127.0.0.1:1234/v1"
                  className="mono"
                />
              </Field>
              <Field label="Request timeout" hint="Milliseconds before the provider is treated as failed.">
                <Input
                  type="number"
                  min={1000}
                  max={120_000}
                  step={500}
                  value={draft.timeoutMs}
                  onChange={(event) => setDraft({ ...draft, timeoutMs: clampInt(event.target.value, 1000, 120_000, draft.timeoutMs) })}
                />
              </Field>
              <Field label="Daily call cap" hint="Calls stop at this limit; deterministic drafting continues.">
                <Input
                  type="number"
                  min={0}
                  max={10_000}
                  value={draft.maxCallsPerDay}
                  onChange={(event) => setDraft({ ...draft, maxCallsPerDay: clampInt(event.target.value, 0, 10_000, draft.maxCallsPerDay) })}
                />
              </Field>
              <Field label="Maximum output tokens" hint="Upper bound per AI completion.">
                <Input
                  type="number"
                  min={64}
                  max={8192}
                  value={draft.maxOutputTokens}
                  onChange={(event) => setDraft({ ...draft, maxOutputTokens: clampInt(event.target.value, 64, 8192, draft.maxOutputTokens) })}
                />
              </Field>
              <Field label="Temperature" hint="0 is deterministic; 1 is most varied. Default is 0.2.">
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  value={draft.temperature}
                  onChange={(event) => {
                    const parsed = Number(event.target.value)
                    setDraft({ ...draft, temperature: Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : draft.temperature })
                  }}
                />
              </Field>
            </div>
            <SwitchRow
              title="Enhanced mode is enabled"
              desc="This is the same switch as the operating mode above. Off means identical pipeline behaviour without any AI request."
              checked={draft.mode === 'enhanced'}
              onCheckedChange={(checked) => setDraft({ ...draft, mode: checked ? 'enhanced' : 'off' })}
            />
          </Panel>
        </div>

        <div>
          <Panel title="Connectivity check" sub="Uses the saved chain, not unsaved edits.">
            {testResult ? (
              <div className="stack">
                <Notice tone={testResult.ok ? 'accent' : 'warn'} icon={testResult.ok ? CheckCircle2 : XCircle}>
                  <strong>{testResult.ok ? 'Provider answered' : 'No provider answered'}</strong>
                  <div className="small mt-2">
                    {testResult.ok
                      ? `${PROVIDER_INFO[testResult.provider!]?.label ?? testResult.provider} · ${testResult.model ?? 'model unknown'} · ${testResult.latencyMs} ms`
                      : testResult.error ?? 'The request failed before a provider could answer.'}
                  </div>
                  {testResult.text ? <div className="small mono mt-2">“{testResult.text.slice(0, 200)}”</div> : null}
                </Notice>
                <div className="tiny faint">
                  {testResult.reason ? `Failure reason: ${testResult.reason}. ` : ''}
                  A failed check never blocks discovery or drafting; the deterministic path takes over.
                </div>
              </div>
            ) : (
              <div className="small muted" style={{ lineHeight: 1.6 }}>
                Run a connectivity check to send a minimal “reply with OK” prompt through the saved chain. This verifies credentials, network reach, and
                model names. It does not send candidate data.
              </div>
            )}
            <div className="mt-3">
              <Button variant="secondary" onClick={() => test.mutate()} loading={test.isPending} disabled={!draft.chain.length}>
                <FlaskConical /> Run connectivity check
              </Button>
            </div>
            {dirty ? <div className="tiny faint mt-2">You have unsaved changes. Save first to test them.</div> : null}
          </Panel>

          <Panel title="Cloud credentials" sub="Stored in the macOS keychain through Electron safeStorage.">
            {secretsLoading ? (
              <PageLoading label="Reading keychain" />
            ) : (
              <div className="stack">
                {(['anthropic', 'openai', 'gemini', 'openai_compatible'] as AiProviderId[]).map((provider) => {
                  const info = PROVIDER_INFO[provider]
                  const present = secretKeys.includes(info.key!)
                  return (
                    <div key={provider} style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 12 }}>
                      <div className="row-between wrap" style={{ gap: 8 }}>
                        <div className="row" style={{ gap: 8 }}>
                          <KeyRound size={14} className={present ? 'color-green' : 'faint'} />
                          <span className="small strong">{info.label}</span>
                        </div>
                        <Badge tone={present ? 'success' : 'neutral'}>{present ? 'Key stored' : 'No key'}</Badge>
                      </div>
                      <div className="row mt-2" style={{ gap: 8 }}>
                        <Input
                          type="password"
                          autoComplete="off"
                          value={keyInputs[provider] ?? ''}
                          onChange={(event) => setKeyInputs((current) => ({ ...current, [provider]: event.target.value }))}
                          placeholder={present ? 'Replace stored key (never displayed)' : 'Paste API key'}
                          className="mono"
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => storeKey.mutate(provider)}
                          loading={storeKey.isPending && storeKey.variables === provider}
                          disabled={!(keyInputs[provider] ?? '').trim()}
                        >
                          Save key
                        </Button>
                      </div>
                      {present ? (
                        <button type="button" className="tiny color-red mt-2" style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }} onClick={() => setRemoveKeyFor(provider)}>
                          Remove stored key
                        </button>
                      ) : null}
                      {provider === 'openai_compatible' ? (
                        <div className="tiny faint mt-2">Requires the compatible base URL above and a key value; many local servers accept any non-empty string.</div>
                      ) : null}
                    </div>
                  )
                })}
                <div className="tiny faint">Ollama runs locally and needs no credential. A stored key is only used when its provider appears in the chain and enhanced mode is active.</div>
              </div>
            )}
            {secretsLoading ? null : <div className="mt-3 tiny faint">{plural(secretKeys.filter((key) => key.startsWith('ai.')).length, 'AI credential')} present in the keychain.</div>}
          </Panel>

          <Panel title="Provider health" sub={statusLoading ? 'Refreshing…' : 'Circuit state is stored locally and survives restarts.'} flush>
            {status.length === 0 ? (
              <div className="small muted" style={{ padding: 16 }}>
                No provider has been called yet. Health entries appear after the first attempt.
              </div>
            ) : (
              <div className="list">
                {status.map((item) => (
                  <div className="list-row" key={item.id}>
                    <StatusDot
                      tone={item.circuitState === 'open' ? 'err' : item.circuitState === 'half_open' ? 'warn' : item.configured ? 'success' : 'idle'}
                    />
                    <div className="list-row-main">
                      <div className="small strong">{item.label}</div>
                      <div className="tiny faint">
                        {item.model || 'model not set'} · {item.lastSuccessAt ? `last success ${timeAgo(item.lastSuccessAt)}` : 'no success recorded'}
                      </div>
                      {item.lastError ? <div className="tiny color-red truncate">{item.lastError}</div> : null}
                    </div>
                    <Badge tone={item.circuitState === 'closed' ? 'success' : item.circuitState === 'half_open' ? 'warn' : 'danger'}>
                      {item.circuitState.replace('_', '-')}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Notice tone="info">
            AI output is treated as untrusted text. It can never change an eligibility verdict, remove a hard requirement, invent an email address, or approve
            an application. A human approval gate remains in force unless you explicitly disable it.
          </Notice>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(removeKeyFor)}
        onOpenChange={(open) => {
          if (!open) setRemoveKeyFor(null)
        }}
        title="Remove this API key?"
        description={
          removeKeyFor ? (
            <>
              The key for <strong>{PROVIDER_INFO[removeKeyFor].label}</strong> will be deleted from the macOS keychain. The provider will be skipped in the
              chain until a new key is stored. Other providers are unaffected.
            </>
          ) : null
        }
        confirmLabel="Remove key"
        busy={deleteKey.isPending}
        onConfirm={() => {
          if (removeKeyFor) deleteKey.mutate(removeKeyFor)
        }}
      />
    </>
  )
}

function ModeOption({
  active,
  title,
  desc,
  tone,
  icon: Icon,
  onClick
}: {
  active: boolean
  title: string
  desc: string
  tone: 'purple' | 'success' | 'warn'
  icon: LucideIcon
  onClick: () => void
}) {
  const color = tone === 'purple' ? 'var(--purple)' : tone === 'success' ? 'var(--green)' : 'var(--yellow)'
  return (
    <button
      type="button"
      onClick={onClick}
      className="application-card"
      style={{
        textAlign: 'left',
        cursor: 'pointer',
        borderColor: active ? color : undefined,
        background: active ? `color-mix(in srgb, ${color} 7%, var(--panel))` : undefined,
        display: 'block',
        width: '100%',
        color: 'inherit'
      }}
    >
      <div className="row-between">
        <div className="row" style={{ gap: 8 }}>
          <Icon size={15} style={{ color }} />
          <span className="strong">{title}</span>
        </div>
        <span className="badge" style={{ borderColor: active ? color : undefined, color: active ? color : undefined }}>
          {active ? 'Active' : 'Choose'}
        </span>
      </div>
      <div className="small muted mt-2" style={{ lineHeight: 1.6 }}>
        {desc}
      </div>
    </button>
  )
}

function isConfigured(provider: AiProviderId, settings: AiSettings, secretKeys: string[]): boolean {
  if (provider === 'ollama') return settings.ollamaBaseUrl.trim().length > 0
  if (provider === 'openai_compatible') return settings.compatibleBaseUrl.trim().length > 0 && secretKeys.includes('ai.openai_compatible')
  return secretKeys.includes(`ai.${provider}`)
}

function clampInt(value: string, min: number, max: number, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}
