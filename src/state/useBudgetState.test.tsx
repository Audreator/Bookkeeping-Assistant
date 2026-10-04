import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBudgetState } from './useBudgetState'

const queries = vi.hoisted(() => ({ transactions: {}, events: {}, settings: {}, bills: {}, overrides: {} } as Record<string, {
  data?: unknown; error?: Error | null; isLoading?: boolean; refetch?: ReturnType<typeof vi.fn>
}>))
vi.mock('../api/hooks', () => ({
  useTransactions: () => queries.transactions, useEvents: () => queries.events,
  useSettings: () => queries.settings, useBillsData: () => queries.bills,
  useDayOverrides: () => queries.overrides,
}))
const reset = () => {
  Object.assign(queries, {
    transactions: { data: [], error: null, isLoading: false, refetch: vi.fn() },
    events: { data: [{ id: 1, at: '2026-10-01', mode: 'month', monthBudget: 1000,
      weekBudgetOverride: null, cycleStartDay: 1, weekStartsOn: 1, note: null, createdAt: 'x' }],
      error: null, isLoading: false, refetch: vi.fn() },
    settings: { data: {}, error: null, isLoading: false, refetch: vi.fn() },
    bills: { data: { bills: [], payments: [] }, error: null, isLoading: false, refetch: vi.fn() },
    overrides: { data: [], error: null, isLoading: false, refetch: vi.fn() },
  })
}
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('预算加载失败保护', () => {
  it.each(['transactions', 'events', 'settings', 'bills', 'overrides'])('%s 查询失败不能计算完整可花预算', (key) => {
    reset()
    const failure = new Error('服务无法连接')
    queries[key]!.error = failure
    queries[key]!.data = undefined
    const { result } = renderHook(useBudgetState)
    expect(result.current.state).toBeNull()
    expect(result.current.error).toBe(failure)
    result.current.retry()
    for (const query of Object.values(queries)) expect(query.refetch).toHaveBeenCalledTimes(1)
  })
})
