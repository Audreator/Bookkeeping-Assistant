import { act, cleanup, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GlassRefraction } from './GlassRefraction'

let now = 0
let nextFrame = 0
const frames = new Map<number, FrameRequestCallback>()
const makeImage = vi.fn(() => 'data:image/png;base64,bWFw')
let shell: HTMLDivElement
let source: HTMLElement
let sourceClone: ReturnType<typeof vi.spyOn>

function Fixture({ motionKey = 0 }: { motionKey?: number }) {
  const surfaceRef = useRef<HTMLElement>(null)
  return <nav ref={surfaceRef} className="glass-tabbar" style={{ borderRadius: 36 }}>
    <GlassRefraction surfaceRef={surfaceRef} motionKey={motionKey} />
  </nav>
}

function flushFrame(time = now) {
  now = time
  const callbacks = [...frames.values()]
  frames.clear()
  act(() => { callbacks.forEach((callback) => callback(time)) })
}

async function flushMutations() {
  await act(async () => { await Promise.resolve() })
}

beforeEach(() => {
  now = 0
  nextFrame = 0
  frames.clear()
  makeImage.mockClear()
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    const frame = ++nextFrame
    frames.set(frame, callback)
    return frame
  }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((frame: number) => frames.delete(frame)))
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    putImageData: vi.fn(),
  }) as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(makeImage)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.matches('.glass-tabbar') ? 100 : this.matches('.app-page') ? 390 : 0
  })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.matches('.glass-tabbar') ? 70 : this.matches('.app-page') ? 1200 : 0
  })
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
    return this.matches('.glass-tabbar') ? 98 : 0
  })
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
    return this.matches('.glass-tabbar') ? 68 : 0
  })
  vi.spyOn(Element.prototype, 'clientLeft', 'get').mockReturnValue(1)
  vi.spyOn(Element.prototype, 'clientTop', 'get').mockReturnValue(1)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return this.matches('.glass-tabbar')
      ? { left: 30, top: 730, width: 110, height: 84, right: 140, bottom: 814, x: 30, y: 730, toJSON: () => ({}) }
      : { left: 20, top: -400, width: 390, height: 1200, right: 410, bottom: 800, x: 20, y: -400, toJSON: () => ({}) }
  })
  shell = document.createElement('div')
  shell.className = 'app-shell'
  shell.style.backgroundColor = '#f4f4f4'
  source = document.createElement('main')
  source.className = 'app-page'
  source.innerHTML = '<p>实时账目 128.50</p>'
  sourceClone = vi.spyOn(source, 'cloneNode')
  shell.append(source)
  document.body.append(shell)
})

afterEach(() => {
  cleanup()
  shell.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  frames.clear()
})

