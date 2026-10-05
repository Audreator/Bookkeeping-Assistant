import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { Settings } from './Settings'
import { todayISO } from '../lib/dates'

const mocks = vi.hoisted(() => ({ invalidateQueries: vi.fn(), bills: [] as unknown[],
  allocations: [] as unknown[], transactions: [] as unknown[], removeBill: vi.fn(), updateBill: vi.fn() }))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => mocks }))
vi.mock('../state/AuthContext', () => ({ useAuth: () => ({ user: { displayName: '我的账本', username: 'test' }, logout: vi.fn() }) }))
vi.mock('../api/hooks', () => ({
  useSettings: () => ({ data: {} }), useUpdateSettings: () => ({}),
  useCategories: () => ({ data: [] }), useCategoryMutations: () => ({}),
  useBillsData: () => ({ data: { bills: mocks.bills, payments: [], allocations: mocks.allocations } }),
  useBillMutations: () => ({ removeBill: { mutate: mocks.removeBill }, updateBill: { mutate: mocks.updateBill } }),
  useTransactions: () => ({ data: mocks.transactions }), useTransactionMutations: () => ({}),
}))
vi.mock('../api/transactions', () => ({ fetchAllTransactions: async () => [] }))
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); mocks.bills = []; mocks.allocations = []; mocks.transactions = [] })

it('局域网 HTTP 不支持 subtle 时，加密导出给出中文连接说明', async () => {
  vi.stubGlobal('crypto', {})
  vi.spyOn(window, 'prompt').mockReturnValue('test-passphrase')
  vi.spyOn(api, 'get').mockResolvedValue({ categories: [], events: [], bills: [], payments: [], settings: {}, overrides: [] })
  render(<Settings />)
  fireEvent.click(screen.getByRole('button', { name: '加密导出' }))
  await screen.findByText('加密备份需要 HTTPS 安全连接，请使用普通备份或 HTTPS 地址')
})

it('局域网 HTTP 不支持 subtle 时，加密备份导入给出中文连接说明', async () => {
  vi.stubGlobal('crypto', {})
  vi.spyOn(window, 'prompt').mockReturnValue('test-passphrase')
  render(<Settings />)
  fireEvent.change(screen.getByLabelText('导入备份文件'), { target: {
    files: [{ text: async () => JSON.stringify({ v: 1, salt: '', iv: '', data: '' }) }],
  } })
  await screen.findByText('加密备份需要 HTTPS 安全连接，请使用普通备份或 HTTPS 地址')
})

it('备份恢复保留秒级时间，并在原交易后录入时也恢复退款关联和单日预算', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.spyOn(window, 'alert').mockImplementation(() => {})
  vi.spyOn(api, 'get').mockResolvedValue({ categories: [] })
  const post = vi.spyOn(api, 'post').mockImplementation(async (_path, body) =>
    ({ transaction: { id: (body as { type: string }).type === 'refund' ? 102 : 101 } }) as never)
  const put = vi.spyOn(api, 'put').mockResolvedValue({})
  render(<Settings />)
  const file = { text: async () => JSON.stringify({ version: 1, data: {
    categories: [], events: [], bills: [], payments: [], settings: {},
    overrides: [{ date: '2026-10-08', amount: 500, note: '聚餐' }],
    transactions: [
      { id: 2, type: 'refund', amount: 20, occurredAt: '2026-10-04', occurredTime: '12:30:41', refundOfId: 1 },
      { id: 1, type: 'expense', amount: 20, occurredAt: '2026-10-03', occurredTime: null },
    ],
  } }) }
  fireEvent.change(screen.getByLabelText('导入备份文件'), { target: { files: [file] } })
  await waitFor(() => expect(window.alert).toHaveBeenCalledWith('导入完成'))
  expect(post).toHaveBeenCalledWith('/api/transactions', expect.objectContaining({ occurredTime: '12:30:41' }))
  expect(post).toHaveBeenCalledWith('/api/transactions', expect.objectContaining({ occurredTime: null }))
  expect(put).toHaveBeenCalledWith('/api/transactions/102', { refundOfId: 101 })
  expect(put).toHaveBeenCalledWith('/api/day-overrides', { date: '2026-10-08', amount: 500, note: '聚餐' })
})

