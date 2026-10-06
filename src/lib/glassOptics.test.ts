import { describe, expect, it } from 'vitest'
import {
  cloneGlassSource,
  createGlassDisplacementMap,
  glassSourceTransform,
  roundedRectSample,
  sampleGlassDisplacement,
} from './glassOptics'

const geometry = { width: 240, height: 72, radius: 36, edgeWidth: 8, strength: 1 }

describe('玻璃边缘光学', () => {
  it('圆角矩形距离为负代表内部，边缘法线向外', () => {
    expect(roundedRectSample(120, 36, geometry)).toEqual({ distance: -36, normalX: 0, normalY: 1 })
    expect(roundedRectSample(120, 0, geometry)).toEqual({ distance: 0, normalX: 0, normalY: -1 })
    expect(roundedRectSample(240, 36, geometry)).toEqual({ distance: 0, normalX: 1, normalY: 0 })
    const corner = roundedRectSample(36 - 36 / Math.sqrt(2), 36 - 36 / Math.sqrt(2), geometry)
    expect(corner.distance).toBeCloseTo(0)
    expect(corner.normalX).toBeCloseTo(-Math.SQRT1_2)
    expect(corner.normalY).toBeCloseTo(-Math.SQRT1_2)
  })

  it('圆角半径限制在形状内，窄胶囊仍使用正确法线', () => {
    expect(roundedRectSample(40, 0, { width: 80, height: 80, radius: 999 }).distance).toBe(0)
    expect(roundedRectSample(0, 40, { width: 80, height: 80, radius: 999 }).normalX).toBe(-1)
  })

  it('中心、边界外与边缘内侧均无位移，只有边缘带折射', () => {
    expect(sampleGlassDisplacement(120, 36, geometry)).toEqual({ x: 0, y: 0 })
    expect(sampleGlassDisplacement(120, -1, geometry)).toEqual({ x: 0, y: 0 })
    expect(sampleGlassDisplacement(120, 8, geometry)).toEqual({ x: 0, y: 0 })
    const top = sampleGlassDisplacement(120, 2, geometry)
    expect(top.x).toBe(0)
    expect(top.y).toBeCloseTo(Math.SQRT1_2)
  })

  it('两侧位移对称，始终不会超过设定强度', () => {
    const left = sampleGlassDisplacement(2, 36, geometry)
    const right = sampleGlassDisplacement(238, 36, geometry)
    expect(left.x).toBeCloseTo(-right.x)
    expect(left.x).toBeCloseTo(Math.SQRT1_2)
    expect(left.y).toBe(0)
    for (let y = 0; y < geometry.height; y += 3) {
      for (let x = 0; x < geometry.width; x += 3) {
        const point = sampleGlassDisplacement(x, y, geometry)
        expect(Math.hypot(point.x, point.y)).toBeLessThanOrEqual(geometry.strength + 1e-10)
      }
    }
  })

  it('只重排同一边缘带的内容：一段压缩、一段拉伸而非整体搬移', () => {
    const lens = { ...geometry, edgeWidth: 12, strength: 1.6 }
    const outer = sampleGlassDisplacement(120, 3, lens)
    const inner = sampleGlassDisplacement(120, 9, lens)
    expect(outer.y).toBeGreaterThan(0)
    expect(inner.y).toBeLessThan(0)
    expect(sampleGlassDisplacement(120, 6, lens).y).toBeCloseTo(0)
    const sourceDepth = (depth: number) => depth + sampleGlassDisplacement(120, depth, lens).y
    expect(sourceDepth(3.1) - sourceDepth(3)).toBeGreaterThan(.1)
    expect(sourceDepth(6.1) - sourceDepth(6)).toBeLessThan(.04)
    expect(sourceDepth(11.999) - sourceDepth(11.998)).toBeCloseTo(.001, 5)
  })

  it('过高力度仍保持单调与带内采样，不折返或引入外部及中心内容', () => {
    for (const strength of [1.6, 3, 9, 100]) {
      const lens = { ...geometry, edgeWidth: 12, strength }
      let previous = -1
      for (let depth = 0; depth <= 12; depth += .025) {
        const sourceDepth = depth + sampleGlassDisplacement(120, depth, lens).y
        expect(sourceDepth).toBeGreaterThanOrEqual(-1e-8)
        expect(sourceDepth).toBeLessThanOrEqual(12 + 1e-8)
        expect(sourceDepth).toBeGreaterThan(previous)
        previous = sourceDepth
      }
    }
  })

  it('窄胶囊或过宽边缘带也不会把圆角内的采样点推到胶囊外', () => {
    const lens = { width: 18, height: 18, radius: 9, edgeWidth: 24, strength: 100 }
    for (let y = .25; y < 18; y += .5) {
      for (let x = .25; x < 18; x += .5) {
        if (roundedRectSample(x, y, lens).distance >= 0) continue
        const bend = sampleGlassDisplacement(x, y, lens)
        expect(roundedRectSample(x + bend.x, y + bend.y, lens).distance).toBeLessThanOrEqual(1e-8)
      }
    }
  })

  it('生成不透明 RG 位移纹理，中心为中性并限制每像素工作量', () => {
    const map = createGlassDisplacementMap(geometry)
    expect(map.width).toBe(240)
    expect(map.height).toBe(72)
    expect(map.scale).toBe(2)
    expect(map.data).toHaveLength(240 * 72 * 4)
    expect([...map.data.slice((36 * 240 + 120) * 4, (36 * 240 + 120) * 4 + 4)]).toEqual([128, 128, 128, 255])
    const top = (1 * 240 + 120) * 4
    expect(map.data[top]).toBe(128)
    expect(map.data[top + 1]).toBeGreaterThan(128)
    expect(map.data[(6 * 240 + 120) * 4 + 1]).toBeLessThan(128)
  })

  it('缩放中的选中胶囊反向缩放真实页面，使镜像保持屏幕坐标', () => {
    expect(glassSourceTransform(
      { left: 20, top: -400, width: 390, height: 1200 },
      { left: 30, top: 730, width: 110, height: 84 },
      { width: 100, height: 70 },
      { width: 390, height: 1200 },
    )).toEqual({ x: -10 / 1.1, y: -1130 / 1.2, scaleX: 1 / 1.1, scaleY: 1 / 1.2 })
  })

  it('折射遮罩让圆角外和中心透明，外半段保留完整局部折射', () => {
    const map = createGlassDisplacementMap({ ...geometry, edgeWidth: 12 })
    expect(map.edgeMask).toHaveLength(map.data.length)
    const alpha = (x: number, y: number) => map.edgeMask[(y * map.width + x) * 4 + 3]
    expect(alpha(0, 0)).toBe(0)
    expect(alpha(120, 36)).toBe(0)
    expect(alpha(120, 2)).toBe(255)
    expect(alpha(15, 15)).toBe(255)
  })

  it('折射环内侧逐渐淡出，没有整圈硬切色阶', () => {
    const map = createGlassDisplacementMap({ ...geometry, edgeWidth: 12 })
    const alpha = (y: number) => map.edgeMask[(y * map.width + 120) * 4 + 3]
    expect(alpha(7)).toBeLessThan(255)
    expect(alpha(9)).toBeGreaterThan(0)
    expect(alpha(11)).toBeGreaterThan(0)
    expect(alpha(7)).toBeGreaterThan(alpha(9))
    expect(alpha(9)).toBeGreaterThan(alpha(11))
    expect(alpha(12)).toBe(0)
  })

  it('圆角遮罩左右上下对称，颜色不参与灰雾合成', () => {
    const map = createGlassDisplacementMap({ ...geometry, edgeWidth: 12 })
    for (const [x, y] of [[18, 18], [120, 9], [4, 35]]) {
      const pixel = (px: number, py: number) => [...map.edgeMask.slice((py * map.width + px) * 4, (py * map.width + px) * 4 + 4)]
      expect(pixel(x, y).slice(0, 3)).toEqual([255, 255, 255])
      expect(pixel(x, y)).toEqual(pixel(map.width - 1 - x, y))
      expect(pixel(x, y)).toEqual(pixel(x, map.height - 1 - y))
    }
  })

  it('无折射带时遮罩全透明，过宽折射带在小胶囊内仍有渐隐', () => {
    const disabled = createGlassDisplacementMap({ ...geometry, edgeWidth: 0 })
    expect(disabled.edgeMask.filter((_, index) => index % 4 === 3).every(alpha => alpha === 0)).toBe(true)
    const small = createGlassDisplacementMap({ width: 18, height: 18, radius: 9, edgeWidth: 24, strength: 100 })
    expect(small.edgeMask).toHaveLength(18 * 18 * 4)
    expect([...small.edgeMask].some((alpha, index) => index % 4 === 3 && alpha > 0 && alpha < 255)).toBe(true)
  })

  it('没有有效布局时返回有限数值', () => {
    expect(glassSourceTransform(
      { left: 0, top: 0, width: 0, height: 0 },
      { left: 0, top: 0, width: 0, height: 0 },
      { width: 0, height: 0 },
      { width: 0, height: 0 },
    )).toEqual({ x: 0, y: 0, scaleX: 1, scaleY: 1 })
  })
})

