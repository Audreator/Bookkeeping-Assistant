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

describe('固定支出从当期总预算扣除', () => {
  const currentMonthStart = () => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  }
  const currentMonthDueDate = () => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-28`
  }
  const setupWithBill = (over: { paid?: boolean; reserveEnabled?: boolean } = {}) => {
    reset()
    const at = currentMonthStart()
    queries.events = {
      data: [{ id: 1, at, mode: 'month', monthBudget: 1000, weekBudgetOverride: null, cycleStartDay: 1, weekStartsOn: 1, note: null, createdAt: 'x' }],
      error: null, isLoading: false, refetch: vi.fn(),
    }
    queries.settings = { data: { reserveEnabled: over.reserveEnabled ?? true }, error: null, isLoading: false, refetch: vi.fn() }
    queries.bills = {
      data: {
        bills: [{ id: 1, name: '房租', amount: 600, categoryId: null, dueDay: 28, remindDaysBefore: 3, active: true }],
        payments: over.paid
          ? [{ id: 1, billId: 1, periodKey: currentMonthDueDate(), paidAt: at, transactionId: null }]
          : [],
      },
      error: null, isLoading: false, refetch: vi.fn(),
    }
  }

  it('未支付固定支出从当期总预算扣除，每日额度随之重算', () => {
    setupWithBill()
    const { result } = renderHook(useBudgetState)
    expect(result.current.reserve.reserved).toBe(600)
    expect(result.current.state?.periodBudget).toBe(400)
  })

  it('已支付固定支出不再扣除（支付交易本身计入已花）', () => {
    setupWithBill({ paid: true })
    const { result } = renderHook(useBudgetState)
    expect(result.current.reserve.reserved).toBe(0)
    expect(result.current.state?.periodBudget).toBe(1000)
  })

  it('关闭预留设置时不扣除', () => {
    setupWithBill({ reserveEnabled: false })
    const { result } = renderHook(useBudgetState)
    expect(result.current.reserve.reserved).toBe(600)
    expect(result.current.state?.periodBudget).toBe(1000)
  })
})
