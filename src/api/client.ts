import { resolveApiPrefix } from '../lib/apiBase'

const TOKEN_KEY = 'jizhang.token'

// 显式配置优先；缺省跟随页面部署目录，避免子路径静态更新后请求根 /api。
const API_PREFIX = resolveApiPrefix(import.meta.env.VITE_API_BASE, import.meta.env.BASE_URL, window.location.href)

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY)
export const setToken = (token: string | null): void => {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  const token = getToken()
  if (token) headers.authorization = `Bearer ${token}`

  const res = await fetch(API_PREFIX + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const refreshedToken = res.headers.get('x-jizhang-token')
  if (refreshedToken) setToken(refreshedToken)

  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    setToken(null)
    window.dispatchEvent(new Event('jizhang:unauthorized'))
  }
  if (!res.ok) {
    let message = '请求失败，请稍后再试'
    try {
      const data = (await res.json()) as { error?: string }
      if (data.error) message = data.error
    } catch {
      // ignore
    }
    throw new ApiError(res.status, message)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T = void>(path: string) => request<T>('DELETE', path),
}
