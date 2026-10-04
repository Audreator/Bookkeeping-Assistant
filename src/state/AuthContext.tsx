import { useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api, getToken, setToken } from '../api/client'
import type { User } from '../api/types'
import { prehashPassword } from '../lib/password'

interface AuthValue {
  user: User | null
  ready: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    const boot = async () => {
      if (!getToken()) {
        setReady(true)
        return
      }
      try {
        const res = await api.get<{ user: User }>('/api/auth/me')
        if (!cancelled) setUser(res.user)
      } catch {
        setToken(null)
      }
      if (!cancelled) setReady(true)
    }
    void boot()
    const onUnauthorized = () => setUser(null)
    window.addEventListener('jizhang:unauthorized', onUnauthorized)
    return () => {
      cancelled = true
      window.removeEventListener('jizhang:unauthorized', onUnauthorized)
    }
  }, [])

  const login = useCallback(
    async (username: string, password: string) => {
      const res = await api.post<{ token: string; user: User }>('/api/auth/login', {
        username,
        password: prehashPassword(password),
      })
      setToken(res.token)
      setUser(res.user)
      qc.clear()
    },
    [qc],
  )

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout')
    } catch {
      // token 可能已失效，忽略
    }
    setToken(null)
    setUser(null)
    qc.clear()
  }, [qc])

  const value = useMemo(() => ({ user, ready, login, logout }), [user, ready, login, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用')
  return ctx
}
