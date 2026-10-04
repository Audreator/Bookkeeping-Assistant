const TOKEN_KEY = 'jizhang.token'

// 子路径部署时由构建变量 VITE_API_BASE 注入前缀（如 /m9f8...），默认空串（根路径部署）。
const API_PREFIX = import.meta.env.VITE_API_BASE ?? ''

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
