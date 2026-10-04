import { addDays, daysInMonthKey, monthKey, round2 } from '../lib/dates'

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
  /** 今日起 remindDaysBefore 天内到期且未支付 */
  dueSoon: boolean
}

export interface ReserveResult {
  /** 本期内未支付的固定支出合计（展示层从可花额中扣减） */
  reserved: number
  upcoming: UpcomingBill[]
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
): ReserveResult {
  const upcoming: UpcomingBill[] = []
  for (const b of bills) {
    if (!b.active) continue
    for (const dueDate of dueDatesInPeriod(b.dueDay, periodStart, periodEnd)) {
      const paid = payments.some((p) => p.billId === b.id && p.periodKey === dueDate)
      const dueSoon = !paid && dueDate >= today && dueDate <= addDays(today, b.remindDaysBefore)
      upcoming.push({
        billId: b.id,
        name: b.name,
        amount: round2(b.amount),
        dueDate,
        paid,
        dueSoon,
      })
    }
  }
  const reserved = round2(
    upcoming.filter((u) => !u.paid).reduce((sum, u) => sum + u.amount, 0),
  )
  return { reserved, upcoming }
}
