import { describe, expect, it } from 'vitest'
import { round2 } from '../lib/dates'
import { computeBudgetState } from './engine'
import type { BudgetEvent, EngineTx, TxType } from './types'

const ev = (at: string, over: Partial<BudgetEvent> = {}): BudgetEvent => ({
  id: `ev-${at}-${over.mode ?? 'month'}-${over.monthBudget ?? 3000}`,
  at,
  mode: 'month',
  monthBudget: 3000,
  weekBudgetOverride: null,
  cycleStartDay: 1,
  weekStartsOn: 1,
  ...over,
})

const tx = (
  occurredAt: string,
  amount: number,
  over: Partial<EngineTx> & { type?: TxType } = {},
): EngineTx => ({
  id: `tx-${occurredAt}-${amount}-${over.type ?? 'expense'}`,
  type: 'expense',
  amount,
  occurredAt,
  status: 'confirmed',
  ...over,
})

const run = (
  events: BudgetEvent[],
  transactions: EngineTx[],
  today: string,
  carryoverAcrossPeriod = false,
) => computeBudgetState({ events, transactions, today, carryoverAcrossPeriod })

const OCT_3100 = [ev('2026-10-01', { monthBudget: 3100 })]

describe('computeBudgetState 月模式·每日 100 元（3100/31）', () => {
  it('无消费：可花额逐日累计，未来投影全期间', () => {
    const s = run(OCT_3100, [], '2026-10-03')
    expect(s.periodStart).toBe('2026-10-01')
    expect(s.periodEnd).toBe('2026-10-31')
    expect(s.periodBudget).toBe(3100)
    expect(s.baseToday).toBe(100)
    expect(s.pool).toBe(200)
    expect(s.availableToday).toBe(300)
    expect(s.remainingInPeriod).toBe(3100)
    expect(s.days).toHaveLength(31)
    expect(s.days[0].available).toBe(100)
    expect(s.days[2].available).toBe(300)
    expect(s.days[3]).toMatchObject({ date: '2026-10-04', available: 400, spent: 0 })
    expect(s.days[30].available).toBe(3100)
  })

  it('第一天花 80 → 次日可花 120，当天剩余 20', () => {
    const s = run(OCT_3100, [tx('2026-10-01', 80)], '2026-10-02')
    expect(s.pool).toBe(20)
    expect(s.availableToday).toBe(120)
    expect(s.spentInPeriod).toBe(80)
    expect(s.remainingInPeriod).toBe(3020)
    expect(s.days[0].available).toBe(20)
  })

  it('第一天花 150 → 次日可花 50（超支负结转）', () => {
    const s = run(OCT_3100, [tx('2026-10-01', 150)], '2026-10-02')
    expect(s.pool).toBe(-50)
    expect(s.availableToday).toBe(50)
    expect(s.remainingInPeriod).toBe(2950)
  })

  it('连续超支后每日扣回，期间剩余始终 = 预算 − 已花', () => {
    const s = run(
      OCT_3100,
      [tx('2026-10-01', 150), tx('2026-10-02', 150)],
      '2026-10-03',
    )
    // 截至昨日已发放 200、已花 300 → pool −100，今日可花 0
    expect(s.availableToday).toBe(0)
    expect(s.remainingInPeriod).toBe(2800)
  })

  it('退款冲减已花并回补可花额', () => {
    const s = run(
      OCT_3100,
      [tx('2026-10-01', 150), tx('2026-10-02', 50, { type: 'refund' })],
      '2026-10-02',
    )
    expect(s.spentInPeriod).toBe(100)
    // 今日额度 50（池 −50 + 基础 100），当日退款 +50 → 今日可花 100
    expect(s.availableToday).toBe(100)
    expect(s.remainingInPeriod).toBe(3000)
  })

  it('未确认（pending）交易不计入', () => {
    const s = run(
      OCT_3100,
      [tx('2026-10-01', 999, { status: 'pending' })],
      '2026-10-02',
    )
    expect(s.spentInPeriod).toBe(0)
    expect(s.availableToday).toBe(200)
  })

  it('浮点金额精确到分（当日消费立即扣减今日可花）', () => {
    const s = run(OCT_3100, [tx('2026-10-01', 0.1), tx('2026-10-01', 0.2)], '2026-10-01')
    expect(s.spentInPeriod).toBe(0.3)
    expect(s.availableToday).toBe(99.7)
    expect(s.days[0].available).toBe(99.7)
  })

  it('今日消费实时压低今天与之后每天的可花额', () => {
    const withSpend = run(OCT_3100, [tx('2026-10-04', 50)], '2026-10-04')
    const withoutSpend = run(OCT_3100, [], '2026-10-04')
    expect(withoutSpend.availableToday).toBe(400)
    expect(withoutSpend.days[4].available).toBe(500)
    expect(withSpend.availableToday).toBe(350)
    expect(withSpend.days[3].available).toBe(350)
    expect(withSpend.days[4].available).toBe(450)
    expect(withSpend.days[30].available).toBe(3050)
  })

  it('今日超支为负值，日历今日为负、之后每天同步扣回', () => {
    const s = run(OCT_3100, [tx('2026-10-01', 150)], '2026-10-01')
    expect(s.availableToday).toBe(-50)
    expect(s.days[0].available).toBe(-50)
    expect(s.days[1].available).toBe(50)
    expect(s.remainingInPeriod).toBe(2950)
  })
})

