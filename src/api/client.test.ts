import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalUrl = window.location.href

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  vi.stubEnv('BASE_URL', './')
  vi.stubEnv('VITE_API_BASE', '')
})

afterEach(() => {
  window.history.replaceState(null, '', originalUrl)
  localStorage.clear()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('登录请求部署路径', () => {
  it('子路径登录和随后读取会话都走同一部署目录', async () => {
    window.history.replaceState(null, '', '/budget/#/login')
    const result = { token: 'synthetic-session', user: { id: 1, username: 'demo_owner', displayName: '演示用户' } }
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => result }))
    vi.stubGlobal('fetch', fetchMock)
    const { api, setToken } = await import('./client')
    const response = await api.post<typeof result>('/api/auth/login', { username: 'demo_owner', password: 'synthetic-prehash' })
    expect(response).toEqual(result)
    expect(fetchMock.mock.calls[0]).toEqual(['/budget/api/auth/login', expect.objectContaining({ method: 'POST' })])
    setToken(response.token)
    await api.get('/api/auth/me')
    expect(fetchMock.mock.calls[1]).toEqual(['/budget/api/auth/me', expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer synthetic-session' }),
    })])
  })

  it('根目录部署保持根 API 请求', async () => {
    window.history.replaceState(null, '', '/#/login')
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: true }) }))
    vi.stubGlobal('fetch', fetchMock)
    const { api } = await import('./client')
    await api.post('/api/auth/login', { username: 'demo_owner', password: 'synthetic-prehash' })
    expect(fetchMock.mock.calls[0]).toEqual(['/api/auth/login', expect.objectContaining({ method: 'POST' })])
  })
})
