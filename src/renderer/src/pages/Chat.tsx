import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BellRing,
  CheckCircle2,
  CircleAlert,
  Copy,
  FlaskConical,
  KeyRound,
  Link2,
  Lock,
  MessageCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  Terminal,
  XCircle,
  type LucideIcon
} from 'lucide-react'
import type { ChatPageDTO, ChatProviderStatusDTO, ChatTestResultDTO } from '@shared/api'
import type { ChatSettings } from '@shared/settings'
import { call } from '../lib/api'
import { plural, timeAgo } from '../lib/format'
import { keychainName } from '../lib/platform'
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
  StatCard,
  SwitchRow,
  cx,
  useToast
} from '../components/ui'

type ChatProviderId = 'telegram' | 'whatsapp'

const SECRETS = {
  telegramToken: 'chat.telegram.botToken',
  whatsappAccessToken: 'chat.whatsapp.accessToken',
  whatsappVerifyToken: 'chat.whatsapp.verifyToken',
  whatsappAppSecret: 'chat.whatsapp.appSecret'
} as const

const SECRET_LABELS: Record<string, string> = {
  [SECRETS.telegramToken]: 'Telegram bot token',
  [SECRETS.whatsappAccessToken]: 'WhatsApp access token',
  [SECRETS.whatsappVerifyToken]: 'WhatsApp verify token',
  [SECRETS.whatsappAppSecret]: 'WhatsApp app secret'
}

export default function Chat() {
  const page = useQuery({
    queryKey: ['chat'],
    queryFn: () => call('chat.page'),
    staleTime: 10_000,
    refetchInterval: 30_000
  })

  if (page.isLoading && !page.data) return <PageLoading label="Reading chat configuration" />
  if (page.error) return <PageError error={page.error} onRetry={() => page.refetch()} />

  return <ChatWorkspace page={page.data!} />
}

