export interface User {
  id: number
  username: string
  displayName: string
}

export interface Category {
  id: number
  name: string
  icon: string
  color: string
  sort: number
  type: string
}

export type TxType = 'expense' | 'refund'
export type TxSource = 'manual' | 'ocr' | 'import' | 'bank-email'

export interface FixedAllocation {
  id: number
  transactionId: number
  billId: number
  /** 对应固定账单到期日 YYYY-MM-DD。 */
  periodKey: string
  amount: number
}

export type FixedAllocationInput = Pick<FixedAllocation, 'billId' | 'periodKey' | 'amount'>

export interface Tx {
  id: number
  type: TxType
  amount: number
  categoryId: number | null
  merchant: string | null
  note: string | null
  occurredAt: string
  /** 本地交易时间 HH:mm:ss；旧记录或来源未提供时为 null/缺省。 */
  occurredTime?: string | null
  source: TxSource
  refundOfId: number | null
  status: 'pending' | 'confirmed'
  createdAt: string
  fixedAllocations?: FixedAllocation[]
}

export interface BudgetEventDTO {
  id: number
  at: string
  mode: 'month' | 'week'
  monthBudget: number
  weekBudgetOverride: number | null
  cycleStartDay: number
  weekStartsOn: 1 | 7
  note: string | null
  createdAt: string
}

export interface Bill {
  id: number
  name: string
  amount: number
  categoryId: number | null
  dueDay: number
  remindDaysBefore: number
  active: boolean
}

export interface BillPayment {
  id: number
  billId: number
  periodKey: string
  paidAt: string
  transactionId: number | null
}

export interface DayOverride {
  id: number
  date: string
  amount: number
  note: string | null
}

export interface SettingsMap {
  reserveEnabled?: boolean
  carryoverAcrossPeriod?: boolean
  [key: string]: unknown
}
