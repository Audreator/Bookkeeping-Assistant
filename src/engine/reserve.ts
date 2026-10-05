import { addDays, daysInMonthKey, monthKey, round2 } from '../lib/dates'
import type { EngineTx } from './types'

export interface RecurringBill {
  id: number
  name: string
  amount: number
  categoryId: number | null
  /** 1..28（超过当月天数自动钳制到月末） */
  dueDay: number
  remindDaysBefore: number
  active: boolean
}

export interface BillPayment {
  id: number
  billId: number
  /** 到期日 YYYY-MM-DD（同一到期日只记一次） */
  periodKey: string
  paidAt: string
  transactionId?: number | null
}

export interface UpcomingBill {
  billId: number
  name: string
  amount: number
  dueDate: string
  paid: boolean
  /** 实际关联的已付净额（扣除固定退款），旧支付标记不伪造金额。 */
  paidAmount: number
  remainingAmount: number
  /** 今日起 remindDaysBefore 天内到期且未支付 */
  dueSoon: boolean
}

export interface ReserveResult {
  /** 本期固定净付款 + 本期到期计划未覆盖余额；可因退回历史支出而为负。 */
  reserved: number
  upcoming: UpcomingBill[]
}

export interface FixedAllocation {
  transactionId: number
  billId: number
  periodKey: string
  amount: number
}

export interface FixedTransaction {
  id: number
  amount: number
  type: 'expense' | 'refund'
  occurredAt: string
  status: 'pending' | 'confirmed'
}

const cents = (value: number): number => Math.round(round2(value) * 100)

/** 只调整当前期间；历史仍按原现金流水计算，跨期结转不会产生免费余额。 */
export function fixedBudgetTransactions(
  transactions: FixedTransaction[], allocations: FixedAllocation[], periodStart: string, today: string,
): EngineTx[] {
  const byTransaction = new Map<number, number>()
  for (const a of allocations) byTransaction.set(a.transactionId, (byTransaction.get(a.transactionId) ?? 0) + cents(a.amount))
  return transactions.map(t => ({
    id: String(t.id), type: t.type, occurredAt: t.occurredAt, status: t.status,
    amount: t.status === 'confirmed' && t.occurredAt >= periodStart && t.occurredAt <= today
      ? Math.max(0, cents(t.amount) - (byTransaction.get(t.id) ?? 0)) / 100
      : t.amount,
  }))
}

const dueDatesInPeriod = (dueDay: number, periodStart: string, periodEnd: string): string[] => {
  const dates: string[] = []
  let cursor = `${monthKey(periodStart)}-01`
  while (cursor <= periodEnd) {
    const key = monthKey(cursor)
    const day = Math.min(dueDay, daysInMonthKey(key))
    const date = `${key}-${String(day).padStart(2, '0')}`
    if (date >= periodStart && date <= periodEnd) dates.push(date)
    cursor = addDays(cursor, daysInMonthKey(key))
  }
  return dates
}

export function computeReserve(
  bills: RecurringBill[],
  payments: BillPayment[],
  periodStart: string,
  periodEnd: string,
  today: string,
  fixed?: { allocations: FixedAllocation[]; transactions: FixedTransaction[] },
): ReserveResult {
  const txById = new Map((fixed?.transactions ?? []).map(t => [t.id, t]))
  const paidByOccurrence = new Map<string, number>()
  let fixedPaid = 0
  for (const a of fixed?.allocations ?? []) {
    const tx = txById.get(a.transactionId)
    if (!tx || tx.status !== 'confirmed' || tx.occurredAt > today) continue
    const amount = cents(a.amount) * (tx.type === 'refund' ? -1 : 1)
    const key = `${a.billId}:${a.periodKey}`
    paidByOccurrence.set(key, (paidByOccurrence.get(key) ?? 0) + amount)
    if (tx.occurredAt >= periodStart && tx.occurredAt <= periodEnd) fixedPaid += amount
  }
  const upcoming: UpcomingBill[] = []
  for (const b of bills) {
    if (!b.active) continue
    for (const dueDate of dueDatesInPeriod(b.dueDay, periodStart, periodEnd)) {
      const occurrenceKey = `${b.id}:${dueDate}`
      const paidAmount = Math.max(0, paidByOccurrence.get(occurrenceKey) ?? 0) / 100
      const remainingAmount = Math.max(0, cents(b.amount) - cents(paidAmount)) / 100
      const paid = remainingAmount === 0 || (!paidByOccurrence.has(occurrenceKey) &&
        payments.some((p) => p.billId === b.id && p.periodKey === dueDate))
      const dueSoon = !paid && dueDate >= today && dueDate <= addDays(today, b.remindDaysBefore)
      upcoming.push({
        billId: b.id,
        name: b.name,
        amount: round2(b.amount),
        dueDate,
        paid,
        paidAmount,
        remainingAmount,
        dueSoon,
      })
    }
  }
  // 有真实金额的分摊才覆盖计划，旧“已付”标记仅用于展示。
  // 超额付款按实际额预留，跨期已付款不再次预留，固定退款也不会双补日常。
  const reserved = (fixedPaid + upcoming.reduce((sum, u) => sum + cents(u.remainingAmount), 0)) / 100
  return { reserved, upcoming }
}
