import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TabBar } from './TabBar'

let reducedMotion = false
const mediaListeners = new Set<(event: MediaQueryListEvent) => void>()
const animations: Array<{ cancel: ReturnType<typeof vi.fn> }> = []
const animate = vi.fn(function (this: Element, _keyframes: Keyframe[] | PropertyIndexedKeyframes, _options?: KeyframeAnimationOptions) {
  const animation = { cancel: vi.fn() }
  animations.push(animation)
  return animation as unknown as Animation
})
const removeListener = vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => mediaListeners.delete(listener))
const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')
const originalGetAnimations = Object.getOwnPropertyDescriptor(Element.prototype, 'getAnimations')

function renderTabs(initialEntry = '/') {
  return render(<MemoryRouter initialEntries={[initialEntry]}><TabBar /></MemoryRouter>)
}

function selection() {
  const element = document.querySelector<HTMLElement>('.tab-selection')
  expect(element).not.toBeNull()
  return element!
}

beforeEach(() => {
  reducedMotion = false
  mediaListeners.clear()
  animations.length = 0
  animate.mockClear()
  removeListener.mockClear()
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    get matches() { return reducedMotion },
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => mediaListeners.add(listener),
    removeEventListener: removeListener,
  })))
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate })
  Object.defineProperty(Element.prototype, 'getAnimations', {
    configurable: true,
    value: () => animations.filter((animation) => animation.cancel.mock.calls.length === 0),
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate)
  else Reflect.deleteProperty(Element.prototype, 'animate')
  if (originalGetAnimations) Object.defineProperty(Element.prototype, 'getAnimations', originalGetAnimations)
  else Reflect.deleteProperty(Element.prototype, 'getAnimations')
})

describe('TabBar 滑动与单次弹性反馈', () => {
  it('直接打开大小写不同的有效路由时，胶囊仍与当前入口一致', () => {
    const normal = renderTabs('/planner')
    const position = selection().getAttribute('style')
    normal.unmount()
    renderTabs('/PlAnNeR')
    expect(screen.getByRole('link', { name: '规划' }).getAttribute('aria-current')).toBe('page')
    expect(selection().getAttribute('style')).toBe(position)
    expect(animate).not.toHaveBeenCalled()
  })

  it('首次加载保持静止，切换页时移动共享选中层并只弹一次', async () => {
    renderTabs('/planner')
    const highlight = selection()
    expect(highlight.getAttribute('aria-hidden')).toBe('true')
    expect(highlight.querySelector('.tab-selection-shape')).not.toBeNull()
    expect(screen.getByRole('link', { name: '规划' }).getAttribute('aria-current')).toBe('page')
    expect(animate).not.toHaveBeenCalled()
    const originalPosition = highlight.getAttribute('style')

    fireEvent.click(screen.getByRole('link', { name: '统计' }))
    await waitFor(() => expect(animate).toHaveBeenCalledTimes(1))
    expect(selection()).toBe(highlight)
    expect(animate.mock.contexts[0]).toBe(highlight.querySelector('.tab-selection-shape'))
    expect(highlight.getAttribute('style')).not.toBe(originalPosition)
    expect(screen.getByRole('link', { name: '统计' }).getAttribute('aria-current')).toBe('page')
    const options = animate.mock.calls[0]?.[1] as KeyframeAnimationOptions | undefined
    expect(options?.iterations ?? 1).toBe(1)
  })

  it('当前页重复点击不重弹，快速切换取消旧形变后开始新形变', async () => {
    renderTabs()
    fireEvent.click(screen.getByRole('link', { name: '今天' }))
    expect(animate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('link', { name: '账本' }))
    await waitFor(() => expect(animate).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('link', { name: '账本' }))
    expect(animate).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('link', { name: '设置' }))
    await waitFor(() => expect(animate).toHaveBeenCalledTimes(2))
    expect(animations[0]!.cancel).toHaveBeenCalled()
    expect(animations[1]!.cancel).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: '设置' }).getAttribute('aria-current')).toBe('page')
  })

  it('减少动态效果时仍可导航，运行中开启该设置会取消形变', async () => {
    reducedMotion = true
    const first = renderTabs()
    fireEvent.click(screen.getByRole('link', { name: '规划' }))
    expect(animate).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: '规划' }).getAttribute('aria-current')).toBe('page')
    first.unmount()

    reducedMotion = false
    renderTabs()
    fireEvent.click(screen.getByRole('link', { name: '账本' }))
    await waitFor(() => expect(animate).toHaveBeenCalledTimes(1))
    act(() => {
      reducedMotion = true
      for (const listener of mediaListeners) listener({ matches: true, media: '(prefers-reduced-motion: reduce)' } as MediaQueryListEvent)
    })
    expect(animations[0]!.cancel).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('link', { name: '设置' }))
    expect(animate).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link', { name: '设置' }).getAttribute('aria-current')).toBe('page')
  })

  it('卸载菜单时取消形变并移除媒体设置监听', async () => {
    const view = renderTabs()
    fireEvent.click(screen.getByRole('link', { name: '规划' }))
    await waitFor(() => expect(animate).toHaveBeenCalledTimes(1))
    expect(mediaListeners.size).toBeGreaterThan(0)
    view.unmount()
    expect(animations[0]!.cancel).toHaveBeenCalled()
    expect(removeListener).toHaveBeenCalled()
    expect(mediaListeners.size).toBe(0)
  })
})
