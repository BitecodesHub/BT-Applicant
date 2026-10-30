import { useMemo, useRef, useState, type RefObject } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Braces,
  Eye,
  FileText,
  History,
  Mail,
  Pencil,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  type LucideIcon
} from 'lucide-react'
import type { TemplateDTO, TemplateVersionDTO } from '@shared/api'
import type { TemplateKind } from '@shared/types'
import { call } from '../lib/api'
import {
  fmtDateTime,
  renderPreview,
  templateKindLabels,
  templateVariableList,
  timeAgo
} from '../lib/format'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  Notice,
  PageError,
  PageHeader,
  PageLoading,
  Panel,
  Segmented,
  SwitchRow,
  Tabs,
  Textarea,
  useToast
} from '../components/ui'

interface TemplateDraft {
  id?: number
  name: string
  kind: TemplateKind
  subject: string
  body: string
  isDefault: boolean
}

const KINDS: TemplateKind[] = ['application_email', 'cover_letter', 'follow_up']

const KIND_ICONS: Record<TemplateKind, LucideIcon> = {
  application_email: Mail,
  cover_letter: FileText,
  follow_up: Send
}

const EMPTY_DRAFT: TemplateDraft = {
  name: '',
  kind: 'application_email',
  subject: '',
  body: '',
  isDefault: false
}

