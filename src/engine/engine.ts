import { addDays, round2 } from '../lib/dates'
import { autoWeekBudget, effectiveConfig, resolvePeriod } from './period'
import type {
  BudgetEvent,
  BudgetState,
  DayAllowance,
  EngineInput,
  PeriodMode,
  WeekStartsOn,
} from './types'

interface Config {
  mode: PeriodMode
  monthBudget: number
  weekBudgetOverride: number | null
  cycleStartDay: number
  weekStartsOn: WeekStartsOn
}

const configOf = (e: BudgetEvent): Config => ({
  mode: e.mode,
  monthBudget: e.monthBudget,
  weekBudgetOverride: e.weekBudgetOverride,
  cycleStartDay: e.cycleStartDay,
  weekStartsOn: e.weekStartsOn,
})

const budgetOf = (cfg: Config, periodStart: string): number =>
  cfg.mode === 'month'
    ? cfg.monthBudget
    : (cfg.weekBudgetOverride ?? autoWeekBudget(cfg.monthBudget, periodStart))

/**
 * 期间结束日：
 * - 周模式：起点 + 6 天；
 * - 月模式：下一个周期起始日的前一天（起点若非锚定日——如模式切换日——期间顺延到下一个日历锚点）。
 */
const endOfPeriod = (start: string, cfg: Config): string => {
  if (cfg.mode === 'week') return addDays(start, 6)
  return resolvePeriod(start, 'month', cfg.cycleStartDay, cfg.weekStartsOn).end
}

const ZERO_STATE = (today: string): BudgetState => ({
  mode: 'month',
  periodStart: today,
  periodEnd: today,
  periodBudget: 0,
  baseToday: 0,
  pool: 0,
  availableToday: 0,
  issuedInPeriod: 0,
  spentInPeriod: 0,
  remainingInPeriod: 0,
  overridesFeasible: true,
  days: [],
})

/**
 * 预算引擎：从首个事件逐日模拟到 today，再给出当前期间的未来投影。
 *
 * 规则（spec §4）：
 * - 每日发放额度 B；`pool` = 已发放 − 已花；当日可花 = pool(昨日) + B − 当日已花（实时，可负）
 * - 单独某天的预算优先：该天发放 = 设定金额，且该天显示不受结转池拖累（= 设定金额 − 当日已花），
 *   差额由其他天自动重算吸收；
 * - 其他天自动重算：`B =（当期预算 − 已发放 − 本日及以后所有单独预算）÷（本日及以后无单独预算的天数）`；
 *   预算额中途调整也被该公式自动吸收；若重算结果被压到负数，则 `overridesFeasible = false`（界面提示预算不足）。
 * - 模式/锚点变更：从变更日开新期间，结转池保留
 * - 自然跨期：carryoverAcrossPeriod 决定结转池清零或带入
 */
