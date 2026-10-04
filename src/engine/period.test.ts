import { describe, expect, it } from 'vitest'
import { autoWeekBudget, effectiveConfig, resolvePeriod } from './period'
import type { BudgetEvent } from './types'

const baseEvent = (over: Partial<BudgetEvent> = {}): BudgetEvent => ({
  id: 'e1',
  at: '2026-01-01',
  mode: 'month',
  monthBudget: 3000,
  weekBudgetOverride: null,
  cycleStartDay: 1,
  weekStartsOn: 1,
  ...over,
})

describe('resolvePeriod 月模式', () => {
  it('起始日 1 号', () => {
    const p = resolvePeriod('2026-10-04', 'month', 1, 1)
    expect(p.start).toBe('2026-10-01')
    expect(p.end).toBe('2026-10-31')
    expect(p.days).toBe(31)
  })

  it('起始日 25 号：1 月 26 日属于 1/25–2/24', () => {
    const p = resolvePeriod('2026-01-26', 'month', 25, 1)
    expect(p.start).toBe('2026-01-25')
    expect(p.end).toBe('2026-02-24')
    expect(p.days).toBe(31)
  })

  it('起始日 25 号：1 月 10 日属于 12/25–1/24', () => {
    const p = resolvePeriod('2026-01-10', 'month', 25, 1)
    expect(p.start).toBe('2025-12-25')
    expect(p.end).toBe('2026-01-24')
  })
})

describe('resolvePeriod 周模式', () => {
  it('周一起始（10/4 是周日）', () => {
    const p = resolvePeriod('2026-10-04', 'week', 1, 1)
    expect(p.start).toBe('2026-09-28')
    expect(p.end).toBe('2026-10-04')
    expect(p.days).toBe(7)
  })

  it('周日起始', () => {
    const p = resolvePeriod('2026-10-04', 'week', 1, 7)
    expect(p.start).toBe('2026-10-04')
    expect(p.end).toBe('2026-10-10')
  })
})

describe('autoWeekBudget', () => {
  it('月预算按当月天数折算 7 天并四舍五入到分', () => {
    expect(autoWeekBudget(3100, '2026-10-04')).toBe(700)
    expect(autoWeekBudget(3000, '2026-10-04')).toBe(677.42)
  })
})

describe('effectiveConfig', () => {
  it('取最后一个不晚于该日的事件', () => {
    const events = [
      baseEvent({ id: 'a', at: '2026-01-01' }),
      baseEvent({ id: 'b', at: '2026-03-01', monthBudget: 5000 }),
      baseEvent({ id: 'c', at: '2026-06-01', monthBudget: 9000 }),
    ]
    expect(effectiveConfig(events, '2026-05-31')?.monthBudget).toBe(5000)
    expect(effectiveConfig(events, '2026-06-01')?.monthBudget).toBe(9000)
    expect(effectiveConfig(events, '2025-12-31')).toBeNull()
  })
})
