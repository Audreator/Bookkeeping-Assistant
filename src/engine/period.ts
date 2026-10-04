import { addDays, daysBetween, daysInMonthKey, monthKey, round2, startOfWeekISO } from '../lib/dates'
import type { BudgetEvent, PeriodMode, WeekStartsOn } from './types'

export interface Period {
  start: string
  end: string
  days: number
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 计算包含 iso 的期间（月模式按 cycleStartDay 锚定；周模式从周起始日起 7 天） */
export function resolvePeriod(
  iso: string,
  mode: PeriodMode,
  cycleStartDay: number,
  weekStartsOn: WeekStartsOn,
): Period {
  if (mode === 'week') {
    const start = startOfWeekISO(iso, weekStartsOn)
    const end = addDays(start, 6)
    return { start, end, days: 7 }
  }

  const [y, m, d] = iso.split('-').map(Number)
  let start: string
  if (d >= cycleStartDay) {
    start = `${y}-${pad(m)}-${pad(cycleStartDay)}`
  } else {
    const py = m === 1 ? y - 1 : y
    const pm = m === 1 ? 12 : m - 1
    start = `${py}-${pad(pm)}-${pad(cycleStartDay)}`
  }
  const [sy, sm] = start.split('-').map(Number)
  const nextStart =
    sm === 12 ? `${sy + 1}-01-${pad(cycleStartDay)}` : `${sy}-${pad(sm + 1)}-${pad(cycleStartDay)}`
  const end = addDays(nextStart, -1)
  return { start, end, days: daysBetween(start, end) + 1 }
}

/** 周模式的自动周预算 = 月预算 × 7 ÷ 当月天数 */
export function autoWeekBudget(monthBudget: number, iso: string): number {
  return round2((monthBudget * 7) / daysInMonthKey(monthKey(iso)))
}

/** 不晚于 iso 的最后一个事件（事件须按 at 升序传入） */
export function effectiveConfig(events: BudgetEvent[], iso: string): BudgetEvent | null {
  let result: BudgetEvent | null = null
  for (const e of events) {
    if (e.at <= iso) result = e
    else break
  }
  return result
}

/** 事件是否为"开新期间"的变更（模式或锚点变化） */
export function startsNewPeriod(prev: BudgetEvent | null, next: BudgetEvent): boolean {
  if (!prev) return true
  return (
    prev.mode !== next.mode ||
    prev.cycleStartDay !== next.cycleStartDay ||
    prev.weekStartsOn !== next.weekStartsOn
  )
}
