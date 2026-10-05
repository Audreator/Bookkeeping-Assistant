import { round2 } from './dates'

export interface BudgetProgress {
  /** 退款抵扣后的日常净支出，仅用于展示；不回写预算引擎。 */
  used: number
  /** 退款/收入超出日常支出的净入账，仍由预算引擎完整回补余额。 */
  netInflow: number
  /** 正预算下的使用比例，可超过1以反映超支。 */
  progress: number
  percentage: number
  /** 预算不为正时没有可定义的使用比例，界面应显示暂无额度而非百分比。 */
  budgetUnavailable: boolean
}

/** 将净现金流解释为使用进度或净入账，保留引擎的现金守恒语义。 */
export function computeBudgetProgress(spentInPeriod: number, periodBudget: number): BudgetProgress {
  const netSpent = round2(spentInPeriod)
  const used = Math.max(0, netSpent)
  const netInflow = Math.max(0, -netSpent)
  const budgetUnavailable = periodBudget <= 0
  const progress = budgetUnavailable ? 0 : used / periodBudget
  return { used, netInflow, progress, percentage: Math.round(progress * 100), budgetUnavailable }
}
