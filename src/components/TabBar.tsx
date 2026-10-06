import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { matchPath, NavLink, useLocation } from 'react-router-dom'
import { Icon, type IconName } from './Icon'
import { GlassRefraction } from './GlassRefraction'

const TABS = [
  { to: '/', label: '今天', icon: 'today' },
  { to: '/ledger', label: '账本', icon: 'ledger' },
  { to: '/planner', label: '规划', icon: 'planner' },
  { to: '/stats', label: '统计', icon: 'stats' },
  { to: '/settings', label: '设置', icon: 'settings' },
]
const MOTION_DURATION = 620

export function TabBar() {
  const { pathname } = useLocation()
  const activeIndex = Math.max(0, TABS.findIndex((tab) =>
    matchPath({ path: tab.to, end: tab.to === '/' }, pathname)))
  const previousIndex = useRef(activeIndex)
  const navRef = useRef<HTMLElement>(null)
  const shapeRef = useRef<HTMLSpanElement>(null)
  const activeAnimation = useRef<Animation | null>(null)
  const movementGeneration = useRef(0)
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stopMotion = useCallback((shape = shapeRef.current) => {
    // 先作废旧回调，再取消：旧 finish/cancel 事件不能改变下一次运动的材质。
    movementGeneration.current += 1
    const animations = new Set(shape?.getAnimations?.() ?? [])
    if (activeAnimation.current) animations.add(activeAnimation.current)
    activeAnimation.current = null
    if (fallbackTimer.current !== null) {
      clearTimeout(fallbackTimer.current)
      fallbackTimer.current = null
    }
    animations.forEach((animation) => animation.cancel())
    shape?.removeAttribute('data-moving')
  }, [])

  useLayoutEffect(() => {
    if (previousIndex.current === activeIndex) return
    let displacement = activeIndex - previousIndex.current
    previousIndex.current = activeIndex
    const shape = shapeRef.current
    if (!shape) return
    // 上个目标可能尚未到达；从未形变的位移层读取当前位置，方向才与真实滑动一致。
    const selection = shape.parentElement
    const selectionBounds = selection?.getBoundingClientRect()
    const trackBounds = selection?.parentElement?.getBoundingClientRect()
    if (selectionBounds && trackBounds && selectionBounds.width > 0 && trackBounds.width > 0 &&
        Number.isFinite(selectionBounds.left) && Number.isFinite(trackBounds.left) && Number.isFinite(trackBounds.width)) {
      const tabWidth = trackBounds.width / TABS.length
      displacement = (trackBounds.left + activeIndex * tabWidth - selectionBounds.left) / tabWidth
    }
    const direction = Math.sign(displacement)
    const distance = Math.min(Math.max(Math.abs(displacement), 1), TABS.length - 1)
    // 连续切换保留当前形态；位移由 CSS transition 从当前插值位置续滑。
    const currentTransform = getComputedStyle(shape).transform
    stopMotion(shape)
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    shape.setAttribute('data-moving', 'true')
    const generation = movementGeneration.current
    const finish = () => {
      if (generation !== movementGeneration.current) return
      activeAnimation.current = null
      if (fallbackTimer.current !== null) clearTimeout(fallbackTimer.current)
      fallbackTimer.current = null
      shape.removeAttribute('data-moving')
    }
    // 无 WAAPI 时仍有同长度的 CSS 位移；透明标识覆盖这段时间并可被后续切换取消。
    if (typeof shape.animate !== 'function') {
      fallbackTimer.current = setTimeout(finish, MOTION_DURATION)
      return
    }
    // 中心原点不变：起步滞后、横向前冲、制动回缩各一次，镜像折射仍能按轴向缩放配准。
    const stretch = 1.64 + (distance - 1) * .02
    const momentum = 6 + (distance - 1) * .6
    const animation = shape.animate([
      { transform: currentTransform === 'none' ? 'scale(1)' : currentTransform, offset: 0, easing: 'cubic-bezier(.4, 0, .2, 1)' },
      { transform: `translateX(${-direction * 3.5}px) scale(1.46, 1.11)`, offset: .18, easing: 'cubic-bezier(.2, .65, .3, 1)' },
      { transform: `translateX(${direction * momentum}px) scale(${stretch}, 1.16)`, offset: .38, easing: 'cubic-bezier(.32, 0, .32, 1)' },
      { transform: `translateX(${-direction * 2}px) scale(.94, 1.08)`, offset: .72, easing: 'cubic-bezier(.2, .8, .3, 1)' },
      { transform: 'scale(1)', offset: 1 },
    ], { duration: MOTION_DURATION, iterations: 1, easing: 'linear' })
    activeAnimation.current = animation
    const finishCurrent = () => { if (activeAnimation.current === animation) finish() }
    animation.onfinish = finishCurrent
    animation.oncancel = finishCurrent
  }, [activeIndex, stopMotion])

  useEffect(() => {
    const shape = shapeRef.current
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const cancel = () => stopMotion(shape)
    const handlePreference = () => { if (media?.matches) cancel() }
    media?.addEventListener('change', handlePreference)
    return () => { media?.removeEventListener('change', handlePreference); cancel() }
  }, [stopMotion])

  return (
    <nav ref={navRef} aria-label="主导航" className="glass-tabbar fixed z-20">
      <GlassRefraction surfaceRef={navRef} motionKey={activeIndex} edgeWidth={12} strength={3} />
      <div className="tab-track">
        <span aria-hidden="true" className="tab-selection" style={{ transform: `translateX(${activeIndex * 100}%)` }}>
          <span ref={shapeRef} className="tab-selection-shape">
            <GlassRefraction surfaceRef={shapeRef} motionKey={activeIndex} edgeWidth={12} strength={3.5} />
          </span>
        </span>
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            className={({ isActive }) =>
              `tab-item flex flex-1 flex-col items-center justify-center ${
                isActive ? 'tab-active' : ''
              }`
            }
          >
            <Icon name={tab.icon as IconName} />
            <span>{tab.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
