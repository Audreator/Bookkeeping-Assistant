import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Ledger } from './Ledger'
import { Stats } from './Stats'
import { Today } from './Today'
import { Planner } from './Planner'

const mocks = vi.hoisted(() => ({ refetchTransactions: vi.fn(), refetchCategories: vi.fn(), retryBudget: vi.fn() }))
vi.mock('../api/hooks', () => ({
  useTransactions: () => ({ error: new Error('服务无法连接'), isLoading: false, refetch: mocks.refetchTransactions }),
  useCategories: () => ({ data: [], error: null, isLoading: false, refetch: mocks.refetchCategories }),
  useEvents: () => ({ data: [] }), useBillMutations: () => ({}), useCreateEvent: () => ({}),
  useDayOverrideMutations: () => ({}), useTransactionMutations: () => ({}),
}))
vi.mock('../state/useBudgetState', () => ({ useBudgetState: () => ({
  state: null, reserve: { reserved: 0, upcoming: [] }, reserveEnabled: true,
  loading: false, today: '2026-10-04', overrides: [], error: new Error('服务无法连接'), retry: mocks.retryBudget,
}) }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('页面查询失败显示', () => {
  it.each([['今天', Today], ['规划', Planner], ['账本', Ledger], ['统计', Stats]] as const)('%s 不将错误宣称为空账本或零支出，提供重新加载', (_name, Component) => {
    render(<Component />)
    expect(screen.getByRole('alert').textContent).toBe('服务无法连接')
    expect(screen.queryByText('还没有记录')).toBeNull()
    expect(screen.queryByText('今日可花')).toBeNull()
    expect(screen.queryByText('本月暂无支出')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(mocks.refetchCategories).toHaveBeenCalledTimes(1)
    if (Component === Today || Component === Planner) expect(mocks.retryBudget).toHaveBeenCalledTimes(1)
    else expect(mocks.refetchTransactions).toHaveBeenCalledTimes(1)
  })
})
