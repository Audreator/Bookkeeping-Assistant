import { describe, expect, it } from 'vitest'
import type { Tx } from '../api/types'
import { sortTransactions } from './transactions'

const tx = (id: number, date: string, time: string | null): Tx => ({
  id, type: 'expense', amount: 10, categoryId: null, merchant: null, note: null,
  occurredAt: date, occurredTime: time, source: 'manual', refundOfId: null,
  status: 'confirmed', createdAt: '2026-10-04T10:00:00.000Z',
})

describe('sortTransactions', () => {
  it('按日期和秒级时间倒序，未知时间排在当天已知时间之后，不改变原数组', () => {
    const input = [tx(1, '2026-10-04', '10:30:01'), tx(2, '2026-10-04', null),
      tx(3, '2026-10-04', '10:30:02'), tx(4, '2026-10-05', null)]
    expect(sortTransactions(input).map((t) => t.id)).toEqual([4, 3, 1, 2])
    expect(input.map((t) => t.id)).toEqual([1, 2, 3, 4])
  })

  it('相同交易时间稳定地按 ID 倒序，不用录入时间伪造交易时间', () => {
    expect(sortTransactions([tx(1, '2026-10-04', null), tx(2, '2026-10-04', null)])
      .map((t) => t.id)).toEqual([2, 1])
  })
})
