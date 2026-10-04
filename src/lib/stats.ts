import type { Tx } from '../api/types'
import { monthKey, round2 } from './dates'

export interface CategoryTotal {
  categoryId: number | null
  total: number
}

export interface DayTotal {
  date: string
  total: number
}

export interface MerchantTotal {
  merchant: string
  total: number
}

const confirmedInMonth = (txs: Tx[], month: string): Tx[] =>
  txs.filter((t) => t.status === 'confirmed' && monthKey(t.occurredAt) === month)

const expenses = (txs: Tx[], month: string): Tx[] =>
  confirmedInMonth(txs, month).filter((t) => t.type === 'expense')

// 金额按“分”整数累加再除回元，精确计算、彻底消除浮点误差。
const toCents = (n: number): number => Math.round(n * 100)
const sumCents = (amounts: readonly number[]): number =>
  amounts.reduce((s, a) => s + toCents(a), 0)
const centsToYuan = (cents: number): number => round2(cents / 100)

/** 本月支出合计（正数，不含退款/收入） */
export function monthExpense(txs: Tx[], month: string): number {
  return centsToYuan(sumCents(expenses(txs, month).map((t) => t.amount)))
}

/** 本月收入合计（正数；退款、收款、工资等“钱进来”统一视为收入） */
export function monthIncome(txs: Tx[], month: string): number {
  return centsToYuan(
    sumCents(confirmedInMonth(txs, month).filter((t) => t.type === 'refund').map((t) => t.amount)),
  )
}

export function monthlyByCategory(txs: Tx[], month: string): CategoryTotal[] {
  const map = new Map<number | null, number>()
  for (const t of expenses(txs, month)) {
    map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + toCents(t.amount))
  }
  return [...map.entries()]
    .map(([categoryId, cents]) => ({ categoryId, total: centsToYuan(cents) }))
    .filter((x) => x.total !== 0)
    .sort((a, b) => b.total - a.total)
}

export function dailyTotals(txs: Tx[], month: string): DayTotal[] {
  const map = new Map<string, number>()
  for (const t of expenses(txs, month)) {
    map.set(t.occurredAt, (map.get(t.occurredAt) ?? 0) + toCents(t.amount))
  }
  return [...map.entries()]
    .map(([date, cents]) => ({ date, total: centsToYuan(cents) }))
    .filter((x) => x.total !== 0)
    .sort((a, b) => a.date.localeCompare(b.date))
}

export function topMerchants(txs: Tx[], month: string, n = 5): MerchantTotal[] {
  const map = new Map<string, number>()
  for (const t of expenses(txs, month)) {
    if (!t.merchant) continue
    map.set(t.merchant, (map.get(t.merchant) ?? 0) + toCents(t.amount))
  }
  return [...map.entries()]
    .map(([merchant, cents]) => ({ merchant, total: centsToYuan(cents) }))
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, n)
}
