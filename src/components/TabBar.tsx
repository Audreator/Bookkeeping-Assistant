import { NavLink } from 'react-router-dom'
import { Icon, type IconName } from './Icon'

const TABS = [
  { to: '/', label: '今天', icon: 'today' },
  { to: '/ledger', label: '账本', icon: 'ledger' },
  { to: '/planner', label: '规划', icon: 'planner' },
  { to: '/stats', label: '统计', icon: 'stats' },
  { to: '/settings', label: '设置', icon: 'settings' },
]

export function TabBar() {
  return (
    <nav aria-label="主导航" className="glass-tabbar fixed z-20">
      <div className="flex">
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
