import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { Settings } from './Settings'

const mocks = vi.hoisted(() => ({ invalidateQueries: vi.fn() }))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => mocks }))
vi.mock('../state/AuthContext', () => ({ useAuth: () => ({ user: { displayName: '我的账本', username: 'test' }, logout: vi.fn() }) }))
vi.mock('../api/hooks', () => ({
  useSettings: () => ({ data: {} }), useUpdateSettings: () => ({}),
  useCategories: () => ({ data: [] }), useCategoryMutations: () => ({}),
  useBillsData: () => ({ data: { bills: [], payments: [] } }), useBillMutations: () => ({}),
  useTransactions: () => ({ data: [] }), useTransactionMutations: () => ({}),
}))
vi.mock('../api/transactions', () => ({ fetchAllTransactions: async () => [] }))
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals() })

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
