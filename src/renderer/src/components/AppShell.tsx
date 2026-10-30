import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity,
  Briefcase,
  CalendarCheck,
  FileText,
  Globe2,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Mail,
  MessageCircle,
  Pause,
  Play,
  Plug,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Stamp,
  Stethoscope,
  Target,
  UserRound,
  Workflow,
  type LucideIcon
} from 'lucide-react'
import type { BootstrapDTO } from '@shared/api'
import { call } from '../lib/api'
import { aiModeLabels, fmtDate, timeAgo } from '../lib/format'
import { useNow } from '../lib/hooks'
import { Button, Input, Modal, StatusDot, cx, useToast } from './ui'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  badge?: number
}

export default function AppShell({ bootstrap, children }: { bootstrap: BootstrapDTO; children: React.ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const now = useNow(60_000)
  const system = bootstrap.system
  const counts = bootstrap.counts
  const settings = bootstrap.settings
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [paletteIndex, setPaletteIndex] = useState(0)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!paletteOpen) return
    setPaletteQuery('')
    setPaletteIndex(0)
  }, [paletteOpen])

  useEffect(() => {
    setPaletteIndex(0)
  }, [paletteQuery])

  const pause = useMutation({
    mutationFn: (paused: boolean) =>
      call('settings.save', { section: 'automation', value: { ...settings.automation, paused } }),
    onSuccess: (_data, paused) => {
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast[paused ? 'info' : 'success'](paused ? 'Autopilot paused. Queued work will wait.' : 'Autopilot resumed.')
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const scan = useMutation({
    mutationFn: async () => {
      const targets = bootstrap.targets.filter((target) => target.enabled)
      for (const target of targets) await call('targets.poll', { id: target.id })
      return targets.length
    },
    onSuccess: (count) => {
      toast[count > 0 ? 'success' : 'error'](count > 0 ? `Queued ${count} discovery scan${count === 1 ? '' : 's'}.` : 'No enabled target country yet.')
      queryClient.invalidateQueries({ queryKey: ['queue'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  })

  const groups: { label: string; items: NavItem[] }[] = [
    {
      label: 'Overview',
      items: [
        { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
        { to: '/daily', label: 'Daily report', icon: CalendarCheck }
      ]
    },
    {
      label: 'Pipeline',
      items: [
        { to: '/jobs', label: 'Jobs', icon: Briefcase },
        { to: '/applications', label: 'Applications', icon: Inbox },
        { to: '/approvals', label: 'Approvals', icon: ShieldCheck, badge: counts.awaitingApproval + counts.needsHuman },
        { to: '/sources', label: 'Sources', icon: Plug },
        { to: '/targets', label: 'Targets', icon: Globe2 },
        { to: '/roles', label: 'Roles', icon: Target }
      ]
    },
    {
      label: 'Configure',
      items: [
        { to: '/profile', label: 'Profile', icon: UserRound },
        { to: '/authorization', label: 'Work authorization', icon: Stamp },
        { to: '/resumes', label: 'Resumes', icon: FileText },
        { to: '/templates', label: 'Templates', icon: Mail },
        { to: '/ai', label: 'AI providers', icon: Sparkles },
        { to: '/automation', label: 'Automation & outbound', icon: Workflow },
        { to: '/chat', label: 'Chat', icon: MessageCircle }
      ]
    },
    {
      label: 'System',
      items: [
        { to: '/queue', label: 'Queue', icon: ListChecks, badge: counts.pendingTasks },
        { to: '/activity', label: 'Activity', icon: Activity },
        { to: '/diagnostics', label: 'Diagnostics', icon: Stethoscope }
      ]
    }
  ]

  const paletteItems: PaletteItem[] = [
    {
      id: 'action:pause',
      label: system.paused ? 'Resume autopilot' : 'Pause autopilot',
      group: 'Actions',
      icon: system.paused ? Play : Pause,
      hint: 'Automation',
      run: () => {
        pause.mutate(!system.paused)
        setPaletteOpen(false)
      }
    },
    {
      id: 'action:scan',
      label: 'Queue discovery scan',
      group: 'Actions',
      icon: RefreshCw,
      hint: 'Enabled targets',
      run: () => {
        scan.mutate()
        setPaletteOpen(false)
      }
    },
    {
      id: 'action:refresh',
      label: 'Refresh all data',
      group: 'Actions',
      icon: RefreshCw,
      hint: 'Reload queries',
      run: () => {
        void queryClient.invalidateQueries()
        setPaletteOpen(false)
        toast.info('Refreshing data')
      }
    },
    {
      id: 'action:chat',
      label: 'Open chat settings',
      group: 'Actions',
      icon: MessageCircle,
      hint: 'Telegram & WhatsApp',
      run: () => {
        navigate('/chat')
        setPaletteOpen(false)
      }
    },
    ...groups.flatMap((group) =>
      group.items.map((item) => ({
        id: `nav:${item.to}`,
        label: item.label,
        group: group.label,
        icon: item.icon,
        hint: item.to === '/' ? '/' : item.to,
        run: () => {
          navigate(item.to)
          setPaletteOpen(false)
        }
      }))
    )
  ]
  const paletteTerm = paletteQuery.trim().toLowerCase()
  const paletteResults = paletteItems
    .filter((item) => !paletteTerm || `${item.label} ${item.group} ${item.hint}`.toLowerCase().includes(paletteTerm))
    .sort((left, right) => paletteScore(left, paletteTerm) - paletteScore(right, paletteTerm))
    .slice(0, 12)
  const paletteSelected = Math.min(paletteIndex, Math.max(paletteResults.length - 1, 0))

  const workerTone = system.paused ? 'warn' : system.workerRunning ? 'success' : 'err'
  const aiOff = settings.ai.mode !== 'enhanced'
  const mailMock = system.mail.mode === 'mock'

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">BT</div>
          <div>
            <div className="brand-name">BT Applicant</div>
            <div className="brand-sub">Local autopilot</div>
          </div>
        </div>
        <nav className="side-scroll" aria-label="Primary">
          {groups.map((group) => (
            <div key={group.label}>
              <div className="nav-group">{group.label}</div>
              {group.items.map((item) => {
                const Icon = item.icon
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) => cx('nav-link', isActive && 'active')}
                  >
                    <Icon />
                    <span>{item.label}</span>
                    {item.badge ? <span className="nav-count">{item.badge > 99 ? '99+' : item.badge}</span> : null}
                  </NavLink>
                )
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="system-pill">
            <StatusDot tone={workerTone} pulse={!system.paused && system.workerRunning} />
            <span className="truncate">{system.paused ? 'Autopilot paused' : system.workerRunning ? 'Autopilot running' : 'Worker stopped'}</span>
            <span className="mono tiny faint" style={{ marginLeft: 'auto' }}>
              v{system.version}
            </span>
          </div>
          <div className="row-between mt-2" style={{ padding: '0 2px' }}>
            <span className="tiny faint">Local SQLite · no cloud</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-icon"
              title={system.paused ? 'Resume autopilot' : 'Pause autopilot'}
              onClick={() => pause.mutate(!system.paused)}
              disabled={pause.isPending}
            >
              {system.paused ? <Play /> : <Pause />}
            </button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-context">
            <span className="eyebrow" style={{ margin: 0 }}>
              Autopilot
            </span>
            <span className="faint">/</span>
            <span>{sectionTitle(location.pathname)}</span>
            <span className="faint">·</span>
            <span className="mono tiny">{fmtDate(now)} · {system.timeZone}</span>
          </div>
          <div className="topbar-spacer" />
          <button
            type="button"
            className="top-chip"
            onClick={() => pause.mutate(!system.paused)}
            title={system.paused ? 'Resume automation' : 'Pause all automation'}
          >
            <StatusDot tone={workerTone} pulse={!system.paused} />
            {system.paused ? 'Paused' : 'Running'}
          </button>
          <span className="top-chip" title="AI is an optional overlay. Discovery and drafting still work when it is unavailable.">
            <Sparkles size={12} style={{ color: aiOff ? 'var(--yellow)' : 'var(--purple)' }} />
            {aiModeLabels[settings.ai.mode]}
          </span>
          <span className="top-chip" title={system.mail.message}>
            <Mail size={12} style={{ color: mailMock ? 'var(--muted)' : 'var(--green)' }} />
            {mailMock ? 'Mock outbox' : 'SMTP live'}
            {system.mail.killSwitch ? <span className="tiny faint">· locked</span> : null}
          </span>
          <Button variant="secondary" size="sm" onClick={() => scan.mutate()} loading={scan.isPending} title="Queue a discovery scan for every enabled target">
            <RefreshCw /> Scan
          </Button>
          <button type="button" className="top-chip" onClick={() => setPaletteOpen(true)} title="Command palette (⌘K)" aria-label="Open command palette">
            ⌘K
          </button>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            title="Refresh all data"
            onClick={() => {
              queryClient.invalidateQueries()
              toast.info('Refreshing data')
            }}
          >
            <RefreshCw />
          </Button>
        </header>
        <main className="content">
          <div className="content-inner">{children}</div>
        </main>
      </div>

      <Modal open={paletteOpen} onOpenChange={setPaletteOpen} title="Jump to" desc="Search every page, or run a quick action. Press ⌘K at any time.">
        <div className="stack">
          <Input
            autoFocus
            value={paletteQuery}
            onChange={(event) => setPaletteQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setPaletteIndex(Math.min(paletteSelected + 1, paletteResults.length - 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setPaletteIndex(Math.max(paletteSelected - 1, 0))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                paletteResults[paletteSelected]?.run()
              }
            }}
            placeholder="Search pages and actions…"
            aria-label="Search pages and actions"
            role="combobox"
            aria-expanded={paletteResults.length > 0}
            aria-controls="command-palette-results"
            aria-activedescendant={paletteResults[paletteSelected] ? `palette-${paletteResults[paletteSelected]!.id}` : undefined}
          />
          <div
            id="command-palette-results"
            role="listbox"
            aria-label="Results"
            style={{ display: 'grid', gap: 4, maxHeight: 360, overflowY: 'auto' }}
          >
            {paletteResults.length === 0 ? (
              <div className="empty">
                <div className="empty-desc">No match. Try “approvals”, “chat”, or “pause”.</div>
              </div>
            ) : (
              paletteResults.map((item, index) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.id}
                    id={`palette-${item.id}`}
                    type="button"
                    role="option"
                    aria-selected={index === paletteSelected}
                    onMouseEnter={() => setPaletteIndex(index)}
                    onClick={() => item.run()}
                    className="nav-link"
                    style={{
                      width: '100%',
                      border: '1px solid transparent',
                      background: index === paletteSelected ? 'var(--accent-soft)' : undefined,
                      color: index === paletteSelected ? 'var(--accent)' : undefined,
                      textAlign: 'left',
                      cursor: 'pointer'
                    }}
                  >
                    <Icon />
                    <span>{item.label}</span>
                    <span className="tiny faint" style={{ marginLeft: 'auto' }}>
                      {item.group} · {item.hint}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      </Modal>
    </div>
  )
}

interface PaletteItem {
  id: string
  label: string
  group: string
  icon: LucideIcon
  hint: string
  run: () => void
}

function paletteScore(item: PaletteItem, term: string): number {
  if (!term) return item.group === 'Actions' ? 0 : 1
  const label = item.label.toLowerCase()
  if (label.startsWith(term)) return 0
  if (label.includes(term)) return 1
  return 2
}

function sectionTitle(pathname: string): string {
  if (pathname === '/') return 'Dashboard'
  if (/^\/daily/.test(pathname)) return 'Daily report'
  if (/^\/jobs\/\d+/.test(pathname)) return 'Job detail'
  if (/^\/jobs/.test(pathname)) return 'Jobs'
  if (/^\/applications\/\d+/.test(pathname)) return 'Application detail'
  if (/^\/applications/.test(pathname)) return 'Applications'
  if (/^\/approvals/.test(pathname)) return 'Approvals'
  if (/^\/sources/.test(pathname)) return 'Sources'
  if (/^\/targets/.test(pathname)) return 'Targets'
  if (/^\/roles/.test(pathname)) return 'Roles'
  if (/^\/profile/.test(pathname)) return 'Profile'
  if (/^\/authorization/.test(pathname)) return 'Work authorization'
  if (/^\/resumes/.test(pathname)) return 'Resumes'
  if (/^\/templates/.test(pathname)) return 'Templates'
  if (/^\/ai/.test(pathname)) return 'AI providers'
  if (/^\/automation/.test(pathname)) return 'Automation & outbound'
  if (/^\/chat/.test(pathname)) return 'Chat'
  if (/^\/queue/.test(pathname)) return 'Queue'
  if (/^\/activity/.test(pathname)) return 'Activity'
  if (/^\/diagnostics/.test(pathname)) return 'Diagnostics'
  return 'BT Applicant'
}
