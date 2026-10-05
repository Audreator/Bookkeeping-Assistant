import { useEffect, useLayoutEffect, useRef } from 'react'
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

export function TabBar() {
  const { pathname } = useLocation()
  const activeIndex = Math.max(0, TABS.findIndex((tab) =>
    matchPath({ path: tab.to, end: tab.to === '/' }, pathname)))
  const previousIndex = useRef(activeIndex)
  const navRef = useRef<HTMLElement>(null)
  const shapeRef = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    if (previousIndex.current === activeIndex) return
    previousIndex.current = activeIndex
    const shape = shapeRef.current
    if (!shape || typeof shape.animate !== 'function') return
    // 连续切换保留当前形态；位移由 CSS transition 从当前插值位置续滑。
    const currentTransform = getComputedStyle(shape).transform
    shape.getAnimations?.().forEach((animation) => animation.cancel())
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    shape.animate([
      { transform: currentTransform === 'none' ? 'scale(1)' : currentTransform, offset: 0 },
      { transform: 'scale(1.38, 1.26)', offset: .3 },
      { transform: 'scale(.94, .97)', offset: .72 },
      { transform: 'scale(1)', offset: 1 },
    ], { duration: 620, iterations: 1, easing: 'cubic-bezier(.22, .8, .32, 1)' })
  }, [activeIndex])

  useEffect(() => {
    const shape = shapeRef.current
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const cancel = () => shape?.getAnimations?.().forEach((animation) => animation.cancel())
    const handlePreference = () => { if (media?.matches) cancel() }
    media?.addEventListener('change', handlePreference)
    return () => { media?.removeEventListener('change', handlePreference); cancel() }
  }, [])

  return (
    <nav ref={navRef} aria-label="主导航" className="glass-tabbar fixed z-20">
      <GlassRefraction surfaceRef={navRef} motionKey={activeIndex} />
      <div className="tab-track">
        <span aria-hidden="true" className="tab-selection" style={{ transform: `translateX(${activeIndex * 100}%)` }}>
          <span ref={shapeRef} className="tab-selection-shape">
            <GlassRefraction surfaceRef={shapeRef} motionKey={activeIndex} />
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