describe('玻璃折射镜像生命周期', () => {
  it('首次镜像保留子容器滚动偏移，后续横纵滚动仅同步对应副本', async () => {
    source.innerHTML = '<div class="modal-backdrop"><div role="dialog">弹窗</div></div><div class="filters" style="overflow:auto"><span>筛选条</span></div>'
    const scroller = source.querySelector<HTMLElement>('.filters')!
    scroller.scrollLeft = 123
    scroller.scrollTop = 45
    render(<Fixture />, { container: shell.appendChild(document.createElement('div')) })
    flushFrame()
    await flushMutations()
    const mirrorScroller = shell.querySelector<HTMLElement>('.glass-refraction-source .filters')!
    expect(mirrorScroller.scrollLeft).toBe(123)
    expect(mirrorScroller.scrollTop).toBe(45)
    const filterId = shell.querySelector('filter')!.id

    scroller.scrollLeft = 176
    scroller.scrollTop = 73
    scroller.dispatchEvent(new Event('scroll'))
    expect(frames.size).toBe(1)
    flushFrame()
    await flushMutations()
    expect(shell.querySelector('.glass-refraction-source .filters')).toBe(mirrorScroller)
    expect(mirrorScroller.scrollLeft).toBe(176)
    expect(mirrorScroller.scrollTop).toBe(73)
    expect(sourceClone).toHaveBeenCalledTimes(1)
    expect(makeImage).toHaveBeenCalledTimes(1)
    expect(shell.querySelector('filter')!.id).not.toBe(filterId)
    expect(frames.size).toBe(0)

    mirrorScroller.dispatchEvent(new Event('scroll'))
    expect(frames.size).toBe(0)
  })

  it('因内容变化重建镜像时仍保留滚动位置，并继续同步新副本', async () => {
    source.innerHTML = '<div class="filters" style="overflow-x:auto"><span>筛选条</span></div>'
    const scroller = source.querySelector<HTMLElement>('.filters')!
    scroller.scrollLeft = 155
    render(<Fixture />, { container: shell.appendChild(document.createElement('div')) })
    flushFrame()
    await flushMutations()
    const previousMirror = shell.querySelector<HTMLElement>('.glass-refraction-source .filters')!
    source.querySelector('span')!.textContent = '更新后的筛选条'
    await flushMutations()
    flushFrame()
    await flushMutations()
    const nextMirror = shell.querySelector<HTMLElement>('.glass-refraction-source .filters')!
    expect(nextMirror).not.toBe(previousMirror)
    expect(nextMirror.scrollLeft).toBe(155)
    expect(sourceClone).toHaveBeenCalledTimes(2)

    scroller.scrollLeft = 202
    scroller.dispatchEvent(new Event('scroll'))
    flushFrame()
    await flushMutations()
    expect(nextMirror.scrollLeft).toBe(202)
    expect(sourceClone).toHaveBeenCalledTimes(2)
    expect(frames.size).toBe(0)
  })

  it('使用真实页面 DOM 与 Safari 安全滤镜，首次绘制后不保留闲置 RAF', async () => {
    render(<Fixture />, { container: shell.appendChild(document.createElement('div')) })
    flushFrame()
    await flushMutations()
    const mirror = shell.querySelector<HTMLElement>('[data-glass-refraction]')!
    const lens = mirror.querySelector<HTMLElement>('.glass-refraction-window')!
    const filter = mirror.querySelector('filter')!
    const host = mirror.querySelector<HTMLElement>('.glass-refraction-source')!
    const sourceClip = mirror.querySelector<HTMLElement>('.glass-refraction-clip')!
    expect(mirror.getAttribute('aria-hidden')).toBe('true')
    expect(mirror.hasAttribute('inert')).toBe(true)
    expect(host.textContent).toBe('实时账目 128.50')
    expect(sourceClone).toHaveBeenCalledTimes(1)
    expect(makeImage).toHaveBeenCalledTimes(1)
    expect(frames.size).toBe(0)
    expect(filter.getAttribute('x')).toBe('0')
    expect(filter.getAttribute('y')).toBe('0')
    expect(lens.style.transform).toBe('')
    expect(lens.style.filter.replaceAll('"', '')).toBe(`url(#${filter.id})`)
    expect(lens.style.backgroundColor).toBe('')
    expect(sourceClip.style.backgroundColor).toBe('rgb(244, 244, 244)')
    expect(sourceClip.parentElement).toBe(lens)
    expect(host.parentElement).toBe(sourceClip)
    expect(sourceClip.style.borderRadius).toBe('34px')
    // Default requested strength is 9; the encoded effective scale must be used.
    expect(Number(filter.querySelector('feDisplacementMap')!.getAttribute('scale'))).toBeCloseTo(.85 * 8 / Math.PI)
    expect(host.style.transform).toBe(`scale(${1 / 1.1}, ${1 / 1.2})`)
    expect(parseFloat(host.style.left)).toBeCloseTo((20 - 31.1) / 1.1)
    expect(parseFloat(host.style.top)).toBeCloseTo((-400 - 731.2) / 1.2)
  })

  it('滚动只更新位置，页面内容变化才重建镜像，镜像和导航变化不产生反馈', async () => {
    render(<Fixture />, { container: shell.appendChild(document.createElement('div')) })
    flushFrame()
    await flushMutations()
    window.dispatchEvent(new Event('scroll'))
    flushFrame()
    await flushMutations()
    expect(sourceClone).toHaveBeenCalledTimes(1)
    expect(makeImage).toHaveBeenCalledTimes(1)
    shell.querySelector('.glass-tabbar')!.setAttribute('data-position', '2')
    shell.querySelector('.glass-refraction-source p')!.textContent = '装饰镜像更新'
    await flushMutations()
    expect(frames.size).toBe(0)
    source.querySelector('p')!.textContent = '更新后的账目'
    await flushMutations()
    expect(frames.size).toBe(1)
    flushFrame()
    await flushMutations()
    expect(sourceClone).toHaveBeenCalledTimes(2)
    expect(shell.querySelector('.glass-refraction-source')!.textContent).toBe('更新后的账目')
    expect(frames.size).toBe(0)
  })

  it('路由替换 main 时重新选择源 DOM，运动跟随在 700ms 后停止并在卸载清理', async () => {
    const view = render(<Fixture />, { container: shell.appendChild(document.createElement('div')) })
    flushFrame()
    await flushMutations()
    const nextSource = document.createElement('main')
    nextSource.className = 'app-page'
    nextSource.textContent = '另一页面'
    source.replaceWith(nextSource)
    await flushMutations()
    flushFrame()
    await flushMutations()
    expect(shell.querySelector('.glass-refraction-source')!.textContent).toBe('另一页面')
    view.rerender(<Fixture motionKey={1} />)
    flushFrame(100)
    expect(frames.size).toBe(1)
    flushFrame(500)
    expect(frames.size).toBe(1)
    flushFrame(701)
    await flushMutations()
    expect(frames.size).toBe(0)
    expect(makeImage).toHaveBeenCalledTimes(1)
    view.rerender(<Fixture motionKey={2} />)
    expect(frames.size).toBe(1)
    view.unmount()
    expect(frames.size).toBe(0)
    nextSource.textContent = '卸载后变化'
    window.dispatchEvent(new Event('scroll'))
    await flushMutations()
    expect(frames.size).toBe(0)
  })
})
