import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Ban,
  BellRing,
  CheckCircle2,
  CircleAlert,
  Gauge,
  Inbox,
  KeyRound,
  Lock,
  Mail,
  Save,
  Send,
  ShieldCheck,
  Timer,
  Workflow,
  XCircle
} from 'lucide-react'
import type { MailStatusDTO, OutboxDTO } from '@shared/api'
import type { ApplicationChannel } from '@shared/types'
import type { AppSettings, AutomationSettings, DigestSettings, OutboundSettings } from '@shared/settings'
import { call } from '../lib/api'
import { channelMeta, fmtDateTime, outboxStatusMeta, plural, timeAgo } from '../lib/format'
import {
  Badge,
  Button,
  ChipEditor,
  ConfirmDialog,
  Field,
  Input,
  Notice,
  PageError,
  PageHeader,
  PageLoading,
  Panel,
  StatCard,
  SwitchRow,
  useToast
} from '../components/ui'

const CHANNELS: ApplicationChannel[] = ['email', 'web', 'manual']

export default function Automation() {
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => call('settings.get'), staleTime: 10_000 })
  const mail = useQuery({ queryKey: ['mail'], queryFn: () => call('mail.status'), refetchInterval: 30_000 })
  const secrets = useQuery({ queryKey: ['secrets'], queryFn: () => call('secrets.list'), staleTime: 10_000 })
  const outbox = useQuery({ queryKey: ['outbox', 'recent'], queryFn: () => call('outbox.list', { limit: 6 }), staleTime: 15_000 })

  if (settings.isLoading && !settings.data) return <PageLoading label="Reading delivery settings" />
  if (settings.error) return <PageError error={settings.error} onRetry={() => settings.refetch()} />

  return (
    <Workspace
      initial={settings.data!}
      mail={mail.data ?? null}
      secretKeys={secrets.data ?? []}
      outbox={outbox.data ?? []}
      outboxLoading={outbox.isLoading}
    />
  )
}