export function computeBudgetState(input: EngineInput): BudgetState {
  const { events, transactions, today, carryoverAcrossPeriod } = input
  const firstEvent = events[0]
  if (!firstEvent || firstEvent.at > today) return ZERO_STATE(today)

  // 固定支出预留：从匹配期间的总预算中预先扣除，其余日期的每日发放随之重算。
  const fixedReserve = input.fixedReserve
  const effectiveBudget = (cfg: Config, start: string): number =>
    fixedReserve && fixedReserve.periodStart === start
      ? budgetOf(cfg, start) - fixedReserve.amount
      : budgetOf(cfg, start)

  const spentByDay = new Map<string, number>()
  for (const t of transactions) {
    if (t.status !== 'confirmed') continue
    const sign = t.type === 'refund' ? -1 : 1
    spentByDay.set(t.occurredAt, round2((spentByDay.get(t.occurredAt) ?? 0) + sign * t.amount))
  }

  const eventsByDay = new Map<string, BudgetEvent[]>()
  for (const e of events) {
    if (e.at > today) break
    const arr = eventsByDay.get(e.at)
    if (arr) arr.push(e)
    else eventsByDay.set(e.at, [e])
  }

  const overrideByDate = new Map<string, number>()
  for (const o of input.overrides ?? []) {
    overrideByDate.set(o.date, round2(o.amount))
  }

  let cfg = configOf(effectiveConfig(events, firstEvent.at)!)
  let periodStart = firstEvent.at
  let periodEnd = endOfPeriod(periodStart, cfg)
  let periodBudget = effectiveBudget(cfg, periodStart)
  let pool = 0
  let issuedInPeriod = 0
  let spentInPeriod = 0
  let overridesFeasible = true

  const allDays: Array<DayAllowance & { periodStart: string }> = []

  const startPeriod = (day: string, keepPool: boolean) => {
    periodStart = day
    periodEnd = endOfPeriod(day, cfg)
    periodBudget = effectiveBudget(cfg, day)
    issuedInPeriod = 0
    spentInPeriod = 0
    if (!keepPool) pool = 0
  }

  /** 计算某天的发放额：单独预算优先，否则按剩余预算均摊到其他天 */
  const computeIssued = (
    day: string,
    issuedSoFar: number,
  ): { issued: number; isOverride: boolean } => {
    const override = overrideByDate.get(day)
    if (override != null) return { issued: override, isOverride: true }

    let futureOverrides = 0
    let futureOtherDays = 0
    for (let d = day; d <= periodEnd; d = addDays(d, 1)) {
      const o = overrideByDate.get(d)
      if (o != null) futureOverrides += o
      else futureOtherDays += 1
    }
    if (futureOtherDays === 0) return { issued: 0, isOverride: false }

    const issued = (periodBudget - issuedSoFar - futureOverrides) / futureOtherDays
    if (issued < -0.004) overridesFeasible = false
    return { issued, isOverride: false }
  }

  let poolAtTodayStart = 0
  let baseToday = 0
  let spentTodayTotal = 0
  let todayIsOverride = false

  for (let d = firstEvent.at; d <= today; d = addDays(d, 1)) {
    if (d > periodEnd) startPeriod(d, carryoverAcrossPeriod)

    const dayEvents = eventsByDay.get(d)
    if (dayEvents) {
      let modeAnchorChanged = false
      for (const e of dayEvents) {
        const next = configOf(e)
        if (
          next.mode !== cfg.mode ||
          next.cycleStartDay !== cfg.cycleStartDay ||
          next.weekStartsOn !== cfg.weekStartsOn
        ) {
          modeAnchorChanged = true
        }
        cfg = next
      }

      if (modeAnchorChanged) {
        startPeriod(d, true)
      } else {
        // 预算额变更：无需特殊处理，后续每日发放公式自动重算
        periodBudget = effectiveBudget(cfg, periodStart)
      }
    }

    const { issued, isOverride } = computeIssued(d, issuedInPeriod)
    const spentToday = spentByDay.get(d) ?? 0
    if (d === today) {
      poolAtTodayStart = pool
      baseToday = issued
      spentTodayTotal = spentToday
      todayIsOverride = isOverride
    }

    allDays.push({
      date: d,
      base: round2(issued),
      // 单独预算日：显示设定金额 − 当日已花（不受结转池拖累）；其他日：结转池 + 当日发放 − 当日已花（可为负）
      available: round2(isOverride ? issued - spentToday : pool + issued - spentToday),
      spent: round2(spentToday),
      isOverride,
      periodStart,
    })
    issuedInPeriod += issued
    spentInPeriod += spentToday
    pool += issued - spentToday
  }

  const days: DayAllowance[] = allDays
    .filter((x) => x.periodStart === periodStart)
    .map(({ periodStart: _ps, ...rest }) => rest)

  let futurePool = pool
  let projectedIssued = issuedInPeriod
  for (let d = addDays(today, 1); d <= periodEnd; d = addDays(d, 1)) {
    const { issued, isOverride } = computeIssued(d, projectedIssued)
    days.push({
      date: d,
      base: round2(issued),
      // 单独预算日显示设定金额；其他日为累计池 + 发放（无消费投影）
      available: round2(isOverride ? issued : futurePool + issued),
      spent: 0,
      isOverride,
    })
    futurePool += issued
    projectedIssued += issued
  }

  return {
    mode: cfg.mode,
    periodStart,
    periodEnd,
    periodBudget: round2(periodBudget),
    baseToday: round2(baseToday),
    pool: round2(poolAtTodayStart),
    availableToday: round2(
      todayIsOverride
        ? baseToday - spentTodayTotal
        : poolAtTodayStart + baseToday - spentTodayTotal,
    ),
    issuedInPeriod: round2(issuedInPeriod),
    spentInPeriod: round2(spentInPeriod),
    remainingInPeriod: round2(periodBudget - spentInPeriod),
    overridesFeasible,
    days,
  }
}
