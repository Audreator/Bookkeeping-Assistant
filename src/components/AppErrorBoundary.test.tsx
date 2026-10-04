import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { lazy, Suspense } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary } from './AppErrorBoundary'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('AppErrorBoundary', () => {
  it('正常渲染应用内容，不显示恢复提示', () => {
    render(<AppErrorBoundary><p>账本页面正常</p></AppErrorBoundary>)
    expect(screen.getByText('账本页面正常')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: '刷新页面' })).toBeNull()
  })

  it('动态页面文件加载失败时给出中文恢复提示，不自动刷新或展示原始诊断', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const reload = vi.fn()
    const UnavailablePage = lazy(async () => {
      throw new TypeError('Failed to fetch dynamically imported module: private-diagnostic')
    })
    render(<AppErrorBoundary onReload={reload}>
      <Suspense fallback={<p>正在加载页面…</p>}><UnavailablePage /></Suspense>
    </AppErrorBoundary>)
    expect((await screen.findByRole('alert')).textContent).toBe('页面已更新或加载遇到问题，请刷新重试')
    expect(screen.queryByText(/private-diagnostic/)).toBeNull()
    expect(reload).not.toHaveBeenCalled()
  })

  it('子树异常可通过用户点击刷新页面恢复，仅在点击时调用刷新', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const reload = vi.fn()
    function BrokenPage(): never { throw new Error('测试页面异常') }
    render(<AppErrorBoundary onReload={reload}><BrokenPage /></AppErrorBoundary>)
    expect(reload).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '刷新页面' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
