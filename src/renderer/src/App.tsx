import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { call, hasBridge } from './lib/api'
import { Button, EmptyState, ErrorBoundary, ToastProvider } from './components/ui'
import AppShell from './components/AppShell'
import Onboarding from './components/Onboarding'
import Dashboard from './pages/Dashboard'
import DailyReport from './pages/DailyReport'
import Jobs from './pages/Jobs'
import JobDetail from './pages/JobDetail'
import Applications from './pages/Applications'
import ApplicationDetail from './pages/ApplicationDetail'
import Approvals from './pages/Approvals'
import Sources from './pages/Sources'
import Targets from './pages/Targets'
import Profile from './pages/Profile'
import WorkAuthorization from './pages/WorkAuthorization'
import Resumes from './pages/Resumes'
import Roles from './pages/Roles'
import Templates from './pages/Templates'
import AiProviders from './pages/AiProviders'
import Automation from './pages/Automation'
import Chat from './pages/Chat'
import Queue from './pages/Queue'
import Activity from './pages/Activity'
import Diagnostics from './pages/Diagnostics'

export default function App() {
  const queryClient = useQueryClient()
  const bootstrap = useQuery({
    queryKey: ['bootstrap'],
    queryFn: () => call('app.bootstrap'),
    refetchInterval: 20_000,
    staleTime: 5_000
  })

  const settings = bootstrap.data?.settings
  const theme = settings?.ui.theme ?? 'system'
  const density = settings?.ui.density ?? 'comfortable'

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const apply = () => {
      const resolved = theme === 'system' ? (media.matches ? 'light' : 'dark') : theme
      document.documentElement.dataset.theme = resolved
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  useEffect(() => {
    document.documentElement.dataset.density = density
  }, [density])

  if (!hasBridge()) {
    return (
      <Frame>
        <div className="brand" style={{ padding: 0, marginBottom: 24 }}>
          <div className="brand-mark">BT</div>
          <div>
            <div className="brand-name">BT Applicant</div>
            <div className="brand-sub">Desktop bridge missing</div>
          </div>
        </div>
        <h1 className="page-title">Open the desktop app</h1>
        <p className="page-desc">
          This window is not connected to the local Electron runtime, so it cannot reach your database. Start BT Applicant from the installed
          application or with <span className="code">npm run dev</span>.
        </p>
      </Frame>
    )
  }

  if (bootstrap.isLoading && !bootstrap.data) {
    return (
      <Frame>
        <div className="brand" style={{ padding: 0, marginBottom: 22 }}>
          <div className="brand-mark">BT</div>
          <div>
            <div className="brand-name">BT Applicant</div>
            <div className="brand-sub">Opening local workspace</div>
          </div>
        </div>
        <div className="row muted">
          <Loader2 className="spin" size={18} /> Reading the local database…
        </div>
      </Frame>
    )
  }

  if (bootstrap.error) {
    return (
      <Frame>
        <h1 className="page-title">The local workspace could not start</h1>
        <p className="page-desc">{bootstrap.error instanceof Error ? bootstrap.error.message : String(bootstrap.error)}</p>
        <div className="row mt-4">
          <Button variant="primary" onClick={() => bootstrap.refetch()}>
            Try again
          </Button>
        </div>
        <p className="fine-print mt-4">
          Logs live in the app’s user data folder. If this is the first launch after an update, close the app completely and reopen it once.
        </p>
      </Frame>
    )
  }

  const data = bootstrap.data!

  if (!data.onboarded) {
    return (
      <ErrorBoundary>
        <ToastProvider>
          <Onboarding
            bootstrap={data}
            onComplete={() => {
              queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
              void bootstrap.refetch()
            }}
          />
        </ToastProvider>
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary>
      <ToastProvider>
        <DataBridge />
        <AppShell bootstrap={data}>
          <RoutesWithBoundary />
        </AppShell>
      </ToastProvider>
    </ErrorBoundary>
  )
}

function DataBridge() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  useEffect(() => {
    if (!hasBridge()) return
    let timer: number | undefined
    const offData = window.api.onDataChanged(() => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        void queryClient.invalidateQueries()
      }, 300)
    })
    const offNavigate = window.api.onNavigate((path) => {
      if (path.startsWith('/')) navigate(path)
    })
    return () => {
      if (timer) window.clearTimeout(timer)
      offData()
      offNavigate()
    }
  }, [queryClient, navigate])

  return null
}

function RoutesWithBoundary() {
  const location = useLocation()
  return (
    <ErrorBoundary key={location.pathname}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/daily" element={<DailyReport />} />
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/jobs/:id" element={<JobDetail />} />
        <Route path="/applications" element={<Applications />} />
        <Route path="/applications/:id" element={<ApplicationDetail />} />
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/sources" element={<Sources />} />
        <Route path="/targets" element={<Targets />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/authorization" element={<WorkAuthorization />} />
        <Route path="/resumes" element={<Resumes />} />
        <Route path="/roles" element={<Roles />} />
        <Route path="/templates" element={<Templates />} />
        <Route path="/ai" element={<AiProviders />} />
        <Route path="/automation" element={<Automation />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/queue" element={<Queue />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/diagnostics" element={<Diagnostics />} />
        <Route
          path="*"
          element={
            <EmptyState
              title="Page not found"
              desc="The address does not match a page in this workspace."
              action={
                <Link to="/">
                  <Button variant="secondary">Back to dashboard</Button>
                </Link>
              }
            />
          }
        />
      </Routes>
    </ErrorBoundary>
  )
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ height: '100vh', display: 'grid', placeItems: 'center', padding: 32 }}>
      <div style={{ width: 'min(620px, 100%)' }}>{children}</div>
    </div>
  )
}
