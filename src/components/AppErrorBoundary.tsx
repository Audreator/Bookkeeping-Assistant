import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  onReload?: () => void
}

interface State {
  failed: boolean
}

/** 页面或旧缓存的懒加载文件异常时，由用户决定何时刷新恢复。 */
export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  override render() {
    if (!this.state.failed) return this.props.children
    const reload = this.props.onReload ?? (() => window.location.reload())
    return <main className="app-shell flex min-h-dvh items-center justify-center px-5 py-10">
      <section className="glass-card w-full max-w-md p-6 text-center">
        <h1 className="text-lg font-semibold text-stone-900">页面暂时无法显示</h1>
        <p role="alert" className="mt-3 text-sm leading-relaxed text-stone-500">页面已更新或加载遇到问题，请刷新重试</p>
        <button type="button" onClick={reload} className="mt-5 rounded-xl bg-brand-700 px-6 py-2.5 text-sm font-medium text-white">刷新页面</button>
      </section>
    </main>
  }
}
