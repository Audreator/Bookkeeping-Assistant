import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Tx } from '../api/types'
import { QuickAdd } from './QuickAdd'

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), remove: vi.fn() }))
vi.mock('../api/hooks', () => ({
  useCategories: () => ({ data: [] }),
  useTransactionMutations: () => ({ create: { mutateAsync: mocks.create },
    update: { mutateAsync: mocks.update }, remove: { mutateAsync: mocks.remove } }),
}))
afterEach(() => { cleanup(); vi.clearAllMocks() })

const editing: Tx = { id: 1, type: 'expense', amount: 12.5, categoryId: null,
  merchant: '便利店', note: null, occurredAt: '2026-10-03', occurredTime: null,
  source: 'manual', refundOfId: null, status: 'confirmed', createdAt: 'x' }

describe('QuickAdd 秒级时间', () => {
  it('编辑旧记录时保留未知时间，不用当前时刻覆盖', async () => {
    render(<QuickAdd open onClose={() => {}} editing={editing} />)
    expect((screen.getByLabelText('交易时间') as HTMLInputElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ id: 1,
      patch: expect.objectContaining({ occurredAt: '2026-10-03', occurredTime: null }),
    }))
  })

  it('支持精确到秒修改时间和主动清空时间', async () => {
    const { rerender } = render(<QuickAdd open onClose={() => {}} editing={editing} />)
    fireEvent.change(screen.getByLabelText('交易时间'), { target: { value: '12:30:41' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ id: 1,
      patch: expect.objectContaining({ occurredTime: '12:30:41' }),
    }))
    rerender(<QuickAdd open onClose={() => {}} editing={{ ...editing, occurredTime: '12:30:41' }} />)
    fireEvent.click(screen.getByRole('button', { name: '清空时间' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(mocks.update).toHaveBeenLastCalledWith({ id: 1,
      patch: expect.objectContaining({ occurredTime: null }),
    }))
  })

  it('日期改为历史日期时清除自动当前时间，不伪造过去交易时刻', async () => {
    render(<QuickAdd open onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('金额（元）'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('交易日期'), { target: { value: '2020-01-01' } })
    expect((screen.getByLabelText('交易时间') as HTMLInputElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ occurredTime: null })))
  })

  it('原生 input 事件可更新秒级时间，用户填写后修改日期仍保留', async () => {
    render(<QuickAdd open onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('金额（元）'), { target: { value: '10' } })
    fireEvent.input(screen.getByLabelText('交易时间'), { target: { value: '16:17:18' } })
    fireEvent.change(screen.getByLabelText('交易日期'), { target: { value: '2020-01-01' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ occurredTime: '16:17:18' })))
  })

  it('新交易遇到响应丢失时，重试使用相同 requestId', async () => {
    mocks.create.mockRejectedValueOnce(new Error('网络中断')).mockResolvedValueOnce({ id: 1 })
    render(<QuickAdd open onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('金额（元）'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByText('网络中断')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2))
    expect(mocks.create.mock.calls[0]?.[0].requestId).toMatch(/^manual-/)
    expect(mocks.create.mock.calls[1]?.[0]).toEqual(mocks.create.mock.calls[0]?.[0])
  })
})