it('新版备份恢复固定分摊与ID映射，先支出后退款，再保留旧付款标记', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.spyOn(window, 'alert').mockImplementation(() => {})
  vi.spyOn(api, 'get').mockResolvedValue({ categories: [] })
  const post = vi.spyOn(api, 'post').mockImplementation(async (path, body) => {
    if (path === '/api/bills') return { bill: { id: 207 } } as never
    return { transaction: { id: (body as { type: string }).type === 'refund' ? 102 : 101 } } as never
  })
  const put = vi.spyOn(api, 'put').mockResolvedValue({})
  render(<Settings />)
  fireEvent.change(screen.getByLabelText('导入备份文件'), { target: { files: [{ text: async () => JSON.stringify({ version: 1, data: {
    categories: [], events: [], settings: {}, bills: [{ id: 7, name: '房租', amount: 800, dueDay: 1 }],
    transactions: [
      { id: 2, type: 'refund', amount: 20, occurredAt: '2026-10-04' },
      { id: 1, type: 'expense', amount: 800, occurredAt: '2026-10-03' },
    ],
    payments: [{ billId: 7, periodKey: '2026-10-01', paidAt: '2026-10-03', transactionId: 1 }],
    allocations: [
      { transactionId: 2, billId: 7, periodKey: '2026-10-01', amount: 20 },
      { transactionId: 1, billId: 7, periodKey: '2026-10-01', amount: 800 },
    ],
  } }) }] } })
  await waitFor(() => expect(window.alert).toHaveBeenCalledWith('导入完成'))
  expect(post).toHaveBeenCalledWith('/api/bill-payments', {
    billId: 207, periodKey: '2026-10-01', paidAt: '2026-10-03', transactionId: 101, markerOnly: true,
  })
  const calls = put.mock.calls.filter(([path]) => path.endsWith('/fixed-allocations'))
  expect(calls).toEqual([
    ['/api/transactions/101/fixed-allocations', { allocations: [{ billId: 207, periodKey: '2026-10-01', amount: 800 }] }],
    ['/api/transactions/102/fixed-allocations', { allocations: [{ billId: 207, periodKey: '2026-10-01', amount: 20 }] }],
  ])
  const lastAllocation = put.mock.invocationCallOrder[put.mock.calls.findLastIndex(([path]) => path.endsWith('/fixed-allocations'))]!
  const legacyMarker = post.mock.invocationCallOrder[post.mock.calls.findIndex(([path]) => path === '/api/bill-payments')]!
  expect(lastAllocation).toBeLessThan(legacyMarker)
})

it('删除已有关联的固定账单失败时展示服务端原因，并可停用账单', async () => {
  mocks.bills = [{ id: 7, name: '房租', amount: 800, dueDay: 1, remindDaysBefore: 3, active: true }]
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  mocks.removeBill.mockImplementation((_id, options) => options.onError(new Error('账单存在固定分摊，请先撤销关联或停用账单')))
  render(<Settings />)
  fireEvent.click(screen.getByRole('button', { name: '删除固定支出 房租' }))
  await screen.findByText('账单存在固定分摊，请先撤销关联或停用账单')
  fireEvent.click(screen.getByRole('button', { name: '停用固定支出 房租' }))
  expect(mocks.updateBill).toHaveBeenCalledWith({ id: 7, patch: { active: false } }, expect.objectContaining({ onError: expect.any(Function) }))
})

it('空allocations的新备份及旧备份都只恢复历史付款标记，不推断分摊金额', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.spyOn(window, 'alert').mockImplementation(() => {})
  vi.spyOn(api, 'get').mockResolvedValue({ categories: [] })
  const post = vi.spyOn(api, 'post').mockImplementation(async (path) => path === '/api/bills'
    ? { bill: { id: 207 } } as never : { transaction: { id: 101 } } as never)
  vi.spyOn(api, 'put').mockResolvedValue({})
  render(<Settings />)
  const data = { categories: [], events: [], settings: {}, bills: [{ id: 7, name: '房租', amount: 800, dueDay: 1 }],
    transactions: [{ id: 1, type: 'expense', amount: 800, occurredAt: '2026-10-03' }],
    payments: [{ billId: 7, periodKey: '2026-10', paidAt: '2026-10-03', transactionId: 1 }],
  }
  const load = (backup: unknown) => fireEvent.change(screen.getByLabelText('导入备份文件'), { target: {
    files: [{ text: async () => JSON.stringify({ version: 1, data: backup }) }],
  } })
  load({ ...data, allocations: [] })
  await waitFor(() => expect(window.alert).toHaveBeenCalledTimes(1))
  expect(post).toHaveBeenLastCalledWith('/api/bill-payments', {
    billId: 207, periodKey: '2026-10', paidAt: '2026-10-03', transactionId: 101, markerOnly: true,
  })
  load(data)
  await waitFor(() => expect(window.alert).toHaveBeenCalledTimes(2))
  expect(post).toHaveBeenLastCalledWith('/api/bill-payments', {
    billId: 207, periodKey: '2026-10', paidAt: '2026-10-03', transactionId: 101, markerOnly: true,
  })
})