describe('computeBudgetState 预算调整', () => {
  it('中期提高预算：B′ =（新预算 − 已发放）÷ 剩余天数', () => {
    const events = [
      ev('2026-10-01', { monthBudget: 3100 }),
      ev('2026-10-11', { monthBudget: 6200 }),
    ]
    const txs = Array.from({ length: 10 }, (_, i) => tx(`2026-10-${String(i + 1).padStart(2, '0')}`, 80))
    const s = run(events, txs, '2026-10-11')
    // 前 10 天各发 100，已发 1000，已花 800，pool 200
    // 剩余 21 天，B′ = 5200/21 = 247.62
    expect(s.baseToday).toBeCloseTo(247.62, 2)
    expect(s.pool).toBe(200)
    expect(s.availableToday).toBeCloseTo(447.62, 2)
    expect(s.remainingInPeriod).toBe(5400)
  })

  it('中期降低预算（低于已发放）：允许负基础额，总额对齐', () => {
    const events = [
      ev('2026-10-01', { monthBudget: 3100 }),
      ev('2026-10-05', { monthBudget: 1550 }),
    ]
    const txs = [
      tx('2026-10-01', 200),
      tx('2026-10-02', 200),
      tx('2026-10-03', 200),
      tx('2026-10-04', 200),
    ]
    const s = run(events, txs, '2026-10-05')
    // 已发 400，已花 800 → pool −400；B′ = (1550−400)/27 = 42.59
    expect(s.baseToday).toBeCloseTo(42.59, 2)
    expect(s.pool).toBe(-400)
    expect(s.availableToday).toBeCloseTo(-357.41, 2)
    expect(s.remainingInPeriod).toBe(750)
  })
})

describe('computeBudgetState 跨期与模式', () => {
  it('自然跨月：默认清零（11 月 30 天，日额 3100/30）', () => {
    const s = run(OCT_3100, [], '2026-11-02')
    expect(s.periodStart).toBe('2026-11-01')
    expect(s.pool).toBeCloseTo(103.33, 2)
    expect(s.availableToday).toBeCloseTo(206.67, 2)
    expect(s.remainingInPeriod).toBe(3100)
  })

  it('自然跨月：开启跨期结转则带入', () => {
    const s = run(OCT_3100, [], '2026-11-02', true)
    expect(s.availableToday).toBeCloseTo(3306.67, 2)
  })

  it('自定义起始日 25：期间与日额正确', () => {
    const s = run([ev('2026-01-01', { cycleStartDay: 25, monthBudget: 3000 })], [], '2026-01-26')
    expect(s.periodStart).toBe('2026-01-25')
    expect(s.periodEnd).toBe('2026-02-24')
    expect(s.baseToday).toBeCloseTo(96.77, 2)
    expect(s.availableToday).toBeCloseTo(193.55, 2)
  })

  it('模式切换：从切换日开新期间，结转池保留', () => {
    const events = [
      ev('2026-10-01', { monthBudget: 3100 }),
      ev('2026-10-10', { mode: 'week', monthBudget: 3100 }),
    ]
    const s = run(events, [], '2026-10-10')
    expect(s.mode).toBe('week')
    expect(s.periodStart).toBe('2026-10-10')
    expect(s.periodEnd).toBe('2026-10-16')
    // 前 9 天共发放 900，无消费；周预算 = 3100×7/31 = 700，日额 100
    expect(s.pool).toBe(900)
    expect(s.availableToday).toBe(1000)
  })
})

