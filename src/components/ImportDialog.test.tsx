import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImportDialog } from './ImportDialog'

const mocks = vi.hoisted(() => ({ create: vi.fn(), fetchAll: vi.fn().mockResolvedValue([]) }))
vi.mock('../api/hooks', () => ({
  useTransactions: () => ({ data: [] }),
  useTransactionMutations: () => ({ create: { mutateAsync: mocks.create } }),
}))
vi.mock('../api/transactions', () => ({ fetchAllTransactions: mocks.fetchAll }))
afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.fetchAll.mockResolvedValue([]) })
const csv = `交易时间,交易类型,交易对方,商品,收/支,金额(元),当前状态
2026-10-03 12:00:01,商户消费,店一,商品,支出,¥1.00,支付成功
2026-10-03 12:00:02,商户消费,店二,商品,支出,¥2.00,支付成功
2026-10-03 12:00:03,商户消费,店三,商品,支出,¥3.00,支付成功`
const chooseFile = async () => {
  fireEvent.change(screen.getByLabelText('选择 CSV 账单文件'), { target: {
    files: [{ arrayBuffer: async () => new TextEncoder().encode(csv).buffer }],
  } })
  await screen.findByRole('button', { name: '导入 3 笔' })
}

describe('ImportDialog 安全重试', () => {
  it('最新交易读取失败时阻止预览和写入，不把已有账本当空', async () => {
    mocks.fetchAll.mockRejectedValueOnce(new Error('交易记录加载失败'))
    render(<ImportDialog open onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('选择 CSV 账单文件'), { target: {
      files: [{ arrayBuffer: async () => new TextEncoder().encode(csv).buffer }],
    } })
    await screen.findByText('交易记录加载失败')
    expect(screen.queryByRole('button', { name: /导入 \d+ 笔/ })).toBeNull()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('用同一次完整读取的最新交易去重并冻结分类', async () => {
    mocks.fetchAll.mockResolvedValueOnce([
      { id: 1, type: 'expense', merchant: '店一', amount: 1, occurredAt: '2026-10-03', occurredTime: '12:00:01', categoryId: 8 },
      { id: 2, type: 'expense', merchant: '店二', amount: 99, occurredAt: '2026-10-02', occurredTime: null, categoryId: 6 },
    ])
    mocks.create.mockResolvedValue({ id: 3 })
    const close = vi.fn()
    render(<ImportDialog open onClose={close} />)
    fireEvent.change(screen.getByLabelText('选择 CSV 账单文件'), { target: {
      files: [{ arrayBuffer: async () => new TextEncoder().encode(csv).buffer }],
    } })
    fireEvent.click(await screen.findByRole('button', { name: '导入 2 笔' }))
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1))
    expect(mocks.create.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ merchant: '店二', categoryId: 6 }))
  })

  it('部分失败时移除成功行，剩余行重试沿用原幂等请求 ID', async () => {
    const close = vi.fn()
    mocks.create.mockResolvedValueOnce({ id: 1 }).mockRejectedValueOnce(new Error('网络中断'))
      .mockResolvedValueOnce({ id: 2 }).mockResolvedValueOnce({ id: 3 })
    render(<ImportDialog open onClose={close} />)
    await chooseFile()
    fireEvent.click(screen.getByRole('button', { name: '导入 3 笔' }))
    await screen.findByText('网络中断')
    fireEvent.click(screen.getByRole('button', { name: '导入 2 笔' }))
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1))
    expect(mocks.create.mock.calls.map(([input]) => input.merchant)).toEqual(['店一', '店二', '店二', '店三'])
    const failed = mocks.create.mock.calls[1]?.[0]
    const retry = mocks.create.mock.calls[2]?.[0]
    expect(failed.requestId).toMatch(/^csv-/)
    expect(retry).toEqual(failed)
  })

  it('写入期间禁止返回、遮罩及 Escape 关闭，结束后可关闭', async () => {
    let release!: (value: { id: number }) => void
    const close = vi.fn()
    mocks.create.mockImplementation(() => new Promise((resolve) => { release = resolve }))
    render(<ImportDialog open onClose={close} />)
    await chooseFile()
    fireEvent.click(screen.getByRole('button', { name: '导入 3 笔' }))
    expect((screen.getByRole('button', { name: '返回' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('dialog').parentElement!)
    expect(close).not.toHaveBeenCalled()
    mocks.create.mockResolvedValue({ id: 2 })
    release({ id: 1 })
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1))
  })
})
