import { describe, expect, it } from 'vitest'
import type { Tx } from '../api/types'
import { dailyTotals, monthExpense, monthIncome, monthlyByCategory, topMerchants } from './stats'

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

describe('monthExpense / monthIncome', () => {
  it('支出与收入分开统计，不相抵', () => {
    expect(monthExpense(TXS, '2026-10')).toBe(100)
    expect(monthIncome(TXS, '2026-10')).toBe(10)
  })

  it('收支相抵时支出与收入都保留', () => {
    const live: Tx[] = [
      tx({ id: 1, type: 'refund', amount: 0.02, occurredAt: '2026-10-05' }),
      tx({ id: 2, type: 'refund', amount: 0.01, occurredAt: '2026-10-05' }),
      tx({ id: 3, amount: 0.02, occurredAt: '2026-10-05' }),
      tx({ id: 4, amount: 0.01, occurredAt: '2026-10-05' }),
    ]
    expect(monthExpense(live, '2026-10')).toBe(0.03)
    expect(monthIncome(live, '2026-10')).toBe(0.03)
  })
})

describe('monthlyByCategory', () => {
  it('只按支出分类汇总，退款不冲减分类支出', () => {
    const result = monthlyByCategory(TXS, '2026-10')
    expect(result).toEqual([
      { categoryId: 1, total: 50 },
      { categoryId: 2, total: 50 },
    ])
  })

  it('收支相抵的分类仍显示其支出，不误判为本月无支出', () => {
    const live: Tx[] = [
      tx({ id: 1, amount: 0.01, categoryId: 1, occurredAt: '2026-10-05' }),
      tx({ id: 2, type: 'refund', amount: 0.01, categoryId: 1, occurredAt: '2026-10-05' }),
    ]
    expect(monthlyByCategory(live, '2026-10')).toEqual([{ categoryId: 1, total: 0.01 }])
  })

  it('无数据月份返回空数组', () => {
    expect(monthlyByCategory(TXS, '2026-08')).toEqual([])
  })
})

describe('dailyTotals', () => {
  it('按日汇总支出（不含退款），升序', () => {
    const result = dailyTotals(TXS, '2026-10')
    expect(result).toEqual([
      { date: '2026-10-01', total: 30 },
      { date: '2026-10-02', total: 70 },
    ])
  })

  it('极小金额按分精确累加，不出现 NaN', () => {
    const live: Tx[] = [
      tx({ id: 1, type: 'refund', amount: 0.02, occurredAt: '2026-10-05' }),
      tx({ id: 2, type: 'refund', amount: 0.01, occurredAt: '2026-10-05' }),
      tx({ id: 3, amount: 0.02, occurredAt: '2026-10-05' }),
      tx({ id: 4, amount: 0.01, occurredAt: '2026-10-05' }),
    ]
    expect(dailyTotals(live, '2026-10')).toEqual([{ date: '2026-10-05', total: 0.03 }])
  })
})

describe('topMerchants', () => {
  it('按商家汇总支出取前 N，排除空商家与退款', () => {
    const txs = [
      ...TXS,
      tx({ id: 7, amount: 25, merchant: '咖啡店' }),
      tx({ id: 8, amount: 15, merchant: '咖啡店' }),
      tx({ id: 9, amount: 5, merchant: null }),
      tx({ id: 10, amount: 999, merchant: '退款商家', type: 'refund' }),
    ]
    const result = topMerchants(txs, '2026-10', 2)
    expect(result[0]).toEqual({ merchant: '店', total: 50 })
    expect(result[1]).toEqual({ merchant: '超市', total: 50 })
    expect(result).toHaveLength(2)
  })
})