describe('computeBudgetState 周模式', () => {
  const weekEvents = [
    ev('2026-09-28', { mode: 'week', monthBudget: 3100, weekStartsOn: 1 }),
  ]

  it('周模式·周内结转（自动周预算按周起始日所在月折算：3100×7/30）', () => {
    const s = run(weekEvents, [tx('2026-09-28', 150)], '2026-09-29')
    expect(s.periodStart).toBe('2026-09-28')
    expect(s.periodEnd).toBe('2026-10-04')
    expect(s.baseToday).toBeCloseTo(103.33, 2)
    expect(s.availableToday).toBeCloseTo(56.67, 2)
  })

  it('周与周之间默认清零', () => {
    const s = run(weekEvents, [], '2026-10-05')
    expect(s.periodStart).toBe('2026-10-05')
    expect(s.availableToday).toBe(100)
  })

  it('开启跨期结转时周与周带入', () => {
    const s = run(weekEvents, [], '2026-10-05', true)
    // 上一周（9/28 起）自动周预算 723.33 全部结转到本周，今日 = 723.33 + 100
    expect(s.availableToday).toBeCloseTo(823.33, 2)
  })

  it('手改周覆盖额度优先于自动折算', () => {
    const events = [
      ev('2026-09-28', { mode: 'week', monthBudget: 3100, weekBudgetOverride: 1400, weekStartsOn: 1 }),
    ]
    const s = run(events, [], '2026-09-29')
    expect(s.baseToday).toBe(200)
    expect(s.availableToday).toBe(400)
  })
})

describe('computeBudgetState 单独某天的预算', () => {
  it('单独设某天预算后其他天自动重算，全期发放总额仍对齐预算', () => {
    const s = computeBudgetState({
      events: OCT_3100,
      transactions: [],
      today: '2026-10-03',
      carryoverAcrossPeriod: false,
      overrides: [{ date: '2026-10-10', amount: 500 }],
    })
    // 其余 30 天每天 = (3100 − 500) / 30 = 86.67
    expect(s.days[0].base).toBeCloseTo(86.67, 2)
    expect(s.days[0].isOverride).toBe(false)
    const oct10 = s.days.find((d) => d.date === '2026-10-10')
    expect(oct10?.isOverride).toBe(true)
    expect(oct10?.base).toBe(500)
    // 无消费投影：期末累计可花 = 预算总额
    expect(s.days[s.days.length - 1].available).toBeCloseTo(3100, 1)
    expect(s.overridesFeasible).toBe(true)
  })

  it('今天的单独预算立即生效且不受结转池拖累', () => {
    const s = computeBudgetState({
      events: OCT_3100,
      transactions: [tx('2026-10-02', 10)],
      today: '2026-10-03',
      carryoverAcrossPeriod: false,
      overrides: [{ date: '2026-10-03', amount: 200 }],
    })
    expect(s.baseToday).toBe(200)
    // 单独预算当天显示设定金额 − 当日已花 = 200；差额由其他天重算吸收
    expect(s.availableToday).toBe(200)
    expect(s.days.find((d) => d.date === '2026-10-03')?.available).toBe(200)
  })

  it('回归：已超支后给未来某天设预算，该天显示设定金额而不是负数（实测数据场景）', () => {
    const s = computeBudgetState({
      events: [ev('2026-10-04', { monthBudget: 3000 })],
      transactions: [tx('2026-10-04', 100), tx('2026-10-04', 500)],
      today: '2026-10-04',
      carryoverAcrossPeriod: false,
      overrides: [
        { date: '2026-10-07', amount: 100 },
        { date: '2026-10-08', amount: 50 },
      ],
    })
    expect(s.days.find((d) => d.date === '2026-10-07')?.available).toBe(100)
    expect(s.days.find((d) => d.date === '2026-10-08')?.available).toBe(50)
    // 今日（10-04）未单独设置：超支仍然如实显示为负
    expect(s.availableToday).toBeCloseTo(-490.38, 1)
  })

  it('预算中途减少导致其他天被压成负数：overridesFeasible=false 但仍可计算（允许超支）', () => {
    const events = [
      ev('2026-10-01', { monthBudget: 3100 }),
      ev('2026-10-03', { monthBudget: 1000 }),
    ]
    const s = computeBudgetState({
      events,
      transactions: [],
      today: '2026-10-03',
      carryoverAcrossPeriod: false,
      overrides: [{ date: '2026-10-10', amount: 3000 }],
    })
    expect(s.overridesFeasible).toBe(false)
    expect(s.days).toHaveLength(31)
    const oct11 = s.days.find((d) => d.date === '2026-10-11')
    expect(oct11?.base).toBeLessThan(0)
  })

  it('期间之外的单独预算被忽略', () => {
    const s = computeBudgetState({
      events: OCT_3100,
      transactions: [],
      today: '2026-10-03',
      carryoverAcrossPeriod: false,
      overrides: [{ date: '2026-11-20', amount: 9999 }],
    })
    expect(s.overridesFeasible).toBe(true)
    expect(s.days[0].base).toBeCloseTo(100, 2)
  })
})

