import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BudgetState } from '../engine/types'
import { Today } from './Today'

const mocks = vi.hoisted(() => ({ state: null as BudgetState | null, reserveEnabled: true }))
vi.mock('../state/useBudgetState', () => ({ useBudgetState: () => ({
  state: mocks.state, reserveEnabled: mocks.reserveEnabled,
  reserve: { reserved: 850, upcoming: [] }, loading: false,
  today: '2026-10-05', error: null, retry: vi.fn(), overrides: [],
}) }))
vi.mock('../api/hooks', () => ({
  useTransactions: () => ({ data: [], isLoading: false, error: null }),
  useCategories: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}))
vi.mock('../components/QuickAdd', () => ({ QuickAdd: () => null }))

function setBudget(netSpent: number, periodBudget: number) {
  mocks.state = {
    mode: 'month', periodStart: '2026-10-01', periodEnd: '2026-10-31',
    periodBudget, baseToday: 80, pool: 0, availableToday: 80,
    issuedInPeriod: 400, spentInPeriod: netSpent, remainingInPeriod: periodBudget - netSpent,
    overridesFeasible: true,
    days: [{ date: '2026-10-05', base: 80, available: 80, spent: netSpent, isOverride: false }],
  }
}

beforeEach(() => {
  mocks.reserveEnabled = true
  setBudget(0, 2250)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Today 净入账与预算进度', () => {
  it('净支出为负时圆环为 0%，本期与今日明确展示正数净入账', () => {
    setBudget(-82.77, 2250)
    const { container } = render(<Today />)
    expect(screen.getByText('0%')).toBeTruthy()
    expect(screen.getByText('本期日常')).toBeTruthy()
    for (const label of ['本期净入账', '今日净入账']) {
      const metricText = screen.getByText(label).parentElement?.textContent ?? ''
      expect(metricText).toContain('¥82.77')
      expect(metricText).not.toContain('-¥82.77')
    }
    expect(screen.queryByText('已使用')).toBeNull()
    expect(container.textContent).not.toContain('-4%')
    expect(container.textContent).not.toContain('-¥82.77')
    const fill = container.querySelector('circle[stroke-dasharray]')!
    expect(fill.getAttribute('stroke-dashoffset')).toBe(fill.getAttribute('stroke-dasharray'))
  })

  it.each([0, -50])('预算为 %s 时显示暂无额度，不产生无效百分比或图形', (periodBudget) => {
    setBudget(10, periodBudget)
    const { container } = render(<Today />)
    expect(screen.getByText('暂无额度')).toBeTruthy()
    expect(container.textContent).not.toMatch(/NaN|Infinity/)
    expect(container.querySelector('circle[stroke-dasharray]')?.outerHTML).not.toMatch(/NaN|Infinity/)
  })

  it('真实超支保留 150% 提示，圆环最多填满一圈', () => {
    setBudget(150, 100)
    const { container } = render(<Today />)
    expect(screen.getByText('150%')).toBeTruthy()
    expect(screen.getByText('已使用').parentElement?.textContent).toContain('¥150.00')
    expect(screen.queryByText('本期净入账')).toBeNull()
    const fill = container.querySelector('circle[stroke-dasharray]')!
    expect(Number(fill.getAttribute('stroke-dashoffset'))).toBe(0)
  })
})
