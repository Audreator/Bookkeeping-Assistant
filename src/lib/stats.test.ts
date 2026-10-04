import { describe, expect, it } from 'vitest'
import type { Tx } from '../api/types'
import { dailyTotals, monthlyByCategory, monthTotal, topMerchants } from './stats'

const tx = (over: Partial<Tx>): Tx => ({
  id: 1,
  type: 'expense',
  amount: 10,
  categoryId: 1,
  merchant: '店',
  note: null,
  occurredAt: '2026-10-01',
  source: 'manual',
  refundOfId: null,
  status: 'confirmed',
  createdAt: '2026-10-01 10:00:00',
  ...over,
})

const TXS: Tx[] = [
  tx({ id: 1, amount: 30, categoryId: 1, occurredAt: '2026-10-01' }),
  tx({ id: 2, amount: 20, categoryId: 1, occurredAt: '2026-10-02' }),
  tx({ id: 3, amount: 50, categoryId: 2, occurredAt: '2026-10-02', merchant: '超市' }),
  tx({ id: 4, amount: 10, categoryId: 2, occurredAt: '2026-10-03', type: 'refund' }),
  tx({ id: 5, amount: 99, categoryId: 3, occurredAt: '2026-09-30' }),
  tx({ id: 6, amount: 88, categoryId: 1, occurredAt: '2026-10-04', status: 'pending' }),
]

describe('monthlyByCategory', () => {
  it('只统计指定月份且退款冲减，按金额降序', () => {
    const result = monthlyByCategory(TXS, '2026-10')
    expect(result).toEqual([
      { categoryId: 1, total: 50 },
      { categoryId: 2, total: 40 },
    ])
  })

  it('无数据月份返回空数组', () => {
    expect(monthlyByCategory(TXS, '2026-08')).toEqual([])
  })
})

describe('dailyTotals', () => {
  it('按日汇总（退款为负），升序', () => {
    const result = dailyTotals(TXS, '2026-10')
    expect(result).toEqual([
      { date: '2026-10-01', total: 30 },
      { date: '2026-10-02', total: 70 },
      { date: '2026-10-03', total: -10 },
    ])
  })
})

describe('topMerchants', () => {
  it('按商家汇总取前 N，排除空商家', () => {
    const txs = [
      ...TXS,
      tx({ id: 7, amount: 25, merchant: '咖啡店' }),
      tx({ id: 8, amount: 15, merchant: '咖啡店' }),
      tx({ id: 9, amount: 5, merchant: null }),
    ]
    const result = topMerchants(txs, '2026-10', 2)
    expect(result[0]).toEqual({ merchant: '超市', total: 50 })
    expect(result[1]).toEqual({ merchant: '店', total: 40 })
    expect(result).toHaveLength(2)
  })
})

describe('monthTotal', () => {
  it('月总支出（退款冲减）', () => {
    expect(monthTotal(TXS, '2026-10')).toBe(90)
  })
})