describe('玻璃装饰镜像', () => {
  it('删除遮罩后仍保持正确的源节点与镜像对应关系', () => {
    const source = document.createElement('main')
    source.innerHTML = '<p>账目</p><div class="modal-backdrop"><div>弹窗</div></div><div class="filters"><span>筛选条</span></div>'
    const mirrors = new Map<Element, Element>()
    const clone = cloneGlassSource(source, 'glass-scroll', mirrors)
    expect(mirrors.get(source)).toBe(clone)
    expect(mirrors.get(source.querySelector('.filters')!)).toBe(clone.querySelector('.filters'))
    expect(mirrors.has(source.querySelector('.modal-backdrop')!)).toBe(false)
    expect(mirrors.has(source.querySelector('.modal-backdrop div')!)).toBe(false)
  })

  it('完整剔除弹窗遮罩，不遗留固定定位的空遮罩壳', () => {
    const source = document.createElement('main')
    source.innerHTML = '<p>页面账目</p><div class="modal-backdrop"><div role="dialog">弹窗内容</div><span>遮罩附属内容</span></div>'
    const clone = cloneGlassSource(source, 'glass-modal')
    expect(clone.querySelector('.modal-backdrop')).toBeNull()
    expect(clone.textContent).toBe('页面账目')
  })

  it('不复制密码、文件和凭据输入值，也不插入媒体资源副本', () => {
    const source = document.createElement('main')
    source.innerHTML = '<input type="password" value="secret"><input type="file"><input name="apiToken" value="private-token"><input type="number" value="12.50"><video src="movie.mp4"></video><audio src="sound.mp3"></audio><button class="fab">浮动记账</button>'
    const clone = cloneGlassSource(source, 'glass-private')
    expect(clone.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe('')
    expect(clone.querySelector<HTMLInputElement>('input[type="password"]')?.hasAttribute('value')).toBe(false)
    expect(clone.querySelector<HTMLInputElement>('input[name="apiToken"]')?.value).toBe('')
    expect(clone.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('12.50')
    expect(clone.querySelector('video, audio, .fab')).toBeNull()
  })

  it('仅复制实际 DOM，剔除对话框和可执行节点并让镜像不可交互', () => {
    const source = document.createElement('main')
    source.innerHTML = '<p>真实账目</p><dialog open>隐私对话框</dialog><section role="dialog">弹窗</section><script>window.bad=true</script><iframe src="about:blank"></iframe><button onclick="alert(1)" autofocus>记账</button>'
    const clone = cloneGlassSource(source, 'glass-a')
    expect(source.querySelector('dialog')).not.toBeNull()
    expect(clone.querySelector('dialog, [role="dialog"], script, iframe')).toBeNull()
    expect(clone.querySelector('p')?.textContent).toBe('真实账目')
    expect(clone.getAttribute('aria-hidden')).toBe('true')
    expect(clone.hasAttribute('inert')).toBe(true)
    expect(clone.querySelector('button')?.hasAttribute('onclick')).toBe(false)
    expect(clone.querySelector('button')?.hasAttribute('autofocus')).toBe(false)
  })

  it('为每个镜像去重 ID，并保留各个 SVG 的局部裁切和渐变引用', () => {
    const source = document.createElement('main')
    source.innerHTML = '<svg><defs><clipPath id="clip"><rect /></clipPath></defs><g clip-path="url(#clip)"></g><use href="#clip" /></svg><svg><defs><linearGradient id="clip" /></defs><path fill="url(\'#clip\')" style="stroke:url(#clip)" /></svg>'
    const clone = cloneGlassSource(source, 'glass:a')
    const other = cloneGlassSource(source, 'glass:b')
    const ids = [...clone.querySelectorAll('[id]')].map((element) => element.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => !other.querySelector(`[id="${id}"]`))).toBe(true)
    const svgs = clone.querySelectorAll('svg')
    const firstId = svgs[0].querySelector('[id]')!.id
    const secondId = svgs[1].querySelector('[id]')!.id
    expect(svgs[0].querySelector('g')?.getAttribute('clip-path')).toBe(`url(#${firstId})`)
    expect(svgs[0].querySelector('use')?.getAttribute('href')).toBe(`#${firstId}`)
    expect(svgs[1].querySelector('path')?.getAttribute('fill')).toBe(`url(#${secondId})`)
    expect(svgs[1].querySelector('path')?.getAttribute('style')).toBe(`stroke:url(#${secondId})`)
  })
})
