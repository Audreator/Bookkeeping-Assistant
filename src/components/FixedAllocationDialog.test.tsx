import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { FixedAllocation, Tx } from '../api/types'
import { FixedAllocationDialog } from './FixedAllocationDialog'

const mocks = vi.hoisted(() => ({ save: vi.fn(), allocations: [] as FixedAllocation[], loading: false, inactive: false }))
vi.mock('../api/hooks', () => ({
  useBillsData: () => ({ isLoading: mocks.loading, data: { bills: [
    { id: 7, name: '房租', amount: 800, dueDay: 1, active: !mocks.inactive },
    { id: 8, name: '水费', amount: 50, dueDay: 5, active: true },
  ], allocations: mocks.allocations } }),
  useFixedAllocationMutation: () => ({ mutateAsync: mocks.save }),
}))
afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.allocations = []; mocks.loading = false; mocks.inactive = false })
const tx: Tx = { id: 1, type: 'expense', amount: 880, categoryId: null,
  merchant: null, note: null, occurredAt: '2026-10-03', source: 'ocr', refundOfId: null,
  status: 'confirmed', createdAt: 'x' }

it('多选账单分摊后展示日常余额，并只保存关联而不修改原交易', async () => {
  const close = vi.fn()
  render(<FixedAllocationDialog transaction={tx} onClose={close} />)
  fireEvent.click(screen.getByLabelText('选择房租'))
  fireEvent.click(screen.getByLabelText('选择水费'))
  expect(screen.getByText('¥30.00')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('水费所属到期日'), { target: { value: '2026-09-05' } })
  fireEvent.click(screen.getByRole('button', { name: '保存分摊' }))
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ transactionId: 1, allocations: [
    { billId: 7, periodKey: '2026-10-01', amount: 800 },
    { billId: 8, periodKey: '2026-09-05', amount: 50 },
  ] }))
  expect(close).toHaveBeenCalled()
})

it('分摊超过交易金额时阻止提交，允许改为部分付款', async () => {
  render(<FixedAllocationDialog transaction={tx} onClose={() => {}} />)
  fireEvent.click(screen.getByLabelText('选择房租'))
  fireEvent.change(screen.getByLabelText('房租分摊金额'), { target: { value: '900' } })
  fireEvent.click(screen.getByRole('button', { name: '保存分摊' }))
  expect(screen.getByRole('alert').textContent).toContain('分摊合计不能超过交易金额')
  expect(mocks.save).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('房租分摊金额'), { target: { value: '400.25' } })
  fireEvent.click(screen.getByRole('button', { name: '保存分摊' }))
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ transactionId: 1,
    allocations: [{ billId: 7, periodKey: '2026-10-01', amount: 400.25 }] }))
})

it('网络或服务端校验失败保留输入和弹窗，可以重试', async () => {
  mocks.save.mockRejectedValueOnce(new Error('本期已有退款，不能减少支付分摊'))
  const close = vi.fn()
  render(<FixedAllocationDialog transaction={tx} onClose={close} />)
  fireEvent.click(screen.getByLabelText('选择房租'))
  fireEvent.click(screen.getByRole('button', { name: '保存分摊' }))
  await screen.findByText('本期已有退款，不能减少支付分摊')
  expect(close).not.toHaveBeenCalled()
  expect((screen.getByLabelText('房租分摊金额') as HTMLInputElement).value).toBe('800')
})

it('加载已有分摊并支持全部撤销', async () => {
  mocks.allocations = [{ id: 1, transactionId: 1, billId: 7, periodKey: '2026-09-01', amount: 800 }]
  render(<FixedAllocationDialog transaction={tx} onClose={() => {}} />)
  expect((await screen.findByLabelText('房租所属到期日') as HTMLInputElement).value).toBe('2026-09-01')
  fireEvent.click(screen.getByRole('button', { name: '取消全部分摊' }))
  fireEvent.click(screen.getByRole('button', { name: '保存分摊' }))
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ transactionId: 1, allocations: [] }))
})

