import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './client'
import { fetchAllTransactions } from './transactions'

afterEach(() => vi.restoreAllMocks())

describe('fetchAllTransactions', () => {
  it('跟随 ID 游标完整读取，包含超过旧备份上限的记录', async () => {
    const first = Array.from({ length: 2000 }, (_, i) => ({ id: 3000 - i }))
    const get = vi.spyOn(api, 'get').mockResolvedValueOnce({ transactions: first, nextCursor: 1001 })
      .mockResolvedValueOnce({ transactions: [{ id: 1000 }], nextCursor: null })
    const list = await fetchAllTransactions()
    expect(list).toHaveLength(2001)
    expect(get.mock.calls.map(([url]) => url)).toEqual([
      '/api/transactions?pagination=id&limit=2000',
      '/api/transactions?pagination=id&limit=2000&beforeId=1001',
    ])
  })

  it('任何一页失败时拒绝返回不完整的备份数据', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({ transactions: [{ id: 3 }], nextCursor: 3 })
      .mockRejectedValueOnce(new Error('网络中断'))
    await expect(fetchAllTransactions()).rejects.toThrow('网络中断')
  })

  it('发现游标未前进时停止，避免无限请求', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ transactions: [{ id: 3 }], nextCursor: 3 })
    await expect(fetchAllTransactions()).rejects.toThrow('交易分页游标无效')
  })
})
