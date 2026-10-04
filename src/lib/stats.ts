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

const signed = (t: Tx): number => (t.type === 'refund' ? -t.amount : t.amount)

export function monthlyByCategory(txs: Tx[], month: string): CategoryTotal[] {
  const map = new Map<number | null, number>()
  for (const t of confirmedInMonth(txs, month)) {
    map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + signed(t))
  }
  return [...map.entries()]
    .map(([categoryId, total]) => ({ categoryId, total: round2(total) }))
    .filter((x) => x.total !== 0)
    .sort((a, b) => b.total - a.total)
}

export function dailyTotals(txs: Tx[], month: string): DayTotal[] {
  const map = new Map<string, number>()
  for (const t of confirmedInMonth(txs, month)) {
    map.set(t.occurredAt, (map.get(t.occurredAt) ?? 0) + signed(t))
  }
  return [...map.entries()]
    .map(([date, total]) => ({ date, total: round2(total) }))
    .filter((x) => x.total !== 0)
    .sort((a, b) => a.date.localeCompare(b.date))
}

export function topMerchants(txs: Tx[], month: string, n = 5): MerchantTotal[] {
  const map = new Map<string, number>()
  for (const t of confirmedInMonth(txs, month)) {
    if (!t.merchant) continue
    map.set(t.merchant, (map.get(t.merchant) ?? 0) + signed(t))
  }
  return [...map.entries()]
    .map(([merchant, total]) => ({ merchant, total: round2(total) }))
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, n)
}

export function monthTotal(txs: Tx[], month: string): number {
  return round2(
    confirmedInMonth(txs, month).reduce((sum, t) => sum + signed(t), 0),
  )
}