it('固定退款由用户明确选择后保存，不自动推断普通入账', async () => {
  render(<FixedAllocationDialog transaction={{ ...tx, type: 'refund', amount: 20 }} onClose={() => {}} />)
  expect(screen.getByText('未分摊部分按普通入账计算；仅选择实际退回的固定支出。')).toBeTruthy()
  expect((screen.getByLabelText('选择房租') as HTMLInputElement).checked).toBe(false)
  fireEvent.click(screen.getByLabelText('选择房租'))
  fireEvent.click(screen.getByRole('button', { name: '保存分摊' }))
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ transactionId: 1,
    allocations: [{ billId: 7, periodKey: '2026-10-01', amount: 20 }] }))
})

it('待确认交易不可分摊，加载期间也不可误保存空分摊', () => {
  mocks.loading = true
  render(<FixedAllocationDialog transaction={{ ...tx, status: 'pending' }} onClose={() => {}} />)
  expect((screen.getByRole('button', { name: '保存分摊' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText('请先确认这笔交易，再分摊到固定支出。')).toBeTruthy()
})

it('加载期间不允许 confirmed 交易把尚未加载的分摊误保存为空', () => {
  mocks.loading = true
  render(<FixedAllocationDialog transaction={tx} onClose={() => {}} />)
  expect((screen.getByRole('button', { name: '保存分摊' }) as HTMLButtonElement).disabled).toBe(true)
})

it('停用账单仍可关联真实固定退款，撤销选择后也可再选择', async () => {
  mocks.inactive = true
  render(<FixedAllocationDialog transaction={{ ...tx, type: 'refund', amount: 20 }} onClose={() => {}} />)
  expect(screen.getByText('房租（已停用）')).toBeTruthy()
  fireEvent.click(screen.getByLabelText('选择房租'))
  fireEvent.click(screen.getByLabelText('选择房租'))
  fireEvent.click(screen.getByLabelText('选择房租'))
  fireEvent.click(screen.getByRole('button', { name: '保存分摊' }))
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ transactionId: 1,
    allocations: [{ billId: 7, periodKey: '2026-10-01', amount: 20 }] }))
})

it('同一账单可分摊两期，已有关联两期不会被合并丢失', async () => {
  mocks.allocations = [
    { id: 1, transactionId: 1, billId: 7, periodKey: '2026-09-01', amount: 300 },
    { id: 2, transactionId: 1, billId: 7, periodKey: '2026-10-01', amount: 500 },
  ]
  render(<FixedAllocationDialog transaction={tx} onClose={() => {}} />)
  expect((await screen.findByLabelText('房租第2项所属到期日') as HTMLInputElement).value).toBe('2026-10-01')
  fireEvent.click(screen.getByRole('button', { name: '保存分摊' }))
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ transactionId: 1, allocations: [
    { billId: 7, periodKey: '2026-09-01', amount: 300 },
    { billId: 7, periodKey: '2026-10-01', amount: 500 },
  ] }))
})

it('重复账单期次和小于一分的金额不提交', async () => {
  render(<FixedAllocationDialog transaction={tx} onClose={() => {}} />)
  fireEvent.click(screen.getByLabelText('选择房租'))
  fireEvent.click(screen.getByRole('button', { name: '＋ 再分摊一期' }))
  fireEvent.change(screen.getByLabelText('房租第2项所属到期日'), { target: { value: '2026-10-01' } })
  fireEvent.click(screen.getByRole('button', { name: '保存分摊' }))
  expect(screen.getByRole('alert').textContent).toContain('同一账单同一到期日请合并为一项')
  fireEvent.change(screen.getByLabelText('房租第2项分摊金额'), { target: { value: '0.001' } })
  fireEvent.click(screen.getByRole('button', { name: '保存分摊' }))
  expect(screen.getByRole('alert').textContent).toContain('最多两位小数')
  expect(mocks.save).not.toHaveBeenCalled()
})
