import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Info,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  X,
  XCircle,
  type LucideIcon
} from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import type { Tone } from '../lib/format'
import { groupedCountries } from '../lib/format'
import { countryName } from '@shared/countries'

export function cx(...inputs: ClassValue[]): string {
  return clsx(inputs)
}

/* ------------------------------------------------------------------ buttons */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
type ButtonSize = 'sm' | 'md' | 'lg'

export function Button({
  variant = 'secondary',
  size = 'md',
  iconOnly = false,
  loading = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: React.ComponentProps<'button'> & {
  variant?: ButtonVariant
  size?: ButtonSize
  iconOnly?: boolean
  loading?: boolean
}) {
  return (
    <button
      type={type}
      className={cx(
        'btn',
        `btn-${variant}`,
        size === 'sm' && 'btn-sm',
        size === 'lg' && 'btn-lg',
        iconOnly && 'btn-icon',
        className
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="spin" /> : null}
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------- badges */

export function Badge({
  tone = 'neutral',
  children,
  className,
  icon: Icon
}: {
  tone?: Tone
  children: ReactNode
  className?: string
  icon?: LucideIcon
}) {
  return (
    <span className={cx('badge', `badge-${tone}`, className)}>
      {Icon ? <Icon /> : null}
      {children}
    </span>
  )
}

export function StatusDot({ tone = 'success', pulse = false }: { tone?: 'success' | 'warn' | 'err' | 'idle'; pulse?: boolean }) {
  return <span className={cx('status-dot', tone !== 'success' && tone, pulse && 'live-dot')} aria-hidden />
}

/* ------------------------------------------------------------------ surface */

export function Panel({
  title,
  sub,
  actions,
  children,
  flush = false,
  className,
  bodyClassName
}: {
  title?: ReactNode
  sub?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  flush?: boolean
  className?: string
  bodyClassName?: string
}) {
  const hasHead = Boolean(title || actions)
  return (
    <section className={cx('panel', className)}>
      {hasHead ? (
        <div className="panel-head">
          <div>
            {title ? <div className="panel-title">{title}</div> : null}
            {sub ? <div className="panel-sub">{sub}</div> : null}
          </div>
          {actions ? <div className="panel-actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cx(flush ? 'panel-flush' : 'panel-body', bodyClassName)}>{children}</div>
    </section>
  )
}

export function PageHeader({
  eyebrow,
  title,
  desc,
  actions
}: {
  eyebrow?: ReactNode
  title: ReactNode
  desc?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="page-head">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1 className="page-title">{title}</h1>
        {desc ? <p className="page-desc">{desc}</p> : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </header>
  )
}

/* ------------------------------------------------------------------ stats */

const TONE_COLOR: Record<Tone, string> = {
  neutral: 'var(--muted)',
  success: 'var(--green)',
  warn: 'var(--yellow)',
  danger: 'var(--red)',
  info: 'var(--blue)',
  accent: 'var(--accent)',
  purple: 'var(--purple)'
}

export function Sparkline({ values, tone = 'accent', width = 72, height = 24 }: { values: number[]; tone?: Tone; width?: number; height?: number }) {
  if (values.length < 2) return null
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = max - min || 1
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * (width - 2) + 1
    const y = height - 2 - ((value - min) / range) * (height - 4)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" aria-hidden>
      <polyline points={points.join(' ')} stroke={TONE_COLOR[tone]} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export function StatCard({
  label,
  value,
  unit,
  foot,
  spark,
  tone = 'accent',
  icon: Icon
}: {
  label: ReactNode
  value: ReactNode
  unit?: ReactNode
  foot?: ReactNode
  spark?: number[]
  tone?: Tone
  icon?: LucideIcon
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">
        {Icon ? (
          <span className="inline" style={{ gap: 6 }}>
            <Icon size={12} /> {label}
          </span>
        ) : (
          label
        )}
      </div>
      <div className="stat-value" style={tone !== 'accent' ? { color: TONE_COLOR[tone] } : undefined}>
        {value}
        {unit ? <span className="unit">{unit}</span> : null}
      </div>
      {foot ? <div className="stat-foot">{foot}</div> : null}
      {spark && spark.length > 1 ? (
        <div className="stat-spark">
          <Sparkline values={spark} tone={tone} />
        </div>
      ) : null}
    </div>
  )
}

export function ScoreRing({ score, size = 64 }: { score: number | null | undefined; size?: number }) {
  const value = Math.max(0, Math.min(100, score ?? 0))
  const stroke = value >= 75 ? 'var(--green)' : value >= 55 ? 'var(--accent)' : value >= 35 ? 'var(--yellow)' : 'var(--red)'
  const radius = 26
  const circumference = 2 * Math.PI * radius
  return (
    <div className="score-ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={radius} fill="none" stroke="var(--panel-3)" strokeWidth="4" />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke={stroke}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - (value / 100) * circumference}
        />
      </svg>
      <span className="value" style={{ color: stroke, fontSize: size <= 48 ? 13 : 16 }}>
        {score === null || score === undefined ? '—' : Math.round(value)}
      </span>
    </div>
  )
}

export function Meter({ value, max = 100, tone = 'accent' }: { value: number; max?: number; tone?: 'accent' | 'green' | 'red' }) {
  const width = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className="meter" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className={cx('meter-fill', tone !== 'accent' && tone)} style={{ width: `${width}%` }} />
    </div>
  )
}

/* ------------------------------------------------------------------- input */

export function Field({
  label,
  hint,
  required,
  children,
  className
}: {
  label?: ReactNode
  hint?: ReactNode
  required?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cx('field', className)}>
      {label ? (
        <span className="label">
          {label} {required ? <span className="req">*</span> : null}
        </span>
      ) : null}
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  )
}

export function Input({ className, ...rest }: React.ComponentProps<'input'>) {
  return <input className={cx('input', className)} {...rest} />
}

export function Textarea({ className, ...rest }: React.ComponentProps<'textarea'>) {
  return <textarea className={cx('textarea', className)} {...rest} />
}

export function Select({ className, ...rest }: React.ComponentProps<'select'>) {
  return <select className={cx('select', className)} {...rest} />
}

export function CountrySelect({
  value,
  onChange,
  placeholder = 'Select a country',
  exclude = [],
  id
}: {
  value: string | null | undefined
  onChange: (value: string) => void
  placeholder?: string
  exclude?: string[]
  id?: string
}) {
  const excluded = new Set(exclude.filter((code) => code !== value).map((code) => code.toUpperCase()))
  return (
    <Select id={id} value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
      <option value="">{placeholder}</option>
      {groupedCountries().map((group) => (
        <optgroup key={group.region} label={group.region}>
          {group.countries
            .filter((item) => !excluded.has(item.code))
            .map((item) => (
              <option key={item.code} value={item.code}>
                {item.name} ({item.code})
              </option>
            ))}
        </optgroup>
      ))}
    </Select>
  )
}

export function CountryChips({
  values,
  onChange,
  exclude = [],
  addLabel = 'Add country'
}: {
  values: string[]
  onChange: (values: string[]) => void
  exclude?: string[]
  addLabel?: string
}) {
  const [pending, setPending] = useState('')
  const add = () => {
    if (!pending) return
    if (!values.includes(pending)) onChange([...values, pending])
    setPending('')
  }
  return (
    <div>
      <div className="row" style={{ gap: 8 }}>
        <CountrySelect value={pending} onChange={setPending} exclude={[...values, ...exclude]} placeholder="Choose a country" />
        <Button variant="secondary" iconOnly onClick={add} disabled={!pending} aria-label={addLabel}>
          <Plus />
        </Button>
      </div>
      {values.length > 0 ? (
        <div className="chip-list mt-2">
          {values.map((code) => (
            <span className="chip" key={code}>
              {countryLabelWithFlag(code)}
              <button type="button" aria-label={`Remove ${code}`} onClick={() => onChange(values.filter((item) => item !== code))}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function countryLabelWithFlag(code: string): string {
  try {
    const upper = code.toUpperCase()
    const flag = /^[A-Z]{2}$/.test(upper) ? String.fromCodePoint(...[...upper].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65)) : ''
    return `${flag} ${countryName(upper)}`.trim()
  } catch {
    return code
  }
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  label: string
}) {
  return (
    <SwitchPrimitive.Root
      className="switch"
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
    >
      <SwitchPrimitive.Thumb />
    </SwitchPrimitive.Root>
  )
}

export function SwitchRow({
  title,
  desc,
  checked,
  onCheckedChange,
  disabled
}: {
  title: ReactNode
  desc?: ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="switch-row">
      <div className="switch-row-text">
        <div className="switch-row-title">{title}</div>
        {desc ? <div className="switch-row-desc">{desc}</div> : null}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} label={typeof title === 'string' ? title : 'Toggle'} />
    </div>
  )
}

export function ChipEditor({
  values,
  onChange,
  placeholder = 'Add a value and press Enter',
  suggestions = []
}: {
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  suggestions?: string[]
}) {
  const [input, setInput] = useState('')
  const listId = useId()

  const commit = () => {
    const pieces = input
      .split(',')
      .map((piece) => piece.trim())
      .filter(Boolean)
    if (pieces.length === 0) return
    const next = [...values]
    for (const piece of pieces) {
      if (!next.some((value) => value.toLowerCase() === piece.toLowerCase())) next.push(piece)
    }
    onChange(next)
    setInput('')
  }

  return (
    <div>
      <div className="row" style={{ gap: 6 }}>
        <Input
          value={input}
          list={listId}
          placeholder={placeholder}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault()
              commit()
            }
            if (event.key === 'Backspace' && input === '' && values.length > 0) {
              onChange(values.slice(0, -1))
            }
          }}
          onBlur={() => {
            if (input.trim()) commit()
          }}
        />
        <Button size="md" variant="secondary" iconOnly onClick={commit} disabled={!input.trim()} aria-label="Add">
          <Plus />
        </Button>
        <datalist id={listId}>
          {suggestions.filter((item) => !values.includes(item)).map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      </div>
      {values.length > 0 ? (
        <div className="chip-list mt-2">
          {values.map((value) => (
            <span className="chip" key={value}>
              {value}
              <button type="button" aria-label={`Remove ${value}`} onClick={() => onChange(values.filter((item) => item !== value))}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/* ----------------------------------------------------------------- modal */

export function Modal({
  open,
  onOpenChange,
  title,
  desc,
  size = 'md',
  footer,
  children
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  desc?: ReactNode
  size?: 'md' | 'lg' | 'xl'
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="overlay" />
        <DialogPrimitive.Content className={cx('modal', size === 'lg' && 'modal-lg', size === 'xl' && 'modal-xl')}>
          <div className="modal-head">
            <div style={{ minWidth: 0 }}>
              <DialogPrimitive.Title className="modal-title">{title}</DialogPrimitive.Title>
              {desc ? <DialogPrimitive.Description className="modal-desc">{desc}</DialogPrimitive.Description> : null}
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="sm" iconOnly className="modal-close" aria-label="Close">
                <X />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <div className="modal-body">{children}</div>
          {footer ? <div className="modal-foot">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  onConfirm,
  busy = false,
  tone = 'danger'
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description: ReactNode
  confirmLabel?: string
  onConfirm: () => void
  busy?: boolean
  tone?: 'danger' | 'primary'
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="small muted" style={{ lineHeight: 1.6 }}>
        {description}
      </div>
    </Modal>
  )
}

/* -------------------------------------------------------------- navigation */

export function Segmented<T extends string>({
  options,
  value,
  onChange
}: {
  options: { value: T; label: ReactNode; disabled?: boolean }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="segmented" role="group">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? 'active' : undefined}
          onClick={() => onChange(option.value)}
          disabled={option.disabled}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Tabs<T extends string>({
  options,
  value,
  onChange
}: {
  options: { value: T; label: ReactNode; count?: number }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="tabs" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className={cx('tab', option.value === value && 'active')}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {typeof option.count === 'number' ? <span className="n">{option.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

export function Pagination({
  total,
  limit,
  offset,
  onChange
}: {
  total: number
  limit: number
  offset: number
  onChange: (offset: number) => void
}) {
  if (total <= limit && offset === 0) return null
  const start = total === 0 ? 0 : offset + 1
  const end = Math.min(offset + limit, total)
  return (
    <div className="pagination">
      <span>
        Showing {start}–{end} of {total}
      </span>
      <span className="spacer" />
      <Button size="sm" variant="ghost" iconOnly disabled={offset <= 0} onClick={() => onChange(Math.max(0, offset - limit))} aria-label="Previous page">
        <ChevronLeft />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        iconOnly
        disabled={offset + limit >= total}
        onClick={() => onChange(offset + limit)}
        aria-label="Next page"
      >
        <ChevronRight />
      </Button>
    </div>
  )
}

/* -------------------------------------------------------------- feedback */

export function EmptyState({
  icon: Icon,
  title,
  desc,
  action
}: {
  icon?: LucideIcon
  title: ReactNode
  desc?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="empty">
      {Icon ? (
        <div className="empty-icon">
          <Icon />
        </div>
      ) : null}
      <div className="empty-title">{title}</div>
      {desc ? <div className="empty-desc">{desc}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

export function Notice({
  tone = 'neutral',
  icon: Icon,
  children,
  className
}: {
  tone?: 'neutral' | 'warn' | 'danger' | 'info' | 'accent' | 'success'
  icon?: LucideIcon
  children: ReactNode
  className?: string
}) {
  const DefaultIcon = tone === 'success' ? CheckCircle2 : tone === 'warn' || tone === 'danger' ? AlertTriangle : Info
  const IconComponent = Icon ?? DefaultIcon
  return (
    <div className={cx('notice', tone !== 'neutral' && `notice-${tone}`, className)}>
      <IconComponent />
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  )
}

export function PageError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Panel>
      <div className="empty">
        <div className="empty-icon">
          <XCircle />
        </div>
        <div className="empty-title">This view could not load</div>
        <div className="empty-desc">{error instanceof Error ? error.message : String(error)}</div>
        {onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry} className="mt-2">
            <RefreshCw /> Try again
          </Button>
        ) : null}
      </div>
    </Panel>
  )
}

export function PageLoading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="empty">
      <Loader2 className="spin" size={22} />
      <div className="empty-desc">{label}…</div>
    </div>
  )
}

/* ------------------------------------------------------------------ data viz */

export function Timeline({
  items
}: {
  items: { id: React.Key; title: ReactNode; meta?: ReactNode; level?: 'info' | 'warn' | 'error' | 'success'; ts?: number | null }[]
}) {
  if (items.length === 0) return <EmptyState title="No recorded activity" desc="Events appear here as the worker acts." />
  return (
    <div className="timeline">
      {items.map((item) => (
        <div className="timeline-item" key={item.id}>
          <span className={cx('timeline-dot', item.level)} />
          <div className="timeline-title">{item.title}</div>
          {item.meta ? <div className="timeline-meta">{item.meta}</div> : null}
        </div>
      ))}
    </div>
  )
}

export function Bars({ items }: { items: { label: string; value: number; soft?: number; title?: string }[] }) {
  const max = Math.max(...items.map((item) => item.value + (item.soft ?? 0)), 1)
  return (
    <div className="bars">
      {items.map((item) => {
        const total = item.value + (item.soft ?? 0)
        return (
          <div className="bar-col" key={item.label} title={item.title ?? `${item.label}: ${item.value}`}>
            <div className="bar-stack" style={{ height: `${Math.max(total === 0 ? 2 : (total / max) * 100, 2)}%` }}>
              {item.soft ? <div className="bar-seg soft" style={{ height: `${(item.soft / total) * 100}%` }} /> : null}
              {item.value ? <div className="bar-seg" style={{ height: `${(item.value / total) * 100}%` }} /> : null}
            </div>
            <span className="bar-label">{item.label}</span>
          </div>
        )
      })}
    </div>
  )
}

export function SearchInput({ value, onChange, placeholder = 'Search' }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <div className="search">
      <Search />
      <input className="input" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </div>
  )
}

export function KV({ items }: { items: { k: ReactNode; v: ReactNode }[] }) {
  return (
    <dl className="kv">
      {items.map((item, index) => (
        <React.Fragment key={index}>
          <dt>{item.k}</dt>
          <dd>{item.v}</dd>
        </React.Fragment>
      ))}
    </dl>
  )
}

/* ------------------------------------------------------------------ toasts */

type ToastTone = 'success' | 'error' | 'info'
interface ToastItem {
  id: number
  message: string
  tone: ToastTone
}

interface ToastApi {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timers = useRef<number[]>([])
  const nextId = useRef(1)

  useEffect(() => {
    const list = timers.current
    return () => list.forEach((timer) => window.clearTimeout(timer))
  }, [])

  const push = useCallback((message: string, tone: ToastTone) => {
    const id = nextId.current++
    setToasts((current) => [...current.slice(-3), { id, message, tone }])
    const timer = window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id))
    }, tone === 'error' ? 8000 : 4500)
    timers.current.push(timer)
  }, [])

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => push(message, 'success'),
      error: (message) => push(message, 'error'),
      info: (message) => push(message, 'info')
    }),
    [push]
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-viewport" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div className={cx('toast', toast.tone)} key={toast.id}>
            {toast.tone === 'error' ? <XCircle /> : toast.tone === 'success' ? <CheckCircle2 /> : <Info />}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside ToastProvider')
  return context
}

/* ------------------------------------------------------------------ errors */

export class ErrorBoundary extends React.Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Renderer error boundary', error, info.componentStack)
  }

  override render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ padding: 48, maxWidth: 720, margin: '0 auto' }}>
        <div className="brand" style={{ padding: 0, marginBottom: 24 }}>
          <div className="brand-mark">BT</div>
          <div>
            <div className="brand-name">BT Applicant</div>
            <div className="brand-sub">Recovery</div>
          </div>
        </div>
        <h1 className="page-title">The interface hit an unexpected error</h1>
        <p className="page-desc">Your data is stored locally and was not affected. Reload the window to resume.</p>
        <pre className="pre mt-4">{this.state.error.message}</pre>
        <div className="row mt-4">
          <Button variant="primary" onClick={() => window.location.reload()}>
            <RefreshCw /> Reload window
          </Button>
        </div>
      </div>
    )
  }
}
