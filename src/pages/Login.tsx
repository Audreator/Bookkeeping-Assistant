import { useState, type FormEvent } from 'react'
import { useAuth } from '../state/AuthContext'

export function Login() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(username.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请稍后再试')
    } finally {
      setBusy(false)
    }
  }

  const inputClass =
    'w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 outline-none focus:border-brand-500'

  return (
    <div className="app-shell flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img className="login-logo mx-auto" src="./logo.svg" alt="记账本标志" width="70" height="70" />
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-stone-800">记账本</h1>
          <p className="mt-2 text-sm text-stone-500">每一笔，都心中有数</p>
        </div>

        <form onSubmit={submit} className="glass-card space-y-4 p-6">
          <label className="block text-sm">
            <span className="mb-1 block text-stone-500">用户名</span>
            <input
              className={inputClass}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-stone-500">密码</span>
            <input
              className={inputClass}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {error && <p role="alert" className="text-sm text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-brand-700 py-2.5 font-medium text-white disabled:opacity-50"
          >
            {busy ? '登录中…' : '登录'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-stone-400">
          私人账本 · 预算规划 · 每日结转 · 账单对账
        </p>
      </div>
    </div>
  )
}
