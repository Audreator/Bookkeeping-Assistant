import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TabBar } from './TabBar'

let reducedMotion = false
const mediaListeners = new Set<(event: MediaQueryListEvent) => void>()
type TestAnimation = {
  cancel: ReturnType<typeof vi.fn>
  onfinish: Animation['onfinish']
  oncancel: Animation['oncancel']
}
const animations: TestAnimation[] = []
const animate = vi.fn(function (this: Element, _keyframes: Keyframe[] | PropertyIndexedKeyframes, _options?: KeyframeAnimationOptions) {
  const animation: TestAnimation = { cancel: vi.fn(), onfinish: null, oncancel: null }
  animation.cancel.mockImplementation(() => animation.oncancel?.call(animation as unknown as Animation, new Event('cancel') as AnimationPlaybackEvent))
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

function directionalFrames(callIndex: number) {
  return (animate.mock.calls[callIndex]![0] as Keyframe[]).map((frame) => {
    const transform = String(frame.transform)
    const shift = Number(/translateX\(([-\d.]+)px\)/.exec(transform)?.[1] ?? 0)
    const skew = Number(/skewX\(([-\d.]+)deg\)/.exec(transform)?.[1] ?? 0)
    const scale = /scale\(([-\d.]+)(?:,\s*([-\d.]+))?\)/.exec(transform)
    return { shift, skew, scaleX: Number(scale?.[1] ?? 1), scaleY: Number(scale?.[2] ?? scale?.[1] ?? 1) }
  })
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
  vi.restoreAllMocks()
  vi.useRealTimers()
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

  it('左右移动的拉伸与惯性镜像，横向形变明显大于纵向且只回弹一次', async () => {
    const rightView = renderTabs('/planner')
    fireEvent.click(screen.getByRole('link', { name: '统计' }))
    await waitFor(() => expect(animate).toHaveBeenCalledTimes(1))
    const right = directionalFrames(0)
    rightView.unmount()

    renderTabs('/stats')
    fireEvent.click(screen.getByRole('link', { name: '规划' }))
    await waitFor(() => expect(animate).toHaveBeenCalledTimes(2))
    const left = directionalFrames(1)
    expect(right.some((frame) => frame.shift < 0)).toBe(true)
    expect(right.some((frame) => frame.shift > 0)).toBe(true)
    const peak = right.reduce((largest, frame) => frame.scaleX > largest.scaleX ? frame : largest)
    expect(peak.scaleX).toBeGreaterThanOrEqual(1.6)
    expect(peak.scaleX).toBeGreaterThan(peak.scaleY)
    expect(right.every((frame) => frame.skew === 0)).toBe(true)
    expect(right.filter((frame) => frame.scaleX < 1)).toHaveLength(1)
    expect(left).toHaveLength(right.length)
    left.forEach((frame, index) => {
      expect(frame.shift).toBeCloseTo(-right[index]!.shift)
      expect(frame.skew).toBeCloseTo(-right[index]!.skew)
      expect(frame.scaleX).toBe(right[index]!.scaleX)
      expect(frame.scaleY).toBe(right[index]!.scaleY)
    })
    expect(right.at(-1)).toEqual({ shift: 0, skew: 0, scaleX: 1, scaleY: 1 })
    const options = animate.mock.calls[0]![1] as KeyframeAnimationOptions
    expect(options.iterations).toBe(1)
    expect(Number(options.duration)).toBeLessThanOrEqual(700)
  })

  it('跨越更多入口时惯性适度增强，不改变图标文字或菜单外框', async () => {
    renderTabs()
    fireEvent.click(screen.getByRole('link', { name: '账本' }))
    await waitFor(() => expect(animate).toHaveBeenCalledTimes(1))
    const shortPeak = Math.max(...directionalFrames(0).map((frame) => frame.scaleX))
    fireEvent.click(screen.getByRole('link', { name: '设置' }))
    await waitFor(() => expect(animate).toHaveBeenCalledTimes(2))
    const longPeak = Math.max(...directionalFrames(1).map((frame) => frame.scaleX))
    expect(longPeak).toBeGreaterThan(shortPeak)
    expect(longPeak).toBeLessThanOrEqual(1.75)
    expect(animate.mock.contexts.every((element) => (element as Element).classList.contains('tab-selection-shape'))).toBe(true)
    expect(document.querySelector('.glass-tabbar')?.getAttribute('style')).toBeNull()
    expect(screen.getByRole('link', { name: '设置' }).getAttribute('style')).toBeNull()
  })

  it('快速反向切换先保留当前矩阵，取消旧动画后以相反方向续弹', async () => {
    renderTabs()
    fireEvent.click(screen.getByRole('link', { name: '账本' }))
    await waitFor(() => expect(animate).toHaveBeenCalledTimes(1))
    const shape = selection().querySelector<HTMLElement>('.tab-selection-shape')!
    const interruptedTransform = 'matrix(1.41, 0, 0, 1.16, 6, 0)'
    shape.style.transform = interruptedTransform
    fireEvent.click(screen.getByRole('link', { name: '今天' }))
    await waitFor(() => expect(animate).toHaveBeenCalledTimes(2))
    expect(animations[0]!.cancel).toHaveBeenCalledTimes(1)
    expect((animate.mock.calls[1]![0] as Keyframe[])[0]!.transform).toBe(interruptedTransform)
    expect(directionalFrames(1).some((frame) => frame.shift < 0 && frame.scaleX >= 1.6)).toBe(true)
    expect(screen.getByRole('link', { name: '今天' }).getAttribute('aria-current')).toBe('page')
  })

  it.each([
    { initial: '/', first: '设置', redirectedLeft: 55, expectedDirection: 1 },
    { initial: '/settings', first: '今天', redirectedLeft: 260, expectedDirection: -1 },
  ])('连续导航从 $initial 经 $first 到规划时，形变依据实际当前位置而不是上一个目标', ({ initial, first, redirectedLeft, expectedDirection }) => {
    renderTabs(initial)
    const highlight = selection()
    const track = highlight.parentElement!
    let currentLeft = initial === '/' ? 20 : 300
    vi.spyOn(highlight, 'getBoundingClientRect').mockImplementation(() => new DOMRect(currentLeft, 0, 70, 60))
    vi.spyOn(track, 'getBoundingClientRect').mockImplementation(() => new DOMRect(20, 0, 350, 50))
    fireEvent.click(screen.getByRole('link', { name: first }))
    currentLeft = redirectedLeft
    fireEvent.click(screen.getByRole('link', { name: '规划' }))
    const peak = directionalFrames(1).reduce((largest, frame) => frame.scaleX > largest.scaleX ? frame : largest)
    expect(Math.sign(peak.shift)).toBe(expectedDirection)
    expect(peak.scaleX).toBeGreaterThanOrEqual(1.6)
    expect(selection().getAttribute('style')).toContain('translateX(200%)')
    expect(highlight.querySelector('.tab-selection-shape')?.getAttribute('data-moving')).toBe('true')
  })

  it('移动和回弹期间保持透明标识，实际形变完成后才恢复静止材质', () => {
    renderTabs()
    const shape = selection().querySelector<HTMLElement>('.tab-selection-shape')!
    expect(shape.getAttribute('data-moving')).not.toBe('true')
    fireEvent.click(screen.getByRole('link', { name: '账本' }))
    expect(shape.getAttribute('data-moving')).toBe('true')
    expect(animations[0]!.onfinish).toBeTypeOf('function')
    act(() => animations[0]!.onfinish?.call(animations[0] as unknown as Animation, new Event('finish') as AnimationPlaybackEvent))
    expect(shape.getAttribute('data-moving')).not.toBe('true')
  })

  it('旧形变的延迟完成或取消回调不清除新运动的透明标识', () => {
    renderTabs()
    const shape = selection().querySelector<HTMLElement>('.tab-selection-shape')!
    fireEvent.click(screen.getByRole('link', { name: '账本' }))
    const old = animations[0]!
    const oldFinish = old.onfinish
    const oldCancel = old.oncancel
    expect(oldFinish).toBeTypeOf('function')
    expect(oldCancel).toBeTypeOf('function')
    fireEvent.click(screen.getByRole('link', { name: '设置' }))
    expect(old.cancel).toHaveBeenCalledTimes(1)
    act(() => {
      oldFinish?.call(old as unknown as Animation, new Event('finish') as AnimationPlaybackEvent)
      oldCancel?.call(old as unknown as Animation, new Event('cancel') as AnimationPlaybackEvent)
    })
    expect(shape.getAttribute('data-moving')).toBe('true')
    act(() => animations[1]!.onfinish?.call(animations[1] as unknown as Animation, new Event('finish') as AnimationPlaybackEvent))
    expect(shape.getAttribute('data-moving')).not.toBe('true')
  })

  it('缺少 Web Animations 时透明标识覆盖 CSS 位移，快速切换会重新计时', () => {
    vi.useFakeTimers()
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: undefined })
    renderTabs()
    const shape = selection().querySelector<HTMLElement>('.tab-selection-shape')!
    fireEvent.click(screen.getByRole('link', { name: '账本' }))
    expect(shape.getAttribute('data-moving')).toBe('true')
    act(() => vi.advanceTimersByTime(300))
    fireEvent.click(screen.getByRole('link', { name: '设置' }))
    act(() => vi.advanceTimersByTime(321))
    expect(shape.getAttribute('data-moving')).toBe('true')
    act(() => vi.advanceTimersByTime(299))
    expect(shape.getAttribute('data-moving')).not.toBe('true')
    expect(animate).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: '设置' }).getAttribute('aria-current')).toBe('page')
  })

  it('缺少 Web Animations 的运动仍响应减少动态效果并在卸载时清除计时', () => {
    vi.useFakeTimers()
    const scheduleTimer = vi.spyOn(globalThis, 'setTimeout')
    const clearTimer = vi.spyOn(globalThis, 'clearTimeout')
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: undefined })
    const view = renderTabs()
    const shape = selection().querySelector<HTMLElement>('.tab-selection-shape')!
    fireEvent.click(screen.getByRole('link', { name: '账本' }))
    expect(shape.getAttribute('data-moving')).toBe('true')
    const firstTimerIndex = scheduleTimer.mock.calls.findIndex((call) => call[1] === 620)
    expect(firstTimerIndex).toBeGreaterThanOrEqual(0)
    const firstTimer = scheduleTimer.mock.results[firstTimerIndex]!.value
    act(() => {
      reducedMotion = true
      for (const listener of mediaListeners) listener({ matches: true, media: '(prefers-reduced-motion: reduce)' } as MediaQueryListEvent)
    })
    expect(shape.getAttribute('data-moving')).not.toBe('true')
    expect(clearTimer).toHaveBeenCalledWith(firstTimer)
    reducedMotion = false
    fireEvent.click(screen.getByRole('link', { name: '设置' }))
    expect(shape.getAttribute('data-moving')).toBe('true')
    const nextTimerIndex = scheduleTimer.mock.calls.findLastIndex((call) => call[1] === 620)
    const nextTimer = scheduleTimer.mock.results[nextTimerIndex]!.value
    view.unmount()
    expect(clearTimer).toHaveBeenCalledWith(nextTimer)
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
    expect(selection().querySelector('.tab-selection-shape')?.getAttribute('data-moving')).not.toBe('true')
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
