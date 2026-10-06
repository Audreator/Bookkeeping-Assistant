import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { cloneGlassSource, createGlassDisplacementMap, glassSourceTransform } from '../lib/glassOptics'

interface GlassRefractionProps {
  surfaceRef: RefObject<HTMLElement | null>
  sourceSelector?: string
  edgeWidth?: number
  strength?: number
  motionKey?: string | number
}

interface FilterMap {
  width: number
  height: number
  radius: number
  scale: number
  url: string
}

const INITIAL_MAP: FilterMap = { width: 1, height: 1, radius: 0, scale: 0, url: '' }
const MIRROR_SELECTOR = '[data-glass-refraction]'

function displacementDataUrl(width: number, height: number, radius: number, edgeWidth: number, strength: number) {
  const map = createGlassDisplacementMap({ width, height, radius, edgeWidth, strength })
  const canvas = document.createElement('canvas')
  canvas.width = map.width
  canvas.height = map.height
  const context = canvas.getContext('2d')
  if (!context) return { url: '', scale: 0 }
  const pixels = context.createImageData(map.width, map.height)
  pixels.data.set(map.data)
  context.putImageData(pixels, 0, 0)
  const url = canvas.toDataURL('image/png')
  canvas.width = canvas.height = 0
  return { url, scale: map.scale }
}

/**
 * Safari-compatible refraction of a decorative DOM mirror. The enclosing CSS
 * ring mask excludes the center entirely, leaving the real page clear beneath.
 */
