export type PeriodMode = 'month' | 'week'

export type WeekStartsOn = 1 | 7

/** 预算事件：设置变更日志，引擎的唯一事实来源 */
export interface BudgetEvent {
  id: string
  /** 生效日期 YYYY-MM-DD（本地时区） */
  at: string
  mode: PeriodMode
  monthBudget: number
  weekBudgetOverride: number | null
  /** 1..28，月周期起始日 */
  cycleStartDay: number
  weekStartsOn: WeekStartsOn
  note?: string
  createdAt?: string
}

export type TxType = 'expense' | 'refund'

export interface EngineTx {
  id: string
  type: TxType
  /** 正数金额（元） */
  amount: number
  /** YYYY-MM-DD */
  occurredAt: string
  status: 'pending' | 'confirmed'
}

export interface DayAllowance {
  date: string
  /** 当日发放的额度（单独设预算的日子即为该金额） */
  base: number
  /** 当日可花（含结转，已扣当日消费），未来日为无消费投影 */
  available: number
  /** 当日实际已花（支出 − 退款），未来日为 0 */
  spent: number
  /** 该日是否被单独设置了预算 */
  isOverride: boolean
}

/** 单独某天的预算（其他天自动重算以对齐当期总额） */
export interface DayOverride {
  /** YYYY-MM-DD */
  date: string
  amount: number
}

export interface BudgetState {
  mode: PeriodMode
  periodStart: string
  periodEnd: string
  /** 当前生效的当期预算 */
  periodBudget: number
  baseToday: number
  /** 截至昨日的结转池（可负） */
  pool: number
  availableToday: number
  issuedInPeriod: number
  /** 净已花 = 纳入预算的支出 − 退款/收入，可为负；展示进度需另行解释净入账。 */
  spentInPeriod: number
  remainingInPeriod: number
  /** 单独预算是否可行：存在其他天被压到负额度时为 false（此时才允许修改已设的天） */
  overridesFeasible: boolean
  /** 当前期间逐日（含未来投影） */
  days: DayAllowance[]
}

export interface EngineInput {
  /** 按 at 升序；同日按数组顺序应用 */
  events: BudgetEvent[]
  transactions: EngineTx[]
  today: string
  carryoverAcrossPeriod: boolean
  /** 单独某天的预算设置（可选） */
  overrides?: DayOverride[]
  /**
   * 固定支出预留：从 periodStart 匹配的当期总预算中预先扣除（金额），
   * 扣除后其余日期的每日发放自动按余额重算；不匹配任何期间时忽略。
   * 历史固定退款可使金额为负，从而归还当前预算。
   */
  fixedReserve?: { periodStart: string; amount: number }
}