describe('computeBudgetState 边界', () => {
  it('无事件时返回零状态而不崩溃', () => {
    const s = run([], [], '2026-10-04')
    expect(s.periodBudget).toBe(0)
    expect(s.availableToday).toBe(0)
  })

  it('未来事件不影响今天', () => {
    const events = [
      ev('2026-10-01', { monthBudget: 3100 }),
      ev('2026-11-01', { monthBudget: 99999 }),
    ]
    const s = run(events, [], '2026-10-04')
    expect(s.periodBudget).toBe(3100)
    expect(s.baseToday).toBe(100)
  })

  it('当日多次事件以最后一条为准（B′ 按新预算 − 已发放重算）', () => {
    const events = [
      ev('2026-10-01', { monthBudget: 3100 }),
      ev('2026-10-03', { monthBudget: 6200 }),
      ev('2026-10-03', { monthBudget: 9300 }),
    ]
    const s = run(events, [], '2026-10-03')
    expect(s.periodBudget).toBe(9300)
    // 已发放 200，剩余 29 天：B′ = 9100/29 = 313.79
    expect(s.baseToday).toBeCloseTo(313.79, 2)
    expect(s.pool).toBe(200)
  })

  it('所有输出金额均经 round2', () => {
    const s = run([ev('2026-10-01', { monthBudget: 1000 })], [tx('2026-10-01', 33.33)], '2026-10-02')
    expect(s.availableToday).toBe(round2(2 * (1000 / 31) - 33.33))
    expect(Number.isInteger(Math.round(s.availableToday * 100))).toBe(true)
  })
})

describe('固定支出预留从当期总预算扣除', () => {
  const withReserve = (amount: number, today = '2026-10-03') =>
    computeBudgetState({
      events: OCT_3100,
      transactions: [],
      today,
      carryoverAcrossPeriod: false,
      fixedReserve: { periodStart: '2026-10-01', amount },
    })

  it('月预算 3100 预留 620 → 有效预算 2480，每日发放按 80 重算', () => {
    const s = withReserve(620)
    expect(s.periodBudget).toBe(2480)
    expect(s.baseToday).toBe(80)
    expect(s.availableToday).toBe(240)
    expect(s.remainingInPeriod).toBe(2480)
    expect(s.days[30].available).toBe(2480)
  })

  it('预留只作用于匹配的期间，不影响其他期间', () => {
    const s = computeBudgetState({
      events: OCT_3100,
      transactions: [],
      today: '2026-10-03',
      carryoverAcrossPeriod: false,
      fixedReserve: { periodStart: '2026-09-01', amount: 620 },
    })
    expect(s.periodBudget).toBe(3100)
    expect(s.baseToday).toBe(100)
  })

  it('预留随消费与单独预算一起参与重算', () => {
    const s = computeBudgetState({
      events: OCT_3100,
      transactions: [tx('2026-10-01', 80)],
      today: '2026-10-02',
      carryoverAcrossPeriod: false,
      fixedReserve: { periodStart: '2026-10-01', amount: 620 },
    })
    // 有效预算 2480，每日 80；第一天花 80 → 次日可花 80
    expect(s.availableToday).toBe(80)
    expect(s.remainingInPeriod).toBe(2400)
  })

  it('预留超过当期预算时每日额度被压负并标记不可行', () => {
    const s = withReserve(5000)
    expect(s.periodBudget).toBe(-1900)
    expect(s.overridesFeasible).toBe(false)
  })

  it('周模式同样从当周预算扣除', () => {
    const s = computeBudgetState({
      events: [ev('2026-10-05', { mode: 'week', monthBudget: 0, weekBudgetOverride: 700 })],
      transactions: [],
      today: '2026-10-05',
      carryoverAcrossPeriod: false,
      fixedReserve: { periodStart: '2026-10-05', amount: 350 },
    })
    expect(s.periodBudget).toBe(350)
    expect(s.baseToday).toBe(50)
    expect(s.days).toHaveLength(7)
    expect(s.days[6].available).toBe(350)
  })
})