export function GlassRefraction({
  surfaceRef,
  sourceSelector = 'main.app-page',
  edgeWidth = 8,
  strength = 9,
  motionKey,
}: GlassRefractionProps) {
  const reactId = useId()
  const filterId = `glass-refraction-${reactId.replace(/[^\w-]/g, '')}`
  const sourceHostRef = useRef<HTMLDivElement>(null)
  const sourceClipRef = useRef<HTMLDivElement>(null)
  const windowRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<SVGFilterElement>(null)
  const filterVersion = useRef(0)
  const followMotionRef = useRef<(() => void) | null>(null)
  const previousMotionKey = useRef(motionKey)
  const [map, setMap] = useState(INITIAL_MAP)

  // Parent refs are attached after children's layout effects; initialize here.
  useEffect(() => {
    const surfaceNode = surfaceRef.current
    const hostNode = sourceHostRef.current
    const clipNode = sourceClipRef.current
    const windowNode = windowRef.current
    if (!surfaceNode || !hostNode || !clipNode || !windowNode) return
    const surface = surfaceNode
    const host = hostNode
    const sourceClip = clipNode
    const lensWindow = windowNode

    let source: HTMLElement | null = null
    let clone: HTMLElement | null = null
    let sourceDirty = true
    let frame = 0
    let followUntil = 0
    let previousGeometry = ''
    let previousPosition = ''
    let mapReady = false
    let disposed = false
    const scrollMirrors = new Map<Element, Element>()
    const pendingScrolls = new Set<Element>()
    const interactionRoot = surface.closest('.glass-tabbar') ?? surface.parentElement ?? surface
    const shell = surface.closest('.app-shell') ?? document.body
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => schedule())

    const findSource = () => [...document.querySelectorAll<HTMLElement>(sourceSelector)]
      .find((element) => !element.closest(MIRROR_SELECTOR)) ?? null

    const refreshSource = () => {
      const nextSource = findSource()
      if (source !== nextSource) {
        if (source) resizeObserver?.unobserve(source)
        source = nextSource
        if (source) resizeObserver?.observe(source)
      }
      host.replaceChildren()
      clone = null
      scrollMirrors.clear()
      pendingScrolls.clear()
      if (!source) return
      clone = cloneGlassSource(source, filterId, scrollMirrors)
      for (const element of scrollMirrors.keys()) {
        if (element.scrollLeft !== 0 || element.scrollTop !== 0) pendingScrolls.add(element)
      }
      const style = getComputedStyle(source)
      Object.assign(clone.style, {
        position: 'relative',
        inset: 'auto',
        margin: '0',
        maxWidth: 'none',
        boxSizing: 'border-box',
        transform: 'none',
        color: style.color,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        textAlign: style.textAlign,
        direction: style.direction,
        pointerEvents: 'none',
      })
      sourceClip.style.backgroundColor = getComputedStyle(shell).backgroundColor
      host.appendChild(clone)
    }

    function update(now: number) {
      frame = 0
      if (disposed) return
      let invalidate = sourceDirty
      if (sourceDirty) {
        sourceDirty = false
        refreshSource()
      }
      if (!source || !clone || !source.isConnected) {
        lensWindow.style.visibility = 'hidden'
        return
      }
      const rect = surface.getBoundingClientRect()
      const layoutWidth = surface.offsetWidth
      const layoutHeight = surface.offsetHeight
      const width = surface.clientWidth || layoutWidth
      const height = surface.clientHeight || layoutHeight
      if (width <= 0 || height <= 0 || rect.width <= 0 || rect.height <= 0) {
        lensWindow.style.visibility = 'hidden'
        return
      }
      const radius = Math.min(parseFloat(getComputedStyle(surface).borderTopLeftRadius) || height / 2, width / 2, height / 2)
      const geometry = `${width}:${height}:${radius}:${edgeWidth}:${strength}`
      if (geometry !== previousGeometry) {
        previousGeometry = geometry
        const { url, scale } = displacementDataUrl(width, height, radius, edgeWidth, strength)
        mapReady = !!url
        setMap({ width, height, radius, scale, url })
        invalidate = true
      }
      const sourceWidth = source.offsetWidth || source.getBoundingClientRect().width
      const sourceHeight = source.offsetHeight || source.getBoundingClientRect().height
      clone.style.width = `${sourceWidth}px`
      clone.style.height = `${sourceHeight}px`
      // Scroll offsets need the mounted clone's final layout. Later scroll events
      // queue only their target; animation frames never walk the page's DOM tree.
      for (const element of pendingScrolls) {
        const mirror = scrollMirrors.get(element)
        if (!mirror) continue
        if (mirror.scrollLeft !== element.scrollLeft) {
          mirror.scrollLeft = element.scrollLeft
          invalidate = true
        }
        if (mirror.scrollTop !== element.scrollTop) {
          mirror.scrollTop = element.scrollTop
          invalidate = true
        }
      }
      pendingScrolls.clear()
      const scaleX = layoutWidth > 0 ? rect.width / layoutWidth : 1
      const scaleY = layoutHeight > 0 ? rect.height / layoutHeight : 1
      const transform = glassSourceTransform(
        source.getBoundingClientRect(),
        {
          left: rect.left + surface.clientLeft * scaleX,
          top: rect.top + surface.clientTop * scaleY,
          width: width * scaleX,
          height: height * scaleY,
        },
        { width, height },
        { width: sourceWidth, height: sourceHeight },
      )
      const position = `${transform.x}:${transform.y}:${transform.scaleX}:${transform.scaleY}`
      if (position !== previousPosition) {
        previousPosition = position
        host.style.left = `${transform.x}px`
        host.style.top = `${transform.y}px`
        host.style.transform = `scale(${transform.scaleX}, ${transform.scaleY})`
        invalidate = true
      }
      lensWindow.style.visibility = mapReady ? '' : 'hidden'
      if (invalidate && filterRef.current) {
        // Real Safari caches by filter ID; the filtered node itself stays untransformed.
        filterRef.current.id = `${filterId}-v${++filterVersion.current}`
        lensWindow.style.filter = `url(#${filterRef.current.id})`
      }
      if (now < followUntil) schedule()
    }

    function schedule() {
      if (!disposed && !frame) frame = requestAnimationFrame(update)
    }

    const followMotion = (event?: Event) => {
      if (event?.target instanceof Element && event.target.closest(MIRROR_SELECTOR)) return
      followUntil = performance.now() + 700
      schedule()
    }
    followMotionRef.current = followMotion
    const mutationObserver = new MutationObserver((records) => {
      const hasPageChange = records.some((record) => {
        const element = record.target instanceof Element ? record.target : record.target.parentElement
        return element && !element.closest(`${MIRROR_SELECTOR}, .glass-tabbar`)
      })
      if (!hasPageChange) return
      sourceDirty = true
      schedule()
    })
    const onInput = (event: Event) => {
      if (!(event.target instanceof Node) || !source?.contains(event.target)) return
      sourceDirty = true
      schedule()
    }
    const onScroll = (event: Event) => {
      if (event.target instanceof Element) {
        if (event.target.closest(MIRROR_SELECTOR)) return
        if (scrollMirrors.has(event.target)) pendingScrolls.add(event.target)
      }
      schedule()
    }
    mutationObserver.observe(shell, { subtree: true, childList: true, characterData: true, attributes: true })
    resizeObserver?.observe(surface)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('scroll', onScroll)
    interactionRoot.addEventListener('pointerdown', followMotion)
    interactionRoot.addEventListener('click', followMotion)
    interactionRoot.addEventListener('transitionrun', followMotion)
    interactionRoot.addEventListener('animationstart', followMotion)
    shell.addEventListener('input', onInput, true)
    shell.addEventListener('change', onInput, true)
    schedule()

    return () => {
      disposed = true
      if (frame) cancelAnimationFrame(frame)
      mutationObserver.disconnect()
      resizeObserver?.disconnect()
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('scroll', onScroll)
      interactionRoot.removeEventListener('pointerdown', followMotion)
      interactionRoot.removeEventListener('click', followMotion)
      interactionRoot.removeEventListener('transitionrun', followMotion)
      interactionRoot.removeEventListener('animationstart', followMotion)
      shell.removeEventListener('input', onInput, true)
      shell.removeEventListener('change', onInput, true)
      followMotionRef.current = null
      scrollMirrors.clear()
      pendingScrolls.clear()
      host.replaceChildren()
    }
  }, [surfaceRef, sourceSelector, edgeWidth, strength, filterId])

  useLayoutEffect(() => {
    if (!map.url || !filterRef.current || !windowRef.current) return
    // Invalidate after the new feImage href has been committed, too.
    filterRef.current.id = `${filterId}-v${++filterVersion.current}`
    windowRef.current.style.filter = `url(#${filterRef.current.id})`
  }, [map, filterId])

  useLayoutEffect(() => {
    if (previousMotionKey.current === motionKey) return
    previousMotionKey.current = motionKey
    followMotionRef.current?.()
  }, [motionKey])

  const style = {
    '--glass-edge-width': `${edgeWidth}px`,
    '--glass-radius': `${map.radius}px`,
    pointerEvents: 'none',
  } as CSSProperties
  return (
    <span className="glass-refraction" data-glass-refraction="" aria-hidden="true" inert style={style}>
      <svg aria-hidden="true" width="0" height="0" style={{ position: 'absolute', overflow: 'hidden', pointerEvents: 'none' }}>
        <defs>
          <filter ref={filterRef} id={filterId} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse"
            x="0" y="0" width={map.width} height={map.height}
            colorInterpolationFilters="sRGB">
            <feImage href={map.url || undefined} xlinkHref={map.url || undefined} x="0" y="0"
              width={map.width} height={map.height} preserveAspectRatio="none" result="edge-map" />
            <feDisplacementMap in="SourceGraphic" in2="edge-map" scale={map.scale} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
      <div ref={windowRef} className="glass-refraction-window" style={{
        filter: `url(#${filterId})`,
        width: map.width,
        height: map.height,
        visibility: map.url ? undefined : 'hidden',
        pointerEvents: 'none',
      }}>
        <div ref={sourceClipRef} className="glass-refraction-clip" style={{ borderRadius: map.radius }}>
          <div ref={sourceHostRef} className="glass-refraction-source" style={{ transformOrigin: '0 0', pointerEvents: 'none' }} />
        </div>
      </div>
    </span>
  )
}