it('旧备份的多账单总计划超过原流水及退款支付标记均完整恢复，不生成猜测的固定金额', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.spyOn(window, 'alert').mockImplementation(() => {})
  vi.spyOn(api, 'get').mockResolvedValue({ categories: [] })
  const post = vi.spyOn(api, 'post').mockImplementation(async (path, body) => {
    if (path === '/api/bills') {
      const ids: Record<string, number> = { 订阅: 207, 水费: 208, 电费: 209 }
      return { bill: { id: ids[(body as { name: string }).name] } } as never
    }
    if (path === '/api/bill-payments') {
      if (!(body as { markerOnly?: boolean }).markerOnly) throw new Error('旧标记不能推断实际支付分摊')
      return {} as never
    }
    return { transaction: { id: (body as { type: string }).type === 'refund' ? 102 : 101 } } as never
  })
  const put = vi.spyOn(api, 'put').mockResolvedValue({})
  render(<Settings />)
  fireEvent.change(screen.getByLabelText('导入备份文件'), { target: { files: [{ text: async () => JSON.stringify({ version: 1, data: {
    categories: [], events: [], settings: {},
    bills: [{ id: 7, name: '订阅', amount: 30, dueDay: 1 }, { id: 8, name: '水费', amount: 40, dueDay: 5 }, { id: 9, name: '电费', amount: 10, dueDay: 6 }],
    transactions: [{ id: 1, type: 'expense', amount: 50, occurredAt: '2026-10-03' },
      { id: 2, type: 'refund', amount: 10, occurredAt: '2026-10-04' }],
    payments: [{ billId: 7, periodKey: '2026-10', paidAt: '2026-10-03', transactionId: 1 },
      { billId: 8, periodKey: '2026-10', paidAt: '2026-10-03', transactionId: 1 },
      { billId: 9, periodKey: '2026-10', paidAt: '2026-10-04', transactionId: 2 }],
  } }) }] } })
  await waitFor(() => expect(window.alert).toHaveBeenCalledWith('导入完成'))
  expect(post.mock.calls.filter(([path]) => path === '/api/bill-payments')).toEqual([
    ['/api/bill-payments', { billId: 207, periodKey: '2026-10', paidAt: '2026-10-03', transactionId: 101, markerOnly: true }],
    ['/api/bill-payments', { billId: 208, periodKey: '2026-10', paidAt: '2026-10-03', transactionId: 101, markerOnly: true }],
    ['/api/bill-payments', { billId: 209, periodKey: '2026-10', paidAt: '2026-10-04', transactionId: 102, markerOnly: true }],
  ])
  expect(put.mock.calls.some(([path]) => path.endsWith('/fixed-allocations'))).toBe(false)
})

it('设置展示本月固定账单的净付款与剩余金额', () => {
  const today = todayISO()
  mocks.bills = [{ id: 7, name: '房租', amount: 800, dueDay: 1, remindDaysBefore: 3, active: true }]
  mocks.transactions = [
    { id: 1, type: 'expense', amount: 500, occurredAt: today, status: 'confirmed' },
    { id: 2, type: 'refund', amount: 50, occurredAt: today, status: 'confirmed' },
  ]
  mocks.allocations = [
    { transactionId: 1, billId: 7, periodKey: `${today.slice(0, 7)}-01`, amount: 500 },
    { transactionId: 2, billId: 7, periodKey: `${today.slice(0, 7)}-01`, amount: 50 },
  ]
  render(<Settings />)
  expect(screen.getByText('本月到期 · 部分支付 ¥450.00 · 待付 ¥350.00')).toBeTruthy()
})