function Workspace({
  initial,
  mail,
  secretKeys,
  outbox,
  outboxLoading
}: {
  initial: AppSettings
  mail: MailStatusDTO | null
  secretKeys: string[]
  outbox: OutboxDTO[]
  outboxLoading: boolean
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [automation, setAutomation] = useState<AutomationSettings>(initial.automation)
  const [automationBase, setAutomationBase] = useState<AutomationSettings>(initial.automation)
  const [outbound, setOutbound] = useState<OutboundSettings>(initial.outbound)
  const [outboundBase, setOutboundBase] = useState<OutboundSettings>(initial.outbound)
  const [digest, setDigest] = useState<DigestSettings>(initial.digest)
  const [digestBase, setDigestBase] = useState<DigestSettings>(initial.digest)
  const [passwordInput, setPasswordInput] = useState('')
  const [removePassword, setRemovePassword] = useState(false)
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; mode: 'mock' | 'smtp'; message: string } | null>(null)

  const automationDirty = useMemo(() => JSON.stringify(automation) !== JSON.stringify(automationBase), [automation, automationBase])
  const outboundDirty = useMemo(() => JSON.stringify(outbound) !== JSON.stringify(outboundBase), [outbound, outboundBase])
  const digestDirty = useMemo(() => JSON.stringify(digest) !== JSON.stringify(digestBase), [digest, digestBase])
  const passwordPresent = secretKeys.includes('smtp.password')
  const digestValid = !digest.enabled || /^\d{2}:\d{2}$/.test(digest.time)
  const autoQueues = !automation.requireApproval || automation.unattendedEnabled
  const mode = mail?.mode ?? (outbound.killSwitch ? 'mock' : outbound.mode === 'mock' ? 'mock' : outbound.smtp.host ? 'smtp' : 'mock')

  // Keep an untouched form in sync with changes made elsewhere (for example the
  // top-bar pause control) without ever overwriting a local edit.
  useEffect(() => {
    if (automationDirty) return
    setAutomation(initial.automation)
    setAutomationBase(initial.automation)
  }, [initial.automation])

  useEffect(() => {
    if (outboundDirty) return
    setOutbound(initial.outbound)
    setOutboundBase(initial.outbound)
  }, [initial.outbound])

  useEffect(() => {
    if (digestDirty) return
    setDigest(initial.digest)
    setDigestBase(initial.digest)
  }, [initial.digest])

  const refreshMail = () => {
    void queryClient.invalidateQueries({ queryKey: ['mail'] })
    void queryClient.invalidateQueries({ queryKey: ['secrets'] })
    void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    void queryClient.invalidateQueries({ queryKey: ['diagnostics'] })
    void queryClient.invalidateQueries({ queryKey: ['outbox'] })
  }

  const save = useMutation({
    mutationFn: (input: { section: 'automation' | 'outbound' | 'digest'; value: unknown }) =>
      call('settings.save', { section: input.section, value: input.value }),
    onSuccess: (result, input) => {
      if (input.section === 'automation') {
        setAutomation(result.automation)
        setAutomationBase(result.automation)
      }
      if (input.section === 'outbound') {
        setOutbound(result.outbound)
        setOutboundBase(result.outbound)
      }
      if (input.section === 'digest') {
        setDigest(result.digest)
        setDigestBase(result.digest)
      }
      toast.success(`${input.section === 'digest' ? 'Digest' : input.section === 'outbound' ? 'Delivery' : 'Automation'} settings saved.`)
      refreshMail()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const storePassword = useMutation({
    mutationFn: () => call('secrets.set', { key: 'smtp.password', value: passwordInput.trim() }),
    onSuccess: () => {
      setPasswordInput('')
      toast.success('SMTP app password stored in the macOS keychain.')
      refreshMail()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const deletePassword = useMutation({
    mutationFn: () => call('secrets.delete', { key: 'smtp.password' }),
    onSuccess: () => {
      setRemovePassword(false)
      toast.success('SMTP password removed from the keychain.')
      refreshMail()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const verify = useMutation({
    mutationFn: () => call('mail.verify'),
    onSuccess: (result) => {
      setVerifyResult(result)
      toast[result.ok ? 'success' : 'error'](result.message)
      refreshMail()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const toggleChannel = (channel: ApplicationChannel) => {
    const current = automation.allowedChannels
    setAutomation({
      ...automation,
      allowedChannels: current.includes(channel) ? current.filter((item) => item !== channel) : [...current, channel]
    })
  }

  const smtpReady = Boolean(outbound.smtp.host && outbound.smtp.user && outbound.smtp.fromEmail && passwordPresent)

  return (
    <>
      <PageHeader
        eyebrow="Guardrails"
        title="Automation & outbound"
        desc="Decide what runs without you, how many applications leave per day, and whether email is simulated or sent through your own SMTP account. Every guardrail is enforced in the main process, not just the interface."
        actions={
          <Link to="/queue">
            <Button variant="secondary">
              <Workflow /> Delivery queue
            </Button>
          </Link>
        }
      />

      {outbound.killSwitch ? (
        <Notice tone="warn" className="mb-4" icon={Lock}>
          <strong>The outbound kill switch is on.</strong> No message can leave this Mac, even if SMTP is fully configured. Application emails are written to the
          local mock outbox for inspection. Turn the switch off deliberately before any live send.
        </Notice>
      ) : null}
      {autoQueues ? (
        <Notice tone="danger" className="mb-4" icon={CircleAlert}>
          <strong>Human approval is bypassed.</strong> With the current switches, eligible drafts are queued for delivery without waiting for you. If you want
          to review every message, enable <em>Require approval</em> and disable <em>Unattended auto-queue</em>.
        </Notice>
      ) : null}

      <div className="stat-grid mb-4">
        <StatCard
          label="Delivery adapter"
          value={mode === 'smtp' ? 'Live SMTP' : 'Mock outbox'}
          foot={mail?.message ?? (outbound.killSwitch ? 'Kill switch forces mock mode' : 'Messages stay local when SMTP is incomplete')}
          tone={mode === 'smtp' ? 'success' : 'warn'}
          icon={Mail}
        />
        <StatCard
          label="Approval gate"
          value={autoQueues ? 'Automatic' : 'Human review'}
          foot={autoQueues ? 'Drafts queue without a human decision' : 'Every draft waits in Approvals'}
          tone={autoQueues ? 'danger' : 'success'}
          icon={ShieldCheck}
        />
        <StatCard
          label="Daily limit"
          value={automation.dailyApplicationLimit}
          unit={automation.dailyApplicationLimit === 1 ? 'application' : 'applications'}
          foot={`${automation.maxApplicationsPerCompanyPerDay} per company · minimum score ${automation.minScore}`}
          tone="info"
          icon={Gauge}
        />
        <StatCard
          label="Allowed channels"
          value={automation.allowedChannels.length === 0 ? 'None' : automation.allowedChannels.map((item) => channelMeta[item].label).join(' · ')}
          foot={automation.allowedChannels.length === 0 ? 'Every delivery will stop for review' : 'Other channels become “needs you”'}
          tone={automation.allowedChannels.length === 0 ? 'danger' : 'accent'}
          icon={Send}
        />
      </div>

      <div className="split-2">
        <div>
          <Panel
            title="Automation policy"
            sub="Applied when a job is evaluated and again when a delivery is attempted."
            actions={
              <Button size="sm" variant="primary" onClick={() => save.mutate({ section: 'automation', value: automation })} loading={save.isPending && save.variables?.section === 'automation'} disabled={!automationDirty}>
                <Save /> Save policy
              </Button>
            }
          >
            <div className="stack">
              <SwitchRow
                title="Pause all automation"
                desc="Stops discovery tasks, drafting, and delivery immediately. Existing drafts and records stay intact. This is the same switch as the top bar."
                checked={automation.paused}
                onCheckedChange={(checked) => setAutomation({ ...automation, paused: checked })}
              />
              <SwitchRow
                title="Require human approval"
                desc="A drafted application stops in Approvals until you approve it. This is the safest setting and is on by default."
                checked={automation.requireApproval}
                onCheckedChange={(checked) => setAutomation({ ...automation, requireApproval: checked })}
              />
              <SwitchRow
                title="Unattended auto-queue"
                desc="When enabled, drafts are queued for delivery without approval even if the approval switch is on. The daily caps and channel rules still apply."
                checked={automation.unattendedEnabled}
                onCheckedChange={(checked) => setAutomation({ ...automation, unattendedEnabled: checked })}
              />
              <div className="divider" />
              <div className="grid-2">
                <Field label="Applications per day" hint="Maximum successful submissions across all channels. Minimum 1.">
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={automation.dailyApplicationLimit}
                    onChange={(event) =>
                      setAutomation({ ...automation, dailyApplicationLimit: clampInt(event.target.value, 1, 100, automation.dailyApplicationLimit) })
                    }
                  />
                </Field>
                <Field label="Applications per company per day" hint="Prevents repeated applications to the same employer in one day. Minimum 1.">
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={automation.maxApplicationsPerCompanyPerDay}
                    onChange={(event) =>
                      setAutomation({
                        ...automation,
                        maxApplicationsPerCompanyPerDay: clampInt(event.target.value, 1, 20, automation.maxApplicationsPerCompanyPerDay)
                      })
                    }
                  />
                </Field>
                <Field label="Minimum match score" hint="Jobs below this score are recorded but not drafted. 0 disables the threshold; 100 requires a perfect score.">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={automation.minScore}
                    onChange={(event) => setAutomation({ ...automation, minScore: clampInt(event.target.value, 0, 100, automation.minScore) })}
                  />
                </Field>
                <Field label="Allowed application channels" hint="Removing a channel does not delete existing records; new deliveries on that channel stop for review.">
                  <div className="row wrap" style={{ gap: 6 }}>
                    {CHANNELS.map((channel) => {
                      const active = automation.allowedChannels.includes(channel)
                      return (
                        <button
                          key={channel}
                          type="button"
                          className="chip"
                          aria-pressed={active}
                          onClick={() => toggleChannel(channel)}
                          style={{
                            cursor: 'pointer',
                            borderColor: active ? 'color-mix(in srgb, var(--accent) 50%, transparent)' : undefined,
                            background: active ? 'var(--accent-soft)' : undefined,
                            color: active ? 'var(--accent)' : undefined
                          }}
                        >
                          {channelMeta[channel].label}
                          {active ? <CheckCircle2 size={11} /> : null}
                        </button>
                      )
                    })}
                  </div>
                </Field>
              </div>
              <Field label="Excluded companies" hint="Case-insensitive company names. No application is ever drafted for these employers.">
                <ChipEditor
                  values={automation.excludeCompanies}
                  onChange={(values) => setAutomation({ ...automation, excludeCompanies: values })}
                  placeholder="Add a company name and press Enter"
                />
              </Field>
              {automation.allowedChannels.length === 0 ? (
                <Notice tone="danger" icon={Ban}>
                  No channel is allowed. Application delivery will stop and every draft will be marked as needing you.
                </Notice>
              ) : null}
              {automationDirty ? <div className="tiny faint">Unsaved changes to automation policy.</div> : null}
            </div>
          </Panel>

          <Panel
            title="Email delivery"
            sub="SMTP uses your own provider with an app password. Mock writes exact .eml files locally."
            actions={
              <Button size="sm" variant="primary" onClick={() => save.mutate({ section: 'outbound', value: outbound })} loading={save.isPending && save.variables?.section === 'outbound'} disabled={!outboundDirty}>
                <Save /> Save delivery
              </Button>
            }
          >
            <div className="stack">
              <SwitchRow
                title="Outbound kill switch"
                desc="Forces mock delivery regardless of the selected adapter. This is a hard block in the mail service, so no code path can bypass it while it is on."
                checked={outbound.killSwitch}
                onCheckedChange={(checked) => setOutbound({ ...outbound, killSwitch: checked })}
              />
              <div className="row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="application-card"
                  onClick={() => setOutbound({ ...outbound, mode: 'mock' })}
                  style={{
                    flex: 1,
                    cursor: 'pointer',
                    textAlign: 'left',
                    borderColor: outbound.mode === 'mock' ? 'color-mix(in srgb, var(--accent) 50%, transparent)' : undefined,
                    color: 'inherit'
                  }}
                >
                  <div className="row-between">
                    <span className="strong small">Mock outbox</span>
                    {outbound.mode === 'mock' ? <Badge tone="accent">Selected</Badge> : null}
                  </div>
                  <div className="tiny faint mt-2">Writes a complete .eml file to the app data folder. Nothing is transmitted.</div>
                </button>
                <button
                  type="button"
                  className="application-card"
                  onClick={() => setOutbound({ ...outbound, mode: 'smtp' })}
                  style={{
                    flex: 1,
                    cursor: 'pointer',
                    textAlign: 'left',
                    borderColor: outbound.mode === 'smtp' ? 'color-mix(in srgb, var(--accent) 50%, transparent)' : undefined,
                    color: 'inherit'
                  }}
                >
                  <div className="row-between">
                    <span className="strong small">SMTP</span>
                    {outbound.mode === 'smtp' ? <Badge tone="accent">Selected</Badge> : null}
                  </div>
                  <div className="tiny faint mt-2">Sends from your own mailbox. Requires host, user, from address, and an app password.</div>
                </button>
              </div>

              <div className="grid-2">
                <Field label="SMTP host" hint="For example smtp.fastmail.com.">
                  <Input
                    value={outbound.smtp.host}
                    onChange={(event) => setOutbound({ ...outbound, smtp: { ...outbound.smtp, host: event.target.value } })}
                    placeholder="smtp.example.com"
                    className="mono"
                  />
                </Field>
                <Field label="Port" hint="587 with STARTTLS is typical; 465 for implicit TLS.">
                  <Input
                    type="number"
                    min={1}
                    max={65535}
                    value={outbound.smtp.port}
                    onChange={(event) => setOutbound({ ...outbound, smtp: { ...outbound.smtp, port: clampInt(event.target.value, 1, 65535, outbound.smtp.port) } })}
                  />
                </Field>
                <Field label="Username" hint="Usually the full email address.">
                  <Input
                    value={outbound.smtp.user}
                    onChange={(event) => setOutbound({ ...outbound, smtp: { ...outbound.smtp, user: event.target.value } })}
                    autoComplete="off"
                    className="mono"
                  />
                </Field>
                <Field label="From address" hint="Must be an address your SMTP account may send as.">
                  <Input
                    value={outbound.smtp.fromEmail}
                    onChange={(event) => setOutbound({ ...outbound, smtp: { ...outbound.smtp, fromEmail: event.target.value } })}
                    placeholder="you@example.com"
                    autoComplete="off"
                  />
                </Field>
                <Field label="From name" hint="Shown in the recipient’s inbox.">
                  <Input
                    value={outbound.smtp.fromName}
                    onChange={(event) => setOutbound({ ...outbound, smtp: { ...outbound.smtp, fromName: event.target.value } })}
                    placeholder="Your name"
                  />
                </Field>
                <Field label="Encryption" hint="Implicit TLS on port 465; turn off for STARTTLS on 587.">
                  <SwitchRow
                    title="Implicit TLS"
                    desc={outbound.smtp.secure ? 'secure: true' : 'secure: false (STARTTLS where available)'}
                    checked={outbound.smtp.secure}
                    onCheckedChange={(checked) => setOutbound({ ...outbound, smtp: { ...outbound.smtp, secure: checked } })}
                  />
                </Field>
              </div>

              <div className="divider" />
              <div>
                <div className="row-between wrap" style={{ gap: 8 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <KeyRound size={14} className={passwordPresent ? 'color-green' : 'faint'} />
                    <span className="small strong">SMTP app password</span>
                    <Badge tone={passwordPresent ? 'success' : 'neutral'}>{passwordPresent ? 'Stored in keychain' : 'Not stored'}</Badge>
                  </div>
                  {passwordPresent ? (
                    <button
                      type="button"
                      className="tiny color-red"
                      style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
                      onClick={() => setRemovePassword(true)}
                    >
                      Remove password
                    </button>
                  ) : null}
                </div>
                <div className="row mt-2" style={{ gap: 8 }}>
                  <Input
                    type="password"
                    value={passwordInput}
                    onChange={(event) => setPasswordInput(event.target.value)}
                    placeholder={passwordPresent ? 'Replace stored app password' : 'Paste an app password, not your account password'}
                    autoComplete="off"
                    className="mono"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => storePassword.mutate()}
                    loading={storePassword.isPending}
                    disabled={!passwordInput.trim()}
                  >
                    Save password
                  </Button>
                </div>
                <div className="tiny faint mt-2">
                  The password is encrypted with Electron safeStorage and never appears in logs, exports, or the interface. Generate a dedicated app password
                  in your mail provider; do not use your primary account password.
                </div>
              </div>

              <div className="row-between wrap mt-2">
                <Button
                  variant="secondary"
                  onClick={() => verify.mutate()}
                  loading={verify.isPending}
                  disabled={outboundDirty}
                  title={outboundDirty ? 'Save delivery settings before verifying' : 'Verify the saved SMTP login'}
                >
                  <Mail /> Verify SMTP
                </Button>
                <span className="small muted">
                  {smtpReady ? 'SMTP fields and password present' : 'Incomplete SMTP configuration will stay in mock mode'}
                  {outboundDirty ? ' · save first to verify changes' : ''}
                </span>
              </div>
              {verifyResult ? (
                <Notice tone={verifyResult.ok ? 'accent' : 'danger'} icon={verifyResult.ok ? CheckCircle2 : XCircle}>
                  <strong>{verifyResult.mode === 'mock' ? 'Mock mode verified' : verifyResult.ok ? 'SMTP verified' : 'SMTP verification failed'}</strong>
                  <div className="small mt-2">{verifyResult.message}</div>
                </Notice>
              ) : null}
              {outboundDirty ? <div className="tiny faint">Unsaved changes to delivery settings.</div> : null}
            </div>
          </Panel>

          <Panel
            title="Daily digest"
            sub="A local summary of submitted applications, backlog, and items needing attention."
            actions={
              <Button size="sm" variant="primary" onClick={() => save.mutate({ section: 'digest', value: digest })} loading={save.isPending && save.variables?.section === 'digest'} disabled={!digestDirty || !digestValid}>
                <Save /> Save digest
              </Button>
            }
          >
            <div className="stack">
              <SwitchRow
                title="Generate the digest every day"
                desc="Queues a digest task at the selected local time. The digest is stored in the daily-report archive."
                checked={digest.enabled}
                onCheckedChange={(checked) => setDigest({ ...digest, enabled: checked })}
              />
              <div className="grid-2">
                <Field label="Local time" hint="24-hour time in the system time zone.">
                  <Input
                    type="time"
                    value={digest.time}
                    onChange={(event) => setDigest({ ...digest, time: event.target.value })}
                    disabled={!digest.enabled}
                  />
                </Field>
                <Field label="Desktop notification" hint="Shows a native notification when the digest is generated.">
                  <SwitchRow
                    title="Notify on generation"
                    desc="Only the headline and counts are shown; no candidate details."
                    checked={digest.notify}
                    onCheckedChange={(checked) => setDigest({ ...digest, notify: checked })}
                    disabled={!digest.enabled}
                  />
                </Field>
              </div>
              <div className="row small muted" style={{ gap: 8 }}>
                <BellRing size={13} /> The digest is also readable from <Link to="/daily" className="color-accent">Daily report</Link>.
              </div>
              {digest.enabled && !digestValid ? (
                <Notice tone="warn">Choose a valid 24-hour time before saving the digest.</Notice>
              ) : null}
              {digestDirty ? <div className="tiny faint">Unsaved changes to digest settings.</div> : null}
            </div>
          </Panel>
        </div>

        <div>
          <Panel title="Delivery status" sub="Live from the main-process mail service.">
            <div className="stack">
              <div className="row-between">
                <span className="small muted">Effective adapter</span>
                <Badge tone={mode === 'smtp' ? 'success' : 'warn'}>{mode === 'smtp' ? 'SMTP live' : 'Mock outbox'}</Badge>
              </div>
              <div className="row-between">
                <span className="small muted">Kill switch</span>
                <Badge tone={outbound.killSwitch ? 'danger' : 'neutral'}>{outbound.killSwitch ? 'Engaged' : 'Off'}</Badge>
              </div>
              <div className="row-between">
                <span className="small muted">SMTP configured</span>
                <span className="small">{smtpReady ? 'Yes' : 'No'}</span>
              </div>
              <div className="row-between">
                <span className="small muted">App password</span>
                <span className="small">{passwordPresent ? 'Stored in keychain' : 'Missing'}</span>
              </div>
              <div className="row-between">
                <span className="small muted">From address</span>
                <span className="mono tiny">{outbound.smtp.fromEmail || 'not set'}</span>
              </div>
              <div className="divider" />
              <div className="small muted" style={{ lineHeight: 1.6 }}>{mail?.message ?? 'Mail status is loading.'}</div>
            </div>
          </Panel>

          <Panel
            title="Recent outbox"
            sub="The exact messages the dispatcher attempted."
            actions={
              <Link to="/applications">
                <Button size="sm" variant="ghost">
                  Open applications
                </Button>
              </Link>
            }
            flush
          >
            {outboxLoading ? (
              <PageLoading label="Reading outbox" />
            ) : outbox.length === 0 ? (
              <div className="empty">
                <Inbox size={20} className="faint" />
                <div className="empty-title">No messages yet</div>
                <div className="empty-desc">Outbox records appear when an application is dispatched, in mock or SMTP mode.</div>
              </div>
            ) : (
              <div className="list">
                {outbox.map((message) => (
                  <div className="list-row" key={message.id} style={{ alignItems: 'flex-start' }}>
                    <div className="list-row-main">
                      <div className="row wrap" style={{ gap: 6 }}>
                        <span className="small strong truncate">{message.subject}</span>
                        <Badge tone={outboxStatusMeta[message.status].tone}>{outboxStatusMeta[message.status].label}</Badge>
                      </div>
                      <div className="tiny faint mt-2">
                        {message.adapter === 'mock' ? 'Mock' : 'SMTP'} · {message.toAddress} · attempt {message.attempt}
                        <br />
                        {message.sentAt ? `Sent ${fmtDateTime(message.sentAt)}` : `Queued ${timeAgo(message.queuedAt)}`}
                      </div>
                      {message.error ? <div className="tiny color-red mt-2">{message.error}</div> : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Safety envelope" sub="Controls that cannot be bypassed by the interface.">
            <div className="stack small muted" style={{ lineHeight: 1.65 }}>
              <div className="row" style={{ alignItems: 'flex-start', gap: 9 }}>
                <Lock size={14} className="color-green" style={{ marginTop: 2, flex: 'none' }} />
                <span>Secrets and the database stay on this Mac. There is no cloud account and no remote sync.</span>
              </div>
              <div className="row" style={{ alignItems: 'flex-start', gap: 9 }}>
                <ShieldCheck size={14} className="color-green" style={{ marginTop: 2, flex: 'none' }} />
                <span>Eligibility uses stored citizenship and work-authorization records. A missing fact never becomes an optimistic guess.</span>
              </div>
              <div className="row" style={{ alignItems: 'flex-start', gap: 9 }}>
                <Ban size={14} className="color-green" style={{ marginTop: 2, flex: 'none' }} />
                <span>No CAPTCHA solving, no login automation, and no invented email addresses. Web applications become guided runs that you complete yourself.</span>
              </div>
              <div className="row" style={{ alignItems: 'flex-start', gap: 9 }}>
                <Timer size={14} className="color-green" style={{ marginTop: 2, flex: 'none' }} />
                <span>Daily and per-company caps are checked at dispatch time, immediately before any message is handed to the adapter.</span>
              </div>
              <div className="row" style={{ alignItems: 'flex-start', gap: 9 }}>
                <Workflow size={14} className="color-green" style={{ marginTop: 2, flex: 'none' }} />
                <span>Every delivery uses a transactional outbox with an idempotency key, so a restart cannot silently double-send a message.</span>
              </div>
            </div>
            <div className="divider" />
            <div className="tiny faint">
              {plural(outbox.length, 'message')} in the recent window. Delivery attempts are also recorded in the{' '}
              <Link to="/activity" className="color-accent">
                activity log
              </Link>
              .
            </div>
          </Panel>
        </div>
      </div>

      <ConfirmDialog
        open={removePassword}
        onOpenChange={setRemovePassword}
        title="Remove the SMTP password?"
        description="Live SMTP will stop working immediately and delivery will fall back to the mock outbox. The rest of your SMTP settings are kept. This cannot be undone."
        confirmLabel="Remove password"
        busy={deletePassword.isPending}
        onConfirm={() => deletePassword.mutate()}
      />
    </>
  )
}

function clampInt(value: string, min: number, max: number, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}
