import { describe, expect, it } from 'vitest'
import { computeBudgetProgress } from './budgetProgress'

describe('预算进度展示与净现金流分离', () => {
  it('日常退款多于日常支出时展示0%及净入账，不显示负已使用', () => {
    expect(computeBudgetProgress(-82.77, 2250)).toEqual({
      used: 0, netInflow: 82.77, progress: 0, percentage: 0, budgetUnavailable: false,
    })
  })

  it('正净支出按日常预算显示真实比例，超支不被钳制为100%', () => {
    expect(computeBudgetProgress(67.23, 2250)).toEqual({
      used: 67.23, netInflow: 0, progress: 67.23 / 2250, percentage: 3, budgetUnavailable: false,
    })
    expect(computeBudgetProgress(150, 100)).toEqual({
      used: 150, netInflow: 0, progress: 1.5, percentage: 150, budgetUnavailable: false,
    })
  })

  it('收支抵消后金额与比例均为0，不制造负零', () => {
    const result = computeBudgetProgress(-0.00000001, 100)
    expect(result).toEqual({ used: 0, netInflow: 0, progress: 0, percentage: 0, budgetUnavailable: false })
    expect(Object.is(result.used, -0)).toBe(false)
    expect(Object.is(result.netInflow, -0)).toBe(false)
  })

  it.each([0, -100])('预算为%s时明确标识暂无额度，不产生负比例、Infinity或NaN', (budget) => {
    const result = computeBudgetProgress(50, budget)
    expect(result).toEqual({ used: 50, netInflow: 0, progress: 0, percentage: 0, budgetUnavailable: true })
    expect(Number.isFinite(result.progress)).toBe(true)
  })

  it('无日常额度时也保留净入账，用于解释剩余预算增加', () => {
    expect(computeBudgetProgress(-10, 0)).toEqual({
      used: 0, netInflow: 10, progress: 0, percentage: 0, budgetUnavailable: true,
    })
  })

  it('输出金额按分四舍五入，但百分比以金额精度计算', () => {
    const result = computeBudgetProgress(0.1 + 0.2, 0.3)
    expect(result.used).toBe(0.3)
    expect(result.percentage).toBe(100)
    expect(result.progress).toBe(1)
  })
})