function ChatWorkspace({ page }: { page: ChatPageDTO }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [baseline, setBaseline] = useState<ChatSettings>(page.settings)
  const [draft, setDraft] = useState<ChatSettings>(page.settings)
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({})
  const [removeSecret, setRemoveSecret] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Partial<Record<ChatProviderId, ChatTestResultDTO>>>({})
  const [sendResults, setSendResults] = useState<Partial<Record<ChatProviderId, ChatTestResultDTO>>>({})
  const [advanced, setAdvanced] = useState<Record<ChatProviderId, boolean>>({ telegram: false, whatsapp: false })
  const [consoleText, setConsoleText] = useState('')
  const [transcript, setTranscript] = useState<{ role: 'you' | 'bot'; text: string; failed?: boolean }[]>([
    { role: 'bot', text: 'Type /status or /help. Commands run locally against the same database, and every state change is recorded in Activity.' }
  ])
  const [showAllCommands, setShowAllCommands] = useState(false)

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [draft, baseline])
  const problems = useMemo(() => validateChatSettings(draft), [draft])

  useEffect(() => {
    if (dirty) return
    setBaseline(page.settings)
    setDraft(page.settings)
  }, [page.settings])

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['chat'] })
    void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
    void queryClient.invalidateQueries({ queryKey: ['secrets'] })
    void queryClient.invalidateQueries({ queryKey: ['diagnostics'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const save = useMutation({
    mutationFn: () => call('chat.save', { settings: draft }),
    onSuccess: (result) => {
      setBaseline(result.settings)
      setDraft(result.settings)
      queryClient.setQueryData(['chat'], result)
      toast.success('Chat settings saved.')
      refresh()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const storeSecret = useMutation({
    mutationFn: (input: { key: string; value: string }) => call('secrets.set', input),
    onSuccess: (_keys, input) => {
      setSecretInputs((current) => ({ ...current, [input.key]: '' }))
      toast.success(`${SECRET_LABELS[input.key] ?? 'Secret'} stored in ${keychainName}.`)
      refresh()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const deleteSecret = useMutation({
    mutationFn: (key: string) => call('secrets.delete', { key }),
    onSuccess: (_keys, key) => {
      toast.success(`${SECRET_LABELS[key] ?? 'Secret'} removed.`)
      setRemoveSecret(null)
      refresh()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const test = useMutation({
    mutationFn: (provider: ChatProviderId) => call('chat.test', { provider }),
    onSuccess: (result, provider) => {
      setTestResults((current) => ({ ...current, [provider]: result }))
      toast[result.ok ? 'success' : 'error'](result.message)
      refresh()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const sendTest = useMutation({
    mutationFn: (provider: ChatProviderId) => call('chat.sendTest', { provider }),
    onSuccess: (result, provider) => {
      setSendResults((current) => ({ ...current, [provider]: result }))
      toast[result.ok ? 'success' : 'error'](result.message)
      refresh()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const runCommand = useMutation({
    mutationFn: (text: string) => call('chat.command', { text }),
    onSuccess: (result, text) => {
      setTranscript((current) => [...current, { role: 'you', text }, { role: 'bot', text: result.reply, failed: !result.ok }])
      setConsoleText('')
      refresh()
    },
    onError: (error, text) => {
      setTranscript((current) => [
        ...current,
        { role: 'you', text },
        { role: 'bot', text: error instanceof Error ? error.message : String(error), failed: true }
      ])
    }
  })

  const activeChannels =
    (draft.enabled && draft.telegram.enabled ? 1 : 0) + (draft.enabled && draft.whatsapp.enabled ? 1 : 0)
  const linked = draft.telegram.chatId.trim() || normalizePhone(draft.whatsapp.toPhone) || 'Not linked'
  const lastActivity = Math.max(...page.providers.map((provider) => provider.lastActivityAt ?? 0))
  const storedSecrets = Object.values(page.secrets).filter(Boolean).length
  const commands = showAllCommands ? page.commands : page.commands.slice(0, 6)
  const webhookUrl = `http://127.0.0.1:${draft.whatsapp.webhookPort}${normalizePath(draft.whatsapp.webhookPath)}`
  const telegram = page.providers.find((provider) => provider.provider === 'telegram')
  const whatsapp = page.providers.find((provider) => provider.provider === 'whatsapp')

  const copy = async (value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success('Copied to the clipboard.')
    } catch {
      toast.error('The clipboard is unavailable. Select the text and copy it manually.')
    }
  }

  const setTelegram = (patch: Partial<ChatSettings['telegram']>): void =>
    setDraft((current) => ({ ...current, telegram: { ...current.telegram, ...patch } }))
  const setWhatsApp = (patch: Partial<ChatSettings['whatsapp']>): void =>
    setDraft((current) => ({ ...current, whatsapp: { ...current.whatsapp, ...patch } }))
  const setNotify = (key: keyof ChatSettings['notify'], value: boolean): void =>
    setDraft((current) => ({ ...current, notify: { ...current.notify, [key]: value } }))

  const secretField = (key: string, hint: string, placeholder: string): React.ReactElement => (
    <SecretField
      key={key}
      label={SECRET_LABELS[key]!}
      hint={hint}
      placeholder={placeholder}
      stored={Boolean(page.secrets[secretKeyName(key)])}
      value={secretInputs[key] ?? ''}
      onChange={(value) => setSecretInputs((current) => ({ ...current, [key]: value }))}
      onSave={() => storeSecret.mutate({ key, value: secretInputs[key] ?? '' })}
      onRemove={() => setRemoveSecret(key)}
      saving={storeSecret.isPending && storeSecret.variables?.key === key}
    />
  )

  return (
    <>
      <PageHeader
        eyebrow="Direct line"
        title="Chat"
        desc="Talk to BT Applicant from Telegram or WhatsApp. Notifications arrive as events happen, and a small deterministic command set lets you pause, review, approve, and fix missing profile facts. Chat is optional; the pipeline behaves the same when it is off."
        actions={
          <>
            <Button variant="secondary" onClick={() => refresh()} title="Refresh chat status">
              <RefreshCw /> Refresh
            </Button>
            <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty || problems.length > 0}>
              {dirty ? 'Save chat settings' : 'Saved'}
            </Button>
          </>
        }
      />

      {!draft.enabled ? (
        <Notice tone="info" className="mb-4" icon={MessageCircle}>
          <strong>Chat is off.</strong> Nothing polls Telegram and no webhook is listening. Stored tokens stay encrypted in {keychainName} and can be reused
          when you switch chat back on.
        </Notice>
      ) : null}
      {draft.enabled && !draft.commandsEnabled ? (
        <Notice tone="warn" className="mb-4" icon={ShieldCheck}>
          <strong>Commands are disabled.</strong> Notifications still arrive, but inbound messages are recorded and ignored. Enable commands only for a chat you
          control.
        </Notice>
      ) : null}
      {problems.length > 0 ? (
        <Notice tone="danger" className="mb-4" icon={CircleAlert}>
          {problems.join(' ')}
        </Notice>
      ) : null}
      {dirty ? (
        <Notice tone="warn" className="mb-4">
          Chat settings have unsaved changes.{' '}
          <Button variant="ghost" size="sm" onClick={() => setDraft(baseline)}>
            Discard
          </Button>
        </Notice>
      ) : null}

      <div className="stat-grid mb-4">
        <StatCard
          label="Active channels"
          value={activeChannels}
          unit="of 2"
          foot={activeChannels === 0 ? 'Chat is not connected' : [draft.telegram.enabled ? 'Telegram' : null, draft.whatsapp.enabled ? 'WhatsApp' : null].filter(Boolean).join(' · ')}
          tone={activeChannels > 0 ? 'success' : 'warn'}
          icon={MessageCircle}
        />
        <StatCard
          label="Linked identity"
          value={linked.length > 26 ? `${linked.slice(0, 24)}…` : linked}
          foot="Only this chat or phone can issue commands"
          tone={linked === 'Not linked' ? 'warn' : 'accent'}
          icon={Link2}
        />
        <StatCard
          label="Encrypted secrets"
          value={storedSecrets}
          unit="of 4"
          foot={storedSecrets === 4 ? 'Every channel secret is stored' : 'Missing secrets are listed per channel'}
          tone={storedSecrets > 0 ? 'info' : 'neutral'}
          icon={KeyRound}
        />
        <StatCard
          label="Sensitive actions"
          value="One-time code"
          foot="Approve, reject, and retry need a 5-minute single-use confirmation"
          tone="purple"
          icon={Lock}
        />
      </div>

      <div className="split-2">
        <div>
          <Panel title="Operating mode" sub="Chat is an interface onto the same local pipeline, not a second automation engine.">
            <div className="stack">
              <SwitchRow
                title="Enable chat control"
                desc="Starts Telegram long polling and the loopback WhatsApp webhook when their credentials are present."
                checked={draft.enabled}
                onCheckedChange={(checked) => setDraft({ ...draft, enabled: checked })}
              />
              <SwitchRow
                title="Accept commands"
                desc="When off, notifications still arrive but every inbound message is recorded as ignored. No command changes state."
                checked={draft.commandsEnabled}
                onCheckedChange={(checked) => setDraft({ ...draft, commandsEnabled: checked })}
                disabled={!draft.enabled}
              />
            </div>
          </Panel>

          <Panel title="Channels" sub="Configure only the channel you use. Both can run at the same time.">
            <div className="stack">
              <ChannelCard
                title="Telegram"
                sub="Official Bot API · outbound long polling, no public URL"
                icon={MessageCircle}
                status={telegram}
              >
                <SwitchRow
                  title="Enable Telegram"
                  desc="The app asks Telegram for new messages every few seconds. Outbound messages use the same bot token."
                  checked={draft.telegram.enabled}
                  onCheckedChange={(checked) => setTelegram({ enabled: checked })}
                  disabled={!draft.enabled}
                />
                {secretField(
                  SECRETS.telegramToken,
                  `Create a bot with @BotFather, then paste the token here. It is encrypted with ${keychainName}.`,
                  '123456789:AA…'
                )}
                <Field
                  label={
                    <span className="row" style={{ gap: 6 }}>
                      Allowed chat ID
                      {draft.telegram.chatId.trim() ? <Badge tone="success">Linked</Badge> : <Badge tone="warn">Not linked</Badge>}
                    </span>
                  }
                  hint="Send /start to your bot. While no chat is linked, it replies with the numeric chat ID. Paste that value here so only your chat can command the app."
                >
                  <Input
                    value={draft.telegram.chatId}
                    onChange={(event) => setTelegram({ chatId: event.target.value.trim() })}
                    placeholder="123456789"
                    className="mono"
                    inputMode="numeric"
                  />
                </Field>
                <div className="row-between">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAdvanced((current) => ({ ...current, telegram: !current.telegram }))}
                  >
                    {advanced.telegram ? 'Hide advanced' : 'Advanced'}
                  </Button>
                  <span className="tiny faint">Secrets are never shown again after saving</span>
                </div>
                {advanced.telegram ? (
                  <div className="grid-2">
                    <Field label="Poll timeout" hint="Seconds per request. 10 is a good default; 2 is the most responsive.">
                      <Input
                        type="number"
                        min={2}
                        max={50}
                        value={draft.telegram.pollSeconds}
                        onChange={(event) => setTelegram({ pollSeconds: clampInt(event.target.value, 2, 50, draft.telegram.pollSeconds) })}
                      />
                    </Field>
                    <Field label="Bot username" hint="Optional label for your own reference. It is not used for authentication.">
                      <Input
                        value={draft.telegram.username}
                        onChange={(event) => setTelegram({ username: event.target.value })}
                        placeholder="@my_applicant_bot"
                        className="mono"
                      />
                    </Field>
                  </div>
                ) : null}
                <ProviderActions
                  provider="telegram"
                  test={test}
                  sendTest={sendTest}
                  testResult={testResults.telegram}
                  sendResult={sendResults.telegram}
                />
              </ChannelCard>

              <ChannelCard
                title="WhatsApp"
                sub="Official Cloud API · signed webhook and outbound messages"
                icon={Smartphone}
                status={whatsapp}
              >
                <SwitchRow
                  title="Enable WhatsApp"
                  desc="Requires a Meta app with the WhatsApp product, a permanent access token, and the numeric phone number ID."
                  checked={draft.whatsapp.enabled}
                  onCheckedChange={(checked) => setWhatsApp({ enabled: checked })}
                  disabled={!draft.enabled}
                />
                {secretField(
                  SECRETS.whatsappAccessToken,
                  'From Meta’s WhatsApp setup. A permanent system-user token is recommended over the temporary test token.',
                  'EAAG…'
                )}
                <div className="grid-2">
                  <Field label="Phone number ID" hint="The numeric ID from Meta, not the phone number itself." required>
                    <Input
                      value={draft.whatsapp.phoneNumberId}
                      onChange={(event) => setWhatsApp({ phoneNumberId: event.target.value.trim() })}
                      placeholder="1029384756"
                      className="mono"
                      inputMode="numeric"
                    />
                  </Field>
                  <Field label="Your phone number" hint="International format. Only this number can send commands, and notifications go here." required>
                    <Input
                      value={draft.whatsapp.toPhone}
                      onChange={(event) => setWhatsApp({ toPhone: event.target.value })}
                      placeholder="+49 151 2345678"
                      className="mono"
                      inputMode="tel"
                    />
                  </Field>
                </div>
                {secretField(
                  SECRETS.whatsappVerifyToken,
                  'A value you invent. Paste the same value into the Meta webhook configuration; the local endpoint rejects any other token.',
                  'a long random phrase'
                )}
                {secretField(
                  SECRETS.whatsappAppSecret,
                  'From Meta → App settings → Basic. Every webhook POST is rejected unless its HMAC signature matches this secret.',
                  'App secret'
                )}
                <div
                  className="application-card"
                  style={{ cursor: 'default', padding: 12, display: 'grid', gap: 8 }}
                >
                  <div className="row-between" style={{ gap: 8 }}>
                    <span className="small strong">Loopback webhook</span>
                    <Badge tone={whatsapp?.webhookListening ? 'success' : 'warn'}>
                      {whatsapp?.webhookListening ? 'Listening' : 'Not listening'}
                    </Badge>
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <Input readOnly value={webhookUrl} className="mono" aria-label="Local WhatsApp webhook URL" onFocus={(event) => event.currentTarget.select()} />
                    <Button size="sm" variant="ghost" onClick={() => void copy(webhookUrl)} title="Copy webhook URL">
                      <Copy /> Copy
                    </Button>
                  </div>
                  <div className="tiny faint" style={{ lineHeight: 1.6 }}>
                    This endpoint binds to 127.0.0.1 only. Meta requires a public HTTPS address, so publish it through a trusted tunnel and paste the tunnel URL plus
                    the verify token into Meta. Do not expose the local port directly. GET verification and POST signatures are validated before any message is read.
                  </div>
                </div>
                <div className="row-between">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAdvanced((current) => ({ ...current, whatsapp: !current.whatsapp }))}
                  >
                    {advanced.whatsapp ? 'Hide advanced' : 'Advanced'}
                  </Button>
                  <span className="tiny faint">{draft.whatsapp.graphVersion}</span>
                </div>
                {advanced.whatsapp ? (
                  <div className="grid-2">
                    <Field label="Business account ID" hint="Optional. Shown in Meta’s WhatsApp settings.">
                      <Input
                        value={draft.whatsapp.businessAccountId}
                        onChange={(event) => setWhatsApp({ businessAccountId: event.target.value.trim() })}
                        className="mono"
                        inputMode="numeric"
                      />
                    </Field>
                    <Field label="Graph API version" hint="Meta graph version, for example v23.0.">
                      <Input
                        value={draft.whatsapp.graphVersion}
                        onChange={(event) => setWhatsApp({ graphVersion: event.target.value.trim() })}
                        className="mono"
                      />
                    </Field>
                    <Field label="Webhook port" hint="Local loopback port. Default 4780.">
                      <Input
                        type="number"
                        min={1024}
                        max={65535}
                        value={draft.whatsapp.webhookPort}
                        onChange={(event) => setWhatsApp({ webhookPort: clampInt(event.target.value, 1024, 65535, draft.whatsapp.webhookPort) })}
                      />
                    </Field>
                    <Field label="Webhook path" hint="Must match the path configured in Meta.">
                      <Input
                        value={draft.whatsapp.webhookPath}
                        onChange={(event) => setWhatsApp({ webhookPath: event.target.value.trim() })}
                        className="mono"
                      />
                    </Field>
                  </div>
                ) : null}
                <ProviderActions
                  provider="whatsapp"
                  test={test}
                  sendTest={sendTest}
                  testResult={testResults.whatsapp}
                  sendResult={sendResults.whatsapp}
                />
              </ChannelCard>
            </div>
          </Panel>

          <Panel title="Notifications" sub="Only event summaries leave the app. Message bodies, tokens, and confirmation codes are never included.">
            <div className="stack">
              <SwitchRow
                title="Approvals waiting"
                desc="A draft is ready and needs your decision."
                checked={draft.notify.approvals}
                onCheckedChange={(checked) => setNotify('approvals', checked)}
                disabled={!draft.enabled}
              />
              <SwitchRow
                title="Applications submitted"
                desc="A delivery succeeded through the configured adapter."
                checked={draft.notify.submitted}
                onCheckedChange={(checked) => setNotify('submitted', checked)}
                disabled={!draft.enabled}
              />
              <SwitchRow
                title="Failures and blockers"
                desc="Failed, uncertain, or needs-you deliveries, plus dead-lettered tasks and schedules."
                checked={draft.notify.failures}
                onCheckedChange={(checked) => setNotify('failures', checked)}
                disabled={!draft.enabled}
              />
              <SwitchRow
                title="Daily report"
                desc="The generated digest, with the headline counts."
                checked={draft.notify.digest}
                onCheckedChange={(checked) => setNotify('digest', checked)}
                disabled={!draft.enabled}
              />
              <SwitchRow
                title="Source issues"
                desc="A discovery source failed and may need credentials or configuration."
                checked={draft.notify.sources}
                onCheckedChange={(checked) => setNotify('sources', checked)}
                disabled={!draft.enabled}
              />
              <Notice tone="info" icon={BellRing}>
                Each channel keeps its own event cursor, so enabling chat later never replays old activity. Failed deliveries stop the cursor and are retried on the
                next scan instead of being silently skipped.
              </Notice>
            </div>
          </Panel>
        </div>

        <div>
          <Panel
            title="Try a command"
            sub="Runs locally against the same database. Nothing is sent to Telegram or WhatsApp."
            actions={<Badge tone="accent">Deterministic</Badge>}
          >
            <div
              style={{
                display: 'grid',
                gap: 8,
                maxHeight: 300,
                overflowY: 'auto',
                padding: 4,
                border: '1px solid var(--line-soft)',
                borderRadius: 10
              }}
              aria-live="polite"
            >
              {transcript.map((entry, index) => (
                <div
                  key={index}
                  className={cx('small', entry.failed && 'color-red')}
                  style={{
                    justifySelf: entry.role === 'you' ? 'end' : 'start',
                    maxWidth: '88%',
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.55,
                    padding: '8px 10px',
                    borderRadius: 10,
                    border: '1px solid var(--line-soft)',
                    background: entry.role === 'you' ? 'var(--accent-soft)' : 'var(--panel-2)'
                  }}
                >
                  {entry.text}
                </div>
              ))}
            </div>
            <form
              className="row mt-3"
              style={{ gap: 8 }}
              onSubmit={(event) => {
                event.preventDefault()
                const text = consoleText.trim()
                if (!text || runCommand.isPending) return
                runCommand.mutate(text)
              }}
            >
              <Input
                value={consoleText}
                onChange={(event) => setConsoleText(event.target.value)}
                placeholder="/status"
                aria-label="Command"
                className="mono"
                maxLength={2000}
                disabled={!draft.commandsEnabled}
              />
              <Button type="submit" variant="primary" loading={runCommand.isPending} disabled={!consoleText.trim() || !draft.commandsEnabled}>
                <Send /> Run
              </Button>
            </form>
            <div className="tiny faint" style={{ marginTop: 10, lineHeight: 1.6 }}>
              Codes prepared here belong to this console and cannot be confirmed in Telegram or WhatsApp. Commands prepared in a chat must be confirmed in that
              same chat.
            </div>
          </Panel>

          <Panel
            title="Recent activity"
            sub={`${plural(page.messages.length, 'recorded message')} · bodies are never stored`}
            flush
          >
            {page.messages.length === 0 ? (
              <div className="empty">
                <div className="empty-icon">
                  <Terminal />
                </div>
                <div className="empty-title">No chat activity yet</div>
                <div className="empty-desc">Inbound commands, replies, notifications, and ignored messages appear here with a short summary.</div>
              </div>
            ) : (
              <div className="list">
                {page.messages.slice(0, 14).map((message) => (
                  <div className="list-row" key={message.id} style={{ alignItems: 'flex-start' }}>
                    <Badge tone={message.provider === 'telegram' ? 'info' : message.provider === 'whatsapp' ? 'success' : 'neutral'}>
                      {message.provider}
                    </Badge>
                    <div className="list-row-main">
                      <div className="row wrap" style={{ gap: 6 }}>
                        <span className="strong small">{message.direction === 'inbound' ? 'You' : 'App'}</span>
                        {message.command ? <span className="mono tiny faint">{message.command}</span> : null}
                        <Badge
                          tone={
                            message.status === 'sent' || message.status === 'received'
                              ? 'success'
                              : message.status === 'failed' || message.status === 'rejected'
                                ? 'danger'
                                : 'neutral'
                          }
                        >
                          {message.status}
                        </Badge>
                      </div>
                      <div className="tiny faint mt-2 truncate" title={message.summary}>
                        {message.summary}
                      </div>
                      <div className="tiny faint" style={{ marginTop: 2 }}>
                        {timeAgo(message.createdAt)}
                        {message.error ? ` · ${message.error}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title="Command reference"
            sub="Plain words also work: status, report, approvals, pause, resume, scan."
            actions={
              <Button variant="ghost" size="sm" onClick={() => setShowAllCommands((current) => !current)}>
                {showAllCommands ? 'Show fewer' : `Show all ${page.commands.length}`}
              </Button>
            }
            flush
          >
            <div className="list">
              {commands.map((command) => (
                <div className="list-row" key={command.command} style={{ alignItems: 'flex-start' }}>
                  <span className="mono small" style={{ minWidth: 92 }}>
                    {command.command}
                  </span>
                  <div className="list-row-main">
                    <div className="small">{command.description}</div>
                    {command.example ? <div className="tiny faint mono mt-2">{command.example}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Security model" sub="Chat never widens what the app will do on its own.">
            <div className="stack">
              <SecurityPoint
                icon={ShieldCheck}
                title="Allowlisted identity"
                desc="Only the stored Telegram chat ID or WhatsApp number is accepted. Any other sender is logged and ignored without executing the message."
              />
              <SecurityPoint
                icon={Lock}
                title="Two-step sensitive actions"
                desc="Approve, reject, and retry prepare an action and return a six-digit code. The code is hashed, single-use, expires in five minutes, and works only in the chat that requested it."
              />
              <SecurityPoint
                icon={KeyRound}
                title="Encrypted credentials"
                desc={`Bot tokens, access tokens, verify tokens, and app secrets are encrypted through ${keychainName}. They are never rendered back to the interface or written to the audit log.`}
              />
              <SecurityPoint
                icon={MessageCircle}
                title="No message archive"
                desc="The database stores a short summary, direction, and status for each message. Full message bodies and confirmation codes are not persisted."
              />
              <SecurityPoint
                icon={Terminal}
                title="No model required"
                desc="Every command is matched deterministically. Chat works with AI providers switched off, during a simulated outage, and fully offline on the local network."
              />
            </div>
          </Panel>
        </div>
      </div>

      <ConfirmDialog
        open={removeSecret !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveSecret(null)
        }}
        title="Remove this secret?"
        description={
          <>
            <strong>{removeSecret ? SECRET_LABELS[removeSecret] : ''}</strong> will be deleted from {keychainName}. The channel that needs it stops starting until a
            new value is stored. Existing chat records are kept.
          </>
        }
        confirmLabel="Remove secret"
        busy={deleteSecret.isPending}
        onConfirm={() => {
          if (removeSecret) deleteSecret.mutate(removeSecret)
        }}
      />
    </>
  )
}

function ChannelCard({
  title,
  sub,
  icon: Icon,
  status,
  children
}: {
  title: string
  sub: string
  icon: LucideIcon
  status?: ChatProviderStatusDTO
  children: React.ReactNode
}) {
  return (
    <div className="application-card" style={{ cursor: 'default', padding: 16 }}>
      <div className="row-between" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <Icon size={18} className="color-accent" style={{ marginTop: 2, flex: 'none' }} />
          <div>
            <div className="strong">{title}</div>
            <div className="tiny faint">{sub}</div>
          </div>
        </div>
        <div className="row wrap" style={{ gap: 6, justifyContent: 'flex-end' }}>
          {status?.configured ? <Badge tone="success">Configured</Badge> : <Badge tone="warn">Needs setup</Badge>}
          {status ? (
            <Badge tone={status.running ? 'accent' : status.enabled ? 'warn' : 'neutral'}>
              {status.running ? 'Running' : status.enabled ? 'Enabled' : 'Off'}
            </Badge>
          ) : null}
          {status?.connected ? <Badge tone="success">Connected</Badge> : null}
        </div>
      </div>
      {status ? (
        <>
          <div className="tiny faint mt-2">{status.detail}</div>
          {status.lastError ? (
            <div className="tiny color-red mt-2 truncate" title={status.lastError}>
              {status.lastError}
            </div>
          ) : null}
        </>
      ) : null}
      <div className="stack mt-3">{children}</div>
    </div>
  )
}

function SecretField({
  label,
  hint,
  placeholder,
  stored,
  value,
  onChange,
  onSave,
  onRemove,
  saving
}: {
  label: string
  hint: string
  placeholder: string
  stored: boolean
  value: string
  onChange: (value: string) => void
  onSave: () => void
  onRemove: () => void
  saving: boolean
}) {
  return (
    <div className="field">
      <span className="label row" style={{ gap: 6 }}>
        {label}
        {stored ? <Badge tone="success">Stored</Badge> : <Badge tone="warn">Missing</Badge>}
      </span>
      <div className="row" style={{ gap: 8 }}>
        <Input
          type="password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={stored ? 'Stored — enter a new value to replace it' : placeholder}
          autoComplete="new-password"
          spellCheck={false}
          className="mono"
          aria-label={label}
        />
        <Button size="sm" variant="secondary" onClick={onSave} loading={saving} disabled={!value.trim()} aria-label={`Save ${label}`}>
          Save
        </Button>
        {stored ? (
          <Button size="sm" variant="ghost" onClick={onRemove} title={`Remove ${label}`}>
            Remove
          </Button>
        ) : null}
      </div>
      <span className="hint">{hint}</span>
    </div>
  )
}

function ProviderActions({
  provider,
  test,
  sendTest,
  testResult,
  sendResult
}: {
  provider: ChatProviderId
  test: { isPending: boolean; variables?: ChatProviderId; mutate: (provider: ChatProviderId) => void }
  sendTest: { isPending: boolean; variables?: ChatProviderId; mutate: (provider: ChatProviderId) => void }
  testResult?: ChatTestResultDTO
  sendResult?: ChatTestResultDTO
}) {
  return (
    <div className="stack">
      <div className="row wrap" style={{ gap: 8 }}>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => test.mutate(provider)}
          loading={test.isPending && test.variables === provider}
        >
          <FlaskConical /> Test connection
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => sendTest.mutate(provider)}
          loading={sendTest.isPending && sendTest.variables === provider}
        >
          <Send /> Send test message
        </Button>
      </div>
      {testResult ? <ResultNotice result={testResult} /> : null}
      {sendResult ? <ResultNotice result={sendResult} /> : null}
    </div>
  )
}

function ResultNotice({ result }: { result: ChatTestResultDTO }) {
  return (
    <Notice tone={result.ok ? 'success' : 'danger'} icon={result.ok ? CheckCircle2 : XCircle}>
      {result.message}
      {result.latencyMs !== null ? <span className="faint"> · {result.latencyMs} ms</span> : null}
    </Notice>
  )
}

function SecurityPoint({ icon: Icon, title, desc }: { icon: LucideIcon; title: string; desc: string }) {
  return (
    <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
      <Icon size={15} className="color-accent" style={{ marginTop: 3, flex: 'none' }} />
      <div>
        <div className="strong small">{title}</div>
        <div className="tiny faint" style={{ lineHeight: 1.6 }}>
          {desc}
        </div>
      </div>
    </div>
  )
}

function secretKeyName(key: string): keyof ChatPageDTO['secrets'] {
  if (key === SECRETS.telegramToken) return 'telegramToken'
  if (key === SECRETS.whatsappAccessToken) return 'whatsappAccessToken'
  if (key === SECRETS.whatsappVerifyToken) return 'whatsappVerifyToken'
  return 'whatsappAppSecret'
}

function validateChatSettings(settings: ChatSettings): string[] {
  const problems: string[] = []
  if (settings.telegram.chatId.trim() && !/^-?\d{1,20}$/.test(settings.telegram.chatId.trim())) {
    problems.push('The Telegram chat ID must be the numeric ID that the bot replies with.')
  }
  if (settings.whatsapp.phoneNumberId.trim() && !/^\d{5,30}$/.test(settings.whatsapp.phoneNumberId.trim())) {
    problems.push('The WhatsApp phone number ID must be the numeric ID from Meta.')
  }
  if (settings.whatsapp.toPhone.trim()) {
    const digits = normalizePhone(settings.whatsapp.toPhone)
    if (digits.length < 7 || digits.length > 15) problems.push('The WhatsApp recipient number must contain 7 to 15 digits in international format.')
  }
  if (!/^v\d{1,2}\.\d{1,2}$/.test(settings.whatsapp.graphVersion)) {
    problems.push('The Graph API version must look like v23.0.')
  }
  if (!/^\/[A-Za-z0-9/_-]*$/.test(settings.whatsapp.webhookPath)) {
    problems.push('The webhook path must start with / and use letters, digits, dashes, or underscores.')
  }
  return problems
}

function normalizePhone(value: string): string {
  return value.replace(/[^\d]/g, '')
}

function normalizePath(value: string): string {
  const trimmed = value.trim() || '/whatsapp/webhook'
  return trimmed.startsWith('/') ? trimmed.replace(/\/+$/, '') || '/' : `/${trimmed}`
}

function clampInt(value: string, min: number, max: number, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}
