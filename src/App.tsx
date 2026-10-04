import { Navigate, Route, Routes } from 'react-router-dom'
import { TabBar } from './components/TabBar'
import { Ledger } from './pages/Ledger'
import { Login } from './pages/Login'
import { Planner } from './pages/Planner'
import { Settings } from './pages/Settings'
import { Page } from './components/Page'
import { Today } from './pages/Today'
import { useAuth } from './state/AuthContext'

const Stats = lazy(() => import('./pages/Stats').then((module) => ({ default: module.Stats })))

export default function App() {
  const { user, ready } = useAuth()

  if (!ready) {
    return (
      <div className="app-shell flex min-h-dvh items-center justify-center text-stone-500">
        加载中…
      </div>
    )
  }
  if (!user) return <Login />

  return (
    <div className="app-shell min-h-dvh text-stone-900">
      <Routes>
        <Route path="/" element={<Today />} />
        <Route path="/ledger" element={<Ledger />} />
        <Route path="/planner" element={<Planner />} />
        <Route path="/stats" element={<Suspense fallback={<Page><p role="status" className="py-20 text-center text-stone-500">正在加载统计…</p></Page>}><Stats /></Suspense>} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <TabBar />
    </div>
  )
}
import { lazy, Suspense } from 'react'