export default function Templates() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [kind, setKind] = useState<TemplateKind>('application_email')
  const [scope, setScope] = useState<'current' | 'all'>('current')
  const [editor, setEditor] = useState<TemplateDraft | null>(null)
  const [preview, setPreview] = useState<TemplateDTO | null>(null)
  const [historyFor, setHistoryFor] = useState<TemplateDTO | null>(null)
  const [pendingDelete, setPendingDelete] = useState<TemplateDTO | null>(null)
  const [target, setTarget] = useState<'subject' | 'body'>('body')
  const subjectRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const templates = useQuery({ queryKey: ['templates', 'all'], queryFn: () => call('templates.list', {}) })
  const versions = useQuery({
    queryKey: ['template-versions', historyFor?.id ?? 0],
    queryFn: () => call('templates.versions', { id: historyFor!.id }),
    enabled: Boolean(historyFor)
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['templates'] })
    void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
  }

  const save = useMutation({
    mutationFn: (draft: TemplateDraft) =>
      call('templates.save', {
        id: draft.id,
        name: draft.name.trim(),
        kind: draft.kind,
        subject: draft.subject.trim(),
        body: draft.body,
        isDefault: draft.isDefault,
        note: draft.id ? 'Edited from the templates workspace' : 'Created from the templates workspace'
      }),
    onSuccess: (_data, draft) => {
      toast.success(draft.id ? 'Template updated. A new version was recorded.' : 'Template created.')
      setEditor(null)
      refresh()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const makeDefault = useMutation({
    mutationFn: (id: number) => call('templates.default', { id }),
    onSuccess: () => {
      toast.success('Default template updated for this kind.')
      refresh()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const remove = useMutation({
    mutationFn: (id: number) => call('templates.delete', { id }),
    onSuccess: () => {
      toast.success('Template deleted.')
      setPendingDelete(null)
      refresh()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const all = templates.data ?? []
  const filtered = useMemo(
    () => (scope === 'all' ? all : all.filter((template) => template.kind === kind)),
    [all, kind, scope]
  )
  const counts = useMemo(() => {
    const result: Record<TemplateKind, number> = { application_email: 0, cover_letter: 0, follow_up: 0 }
    for (const template of all) result[template.kind] += 1
    return result
  }, [all])
  const defaults = all.filter((template) => template.isDefault)
  const lastUpdated = all.reduce<number>((latest, template) => Math.max(latest, template.updatedAt), 0)

  const insertVariable = (variable: string) => {
    if (!editor) return
    const token = `{{${variable}}}`
    if (target === 'subject') {
      const input = subjectRef.current
      const start = input?.selectionStart ?? editor.subject.length
      const end = input?.selectionEnd ?? editor.subject.length
      const next = `${editor.subject.slice(0, start)}${token}${editor.subject.slice(end)}`
      setEditor({ ...editor, subject: next })
      window.setTimeout(() => {
        input?.focus()
        input?.setSelectionRange(start + token.length, start + token.length)
      }, 0)
      return
    }
    const area = bodyRef.current
    const start = area?.selectionStart ?? editor.body.length
    const end = area?.selectionEnd ?? editor.body.length
    const next = `${editor.body.slice(0, start)}${token}${editor.body.slice(end)}`
    setEditor({ ...editor, body: next })
    window.setTimeout(() => {
      area?.focus()
      area?.setSelectionRange(start + token.length, start + token.length)
    }, 0)
  }

  const openNew = () => setEditor({ ...EMPTY_DRAFT, kind: scope === 'all' ? 'application_email' : kind })

  if (templates.isLoading && !templates.data) return <PageLoading label="Reading template versions" />
  if (templates.error) return <PageError error={templates.error} onRetry={() => templates.refetch()} />

  return (
    <>
      <PageHeader
        eyebrow="Deterministic drafting"
        title="Templates"
        desc="Application emails, cover letters, and follow-ups are rendered locally from these templates. AI can improve wording when enabled; the structure and variable substitution never depend on it."
        actions={
          <Button variant="primary" onClick={openNew}>
            <Plus /> New template
          </Button>
        }
      />

      <div className="row-between mb-4 wrap" style={{ gap: 12 }}>
        <Segmented
          options={[
            { value: 'current', label: 'Selected kind' },
            { value: 'all', label: `All templates (${all.length})` }
          ]}
          value={scope}
          onChange={(value) => setScope(value)}
        />
        <div className="row wrap small muted" style={{ gap: 14 }}>
          <span>{defaults.length} default template{defaults.length === 1 ? '' : 's'} across kinds</span>
          <span>·</span>
          <span>Last edit {lastUpdated ? timeAgo(lastUpdated) : 'never'}</span>
        </div>
      </div>

      {scope === 'current' ? (
        <Tabs
          options={KINDS.map((item) => ({ value: item, label: templateKindLabels[item], count: counts[item] }))}
          value={kind}
          onChange={(value) => setKind(value)}
        />
      ) : null}

      <div className="split-2 mt-3">
        <div>
          <Panel
            title={scope === 'all' ? 'All templates' : templateKindLabels[kind]}
            sub={
              scope === 'all'
                ? 'Every stored template, grouped by purpose.'
                : 'The default template supplies the starting draft for every new application of this kind.'
            }
            actions={
              scope === 'current' ? (
                <div className="row" style={{ gap: 6 }}>
                  <Button size="sm" variant="ghost" onClick={() => setKind(KINDS[(KINDS.indexOf(kind) + 1) % KINDS.length]!)}>
                    Next kind
                  </Button>
                  <Button size="sm" variant="secondary" onClick={openNew}>
                    <Plus /> New
                  </Button>
                </div>
              ) : null
            }
            flush
          >
            {filtered.length === 0 ? (
              <EmptyState
                icon={Mail}
                title={scope === 'all' ? 'No templates stored' : `No ${templateKindLabels[kind].toLowerCase()} template yet`}
                desc="Create a template to control the exact subject and body used for this kind of message. Variables are replaced from your stored profile and job record."
                action={
                  <Button size="sm" variant="primary" onClick={openNew}>
                    <Plus /> Create template
                  </Button>
                }
              />
            ) : (
              <div className="stack" style={{ gap: 0 }}>
                {filtered.map((template) => {
                  const Icon = KIND_ICONS[template.kind]
                  return (
                    <div key={template.id} className="list-row" style={{ alignItems: 'flex-start', paddingTop: 16, paddingBottom: 16 }}>
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 10,
                          border: '1px solid var(--line)',
                          background: 'var(--panel-2)',
                          display: 'grid',
                          placeItems: 'center',
                          flex: 'none'
                        }}
                      >
                        <Icon size={16} className={template.isDefault ? 'color-accent' : 'color-muted'} />
                      </div>
                      <div className="list-row-main">
                        <div className="row wrap" style={{ gap: 8 }}>
                          <span className="strong">{template.name}</span>
                          {template.isDefault ? (
                            <Badge tone="accent" icon={Star}>
                              Default
                            </Badge>
                          ) : null}
                          {scope === 'all' ? <Badge tone="neutral">{templateKindLabels[template.kind]}</Badge> : null}
                          <Badge tone="info">v{template.version}</Badge>
                        </div>
                        <div className="small muted mt-2 truncate">{template.subject}</div>
                        <div className="tiny faint mt-2">
                          Updated {timeAgo(template.updatedAt)} · {template.body.length.toLocaleString()} characters
                        </div>
                        <div className="row mt-3 wrap" style={{ gap: 6 }}>
                          <Button size="sm" variant="secondary" onClick={() => setEditor({ ...template })}>
                            <Pencil /> Edit
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setPreview(template)}>
                            <Eye /> Preview
                          </Button>
                          {!template.isDefault ? (
                            <Button size="sm" variant="ghost" onClick={() => makeDefault.mutate(template.id)} loading={makeDefault.isPending && makeDefault.variables === template.id}>
                              <Star /> Set default
                            </Button>
                          ) : null}
                          <Button size="sm" variant="ghost" onClick={() => setHistoryFor(template)}>
                            <History /> Versions
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setPendingDelete(template)}
                            disabled={template.isDefault}
                            title={template.isDefault ? 'Choose another default before deleting this template' : 'Delete template'}
                          >
                            <Trash2 /> Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Panel>
        </div>

        <div>
          <Panel title="How drafting uses templates" sub="No hidden generation step.">
            <div className="stack small muted" style={{ lineHeight: 1.65 }}>
              <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                <ShieldCheck size={15} className="color-green" style={{ marginTop: 2, flex: 'none' }} />
                <span>
                  <strong className="color-green">Deterministic base.</strong> The subject and body are composed from the default template for the
                  application kind, the job record, and your profile. Variables that have no stored value are replaced with nothing, never invented.
                </span>
              </div>
              <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                <Sparkles size={15} className="color-purple" style={{ marginTop: 2, flex: 'none' }} />
                <span>
                  <strong style={{ color: 'var(--purple)' }}>Optional AI polish.</strong> When AI is enabled and available, a provider may improve the fit
                  paragraph. A rejected or unavailable AI call falls back to the deterministic draft; the send path does not change.
                </span>
              </div>
              <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                <History size={15} className="color-blue" style={{ marginTop: 2, flex: 'none' }} />
                <span>
                  <strong className="color-blue">Immutable history.</strong> Every edit records a new version. Older versions stay readable so you can see
                  exactly what a submitted application was drafted from.
                </span>
              </div>
            </div>
          </Panel>

          <Panel title="Available variables" sub="Click to insert at the cursor in the open editor.">
            {editor ? (
              <div className="chip-list">
                {templateVariableList().map((variable) => (
                  <button key={variable} type="button" className="chip" style={{ cursor: 'pointer' }} onClick={() => insertVariable(variable)}>
                    <Braces size={11} /> {variable}
                  </button>
                ))}
              </div>
            ) : (
              <div className="small muted">
                Open a template editor to insert variables. The full list is also shown inside the editor.
              </div>
            )}
            <div className="divider" />
            <div className="small muted" style={{ lineHeight: 1.6 }}>
              Variables are filled from the stored profile, selected resume, and current job record at draft time. Values are never guessed. If a field is
              empty, the variable resolves to an empty string and the draft remains editable before approval.
            </div>
          </Panel>

          <Panel title="Default coverage" sub="Each kind needs one default template." flush>
            <div className="list">
              {KINDS.map((item) => {
                const fallback = all.find((template) => template.kind === item && template.isDefault)
                const Icon = KIND_ICONS[item]
                return (
                  <div className="list-row" key={item}>
                    <Icon size={14} className={fallback ? 'color-green' : 'color-yellow'} />
                    <div className="list-row-main">
                      <div className="small">{templateKindLabels[item]}</div>
                      <div className="tiny faint">{fallback ? fallback.name : 'No default — drafting will use a built-in fallback'}</div>
                    </div>
                    <Badge tone={fallback ? 'success' : 'warn'}>{fallback ? 'Covered' : 'Built-in'}</Badge>
                  </div>
                )
              })}
            </div>
          </Panel>
        </div>
      </div>

      <TemplateEditor
        draft={editor}
        onChange={setEditor}
        onClose={() => setEditor(null)}
        onSave={() => editor && save.mutate(editor)}
        saving={save.isPending}
        subjectRef={subjectRef}
        bodyRef={bodyRef}
        onFocusField={setTarget}
        onInsertVariable={insertVariable}
        existing={all}
      />

      <Modal
        open={Boolean(preview)}
        onOpenChange={(open) => {
          if (!open) setPreview(null)
        }}
        title={preview ? preview.name : 'Preview'}
        desc={preview ? `${templateKindLabels[preview.kind]} · version ${preview.version}` : undefined}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Close
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (!preview) return
                setEditor({ ...preview })
                setPreview(null)
              }}
            >
              <Pencil /> Edit template
            </Button>
          </>
        }
      >
        {preview ? <TemplatePreview subject={preview.subject} body={preview.body} /> : null}
      </Modal>

      <Modal
        open={Boolean(historyFor)}
        onOpenChange={(open) => {
          if (!open) setHistoryFor(null)
        }}
        title={historyFor ? `${historyFor.name} · versions` : 'Version history'}
        desc="Each saved edit stores the complete subject and body. Newest first."
        size="lg"
        footer={
          <Button variant="ghost" onClick={() => setHistoryFor(null)}>
            Close
          </Button>
        }
      >
        {versions.isLoading ? (
          <PageLoading label="Reading versions" />
        ) : versions.error ? (
          <PageError error={versions.error} onRetry={() => versions.refetch()} />
        ) : (versions.data ?? []).length === 0 ? (
          <EmptyState title="No versions recorded" desc="Versions are created when a template is first saved." />
        ) : (
          <div className="stack">
            {(versions.data ?? []).map((version: TemplateVersionDTO) => (
              <div key={version.id} className="panel" style={{ background: 'var(--panel-2)' }}>
                <div className="row-between wrap" style={{ gap: 8 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <Badge tone="info">v{version.version}</Badge>
                    <span className="small strong truncate">{version.subject}</span>
                  </div>
                  <span className="tiny faint">{fmtDateTime(version.createdAt)}</span>
                </div>
                <div className="tiny faint mt-2">{version.note ?? 'No note recorded'}</div>
                <pre className="pre mt-3" style={{ maxHeight: 160, overflow: 'auto' }}>
                  {version.body}
                </pre>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title="Delete this template?"
        description={
          pendingDelete ? (
            <>
              <strong>{pendingDelete.name}</strong> and its version history will be removed. Applications already drafted keep their stored subject and
              body. This cannot be undone.
            </>
          ) : null
        }
        confirmLabel="Delete template"
        busy={remove.isPending}
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete.id)
        }}
      />
    </>
  )
}

function TemplateEditor({
  draft,
  onChange,
  onClose,
  onSave,
  saving,
  subjectRef,
  bodyRef,
  onFocusField,
  onInsertVariable,
  existing
}: {
  draft: TemplateDraft | null
  onChange: (draft: TemplateDraft) => void
  onClose: () => void
  onSave: () => void
  saving: boolean
  subjectRef: RefObject<HTMLInputElement | null>
  bodyRef: RefObject<HTMLTextAreaElement | null>
  onFocusField: (field: 'subject' | 'body') => void
  onInsertVariable: (variable: string) => void
  existing: TemplateDTO[]
}) {
  const editing = Boolean(draft?.id)
  const valid = Boolean(draft && draft.name.trim().length >= 2 && draft.subject.trim().length > 0 && draft.body.trim().length > 0)
  const currentDefault = draft?.id ? existing.find((template) => template.id === draft.id)?.isDefault ?? false : false

  return (
    <Modal
      open={Boolean(draft)}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={editing ? 'Edit template' : 'New template'}
      desc={editing ? 'Saving creates a new immutable version. The old version remains readable.' : 'Choose a kind and compose the message your applications use.'}
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSave} disabled={!valid} loading={saving}>
            {editing ? 'Save new version' : 'Create template'}
          </Button>
        </>
      }
    >
      {draft ? (
        <div className="stack-lg">
          <div className="grid-2">
            <Field label="Template name" required hint="Shown only inside BT Applicant.">
              <Input
                value={draft.name}
                onChange={(event) => onChange({ ...draft, name: event.target.value })}
                placeholder="Standard application email"
                autoFocus
              />
            </Field>
            <Field label="Kind" required hint={editing ? 'Kind is fixed after creation.' : 'Which drafts use this template.'}>
              <select
                className="select"
                value={draft.kind}
                disabled={editing}
                onChange={(event) => onChange({ ...draft, kind: event.target.value as TemplateKind })}
              >
                {KINDS.map((item) => (
                  <option key={item} value={item}>
                    {templateKindLabels[item]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Subject" required hint="Rendered immediately with the variables exactly as stored.">
            <Input
              ref={subjectRef}
              value={draft.subject}
              onFocus={() => onFocusField('subject')}
              onChange={(event) => onChange({ ...draft, subject: event.target.value })}
              placeholder="Application for {{job_title}} — {{candidate_name}}"
            />
          </Field>

          <Field label="Body" required hint="Plain text. URL and email variables are inserted from stored records.">
            <Textarea
              ref={bodyRef}
              value={draft.body}
              onFocus={() => onFocusField('body')}
              onChange={(event) => onChange({ ...draft, body: event.target.value })}
              rows={12}
              placeholder={'Dear {{company}} team,\n\nI am applying for {{job_title}}…'}
              className="mono"
              style={{ minHeight: 260 }}
            />
          </Field>

          <div>
            <div className="label">Insert at cursor</div>
            <div className="chip-list mt-2">
              {templateVariableList().map((variable) => (
                <button
                  key={variable}
                  type="button"
                  className="chip"
                  style={{ cursor: 'pointer' }}
                  onClick={() => onInsertVariable(variable)}
                  title={`Insert {{${variable}}}`}
                >
                  {variable}
                </button>
              ))}
            </div>
          </div>

          <TemplatePreview subject={draft.subject} body={draft.body} />

          <SwitchRow
            title="Use as default for this kind"
            desc={
              currentDefault
                ? 'This template is already the default. Set another template as default to replace it.'
                : `New ${templateKindLabels[draft.kind].toLowerCase()} drafts will start from this template.`
            }
            checked={draft.isDefault || currentDefault}
            onCheckedChange={(checked) => onChange({ ...draft, isDefault: checked })}
            disabled={currentDefault}
          />

          {editing ? (
            <Notice tone="info">
              Saving records version {((existing.find((template) => template.id === draft.id)?.version ?? 0) + 1).toString()}. Submitted applications keep
              the exact text that was sent; no past draft is rewritten.
            </Notice>
          ) : null}
        </div>
      ) : null}
    </Modal>
  )
}

function TemplatePreview({ subject, body }: { subject: string; body: string }) {
  return (
    <Panel title="Rendered preview" sub="Sample values, exactly as a draft would read." className="mt-3">
      <div className="kv small">
        <dt>Subject</dt>
        <dd>{renderPreview(subject) || '—'}</dd>
      </div>
      <div className="divider" />
      <pre className="pre" style={{ whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto' }}>
        {renderPreview(body) || 'The body preview appears here as you type.'}
      </pre>
      <div className="fine-print mt-3">
        Sample values: Alex Morgan · Senior Platform Engineer · Northwind Labs. Real drafts use your stored profile and the job record.
      </div>
    </Panel>
  )
}
