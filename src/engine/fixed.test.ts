import { describe, expect, it } from 'vitest'
import { computeBudgetState } from './engine'
import { computeReserve, fixedBudgetTransactions, type RecurringBill } from './reserve'
import type { BudgetEvent } from './types'

const bills: RecurringBill[] = [
  { id: 1, name: '房租', amount: 800, dueDay: 5, remindDaysBefore: 3, categoryId: null, active: true },
  { id: 2, name: '水费', amount: 50, dueDay: 5, remindDaysBefore: 3, categoryId: null, active: true },
]
const expense = (id: number, amount: number, occurredAt = '2026-10-05') =>
  ({ id, amount, occurredAt, type: 'expense' as const, status: 'confirmed' as const })
const allocation = (id: number, transactionId: number, billId: number, amount: number, periodKey = '2026-10-05') =>
  ({ id, transactionId, billId, amount, periodKey })
const event: BudgetEvent = { id: '1', at: '2026-10-01', mode: 'month', monthBudget: 3100,
  weekBudgetOverride: null, cycleStartDay: 1, weekStartsOn: 1 }
const start = '2026-10-01', end = '2026-10-31', today = '2026-10-05'

describe('固定分摊的现金预算守恒', () => {
  it('900元原流水分摊800租+50水，日常只计50且保留原金额', () => {
    const txs = [expense(1, 900)]
    const allocations = [allocation(1, 1, 1, 800), allocation(2, 1, 2, 50)]
    const reserve = computeReserve(bills, [], start, end, today, { allocations, transactions: txs })
    const transactions = fixedBudgetTransactions(txs, allocations, start, today)
    const state = computeBudgetState({ events: [event], transactions, today, carryoverAcrossPeriod: false,
      fixedReserve: { periodStart: start, amount: reserve.reserved } })
    expect(reserve.reserved).toBe(850)
    expect(reserve.upcoming.every(b => b.paid)).toBe(true)
    expect(state.spentInPeriod).toBe(50)
    expect(state.remainingInPeriod).toBe(2200)
    expect(txs[0].amount).toBe(900)
  })
  it('分次支付和0.1+0.2按分计算；只付部分仍预留余额', () => {
    const txs = [expense(1, 400), expense(2, 200)]
    const allocations = [allocation(1, 1, 1, 400), allocation(2, 2, 1, 200)]
    const r = computeReserve(bills.slice(0, 1), [], start, end, today, { allocations, transactions: txs })
    expect(r.reserved).toBe(800)
    expect(r.upcoming[0]).toMatchObject({ paid: false, paidAmount: 600, remainingAmount: 200 })
    const tiny = computeReserve([{ ...bills[0], amount: 0.3 }], [], start, end, today,
      { transactions: [expense(1, 0.1), expense(2, 0.2)], allocations: [allocation(1, 1, 1, 0.1), allocation(2, 2, 1, 0.2)] })
    expect(tiny.reserved).toBe(0.3)
    expect(tiny.upcoming[0].paidAmount).toBe(0.3)
  })
  it('超计划部分提升实际固定预留；不赠送预算', () => {
    const r = computeReserve(bills.slice(0, 1), [], start, end, today,
      { transactions: [expense(1, 1000)], allocations: [allocation(1, 1, 1, 1000)] })
    expect(r.reserved).toBe(1000)
    expect(r.upcoming[0].remainingAmount).toBe(0)
  })
  it('上月提前支付本月房租，本月不重复预留，历史原流水不被减掉', () => {
    const txs = [expense(1, 800, '2026-09-30')]
    const allocations = [allocation(1, 1, 1, 800)]
    const r = computeReserve(bills.slice(0, 1), [], start, end, today, { transactions: txs, allocations })
    expect(r.reserved).toBe(0)
    expect(fixedBudgetTransactions(txs, allocations, start, today)[0].amount).toBe(800)
  })
  it('退款分摊恢复未付余额，不双补日常；停用账单只保留实际付款', () => {
    const txs = [expense(1, 900), { ...expense(2, 150), type: 'refund' as const }]
    const allocations = [allocation(1, 1, 1, 800), allocation(2, 2, 1, 100)]
    const r = computeReserve(bills.slice(0, 1), [], start, end, today, { transactions: txs, allocations })
    expect(r.reserved).toBe(800)
    expect(r.upcoming[0]).toMatchObject({ paidAmount: 700, remainingAmount: 100, paid: false })
    expect(fixedBudgetTransactions(txs, allocations, start, today).map(t => t.amount)).toEqual([100, 50])
    expect(computeReserve([{ ...bills[0], active: false }], [], start, end, today, { transactions: txs, allocations }).reserved).toBe(700)
  })
  it('退上月固定支付时允许负预留并归还本期额度', () => {
    const txs = [expense(1, 800, '2026-09-10'), { ...expense(2, 100), type: 'refund' as const }]
    const allocations = [allocation(1, 1, 1, 800, '2026-09-05'), allocation(2, 2, 1, 100, '2026-09-05')]
    const r = computeReserve([{ ...bills[0], active: false }], [], start, end, today, { transactions: txs, allocations })
    expect(r.reserved).toBe(-100)
    const state = computeBudgetState({ events: [event], today, carryoverAcrossPeriod: false,
      transactions: fixedBudgetTransactions(txs, allocations, start, today), fixedReserve: { periodStart: start, amount: r.reserved } })
    expect(state.periodBudget).toBe(3200)
    expect(state.spentInPeriod).toBe(0)
  })
  it('未来和待确认交易不能提前释放预留', () => {
    const txs = [expense(1, 800, '2026-10-06'), { ...expense(2, 800), status: 'pending' as const }]
    const allocations = [allocation(1, 1, 1, 800), allocation(2, 2, 1, 800)]
    const r = computeReserve(bills.slice(0, 1), [], start, end, today, { transactions: txs, allocations })
    expect(r.reserved).toBe(800)
    expect(r.upcoming[0].paidAmount).toBe(0)
  })
  it('自然跨月结转不因历史固定分摊产生免费余额', () => {
    const txs = [expense(1, 800, '2026-09-05'), expense(2, 800)]
    const allocations = [allocation(1, 1, 1, 800, '2026-09-05'), allocation(2, 2, 1, 800)]
    const r = computeReserve(bills.slice(0, 1), [], start, end, today, { transactions: txs, allocations })
    const state = computeBudgetState({ events: [{ ...event, at: '2026-09-01' }], today, carryoverAcrossPeriod: true,
      transactions: fixedBudgetTransactions(txs, allocations, start, today), fixedReserve: { periodStart: start, amount: r.reserved } })
    expect(state.availableToday).toBe(2670.97)
    expect(state.spentInPeriod).toBe(0)
  })
  it('模式切换后，旧期间固定流水保持原现金扣款', () => {
    const events = [event, { ...event, id: '2', at: '2026-10-05', mode: 'week' as const, weekBudgetOverride: 700 }]
    const txs = [expense(1, 800, '2026-10-04')]
    const allocations = [allocation(1, 1, 1, 800)]
    const base = computeBudgetState({ events, transactions: txs.map(t => ({ ...t, id: String(t.id) })), today, carryoverAcrossPeriod: true })
    const r = computeReserve(bills.slice(0, 1), [], base.periodStart, base.periodEnd, today, { transactions: txs, allocations })
    const state = computeBudgetState({ events, today, carryoverAcrossPeriod: true,
      transactions: fixedBudgetTransactions(txs, allocations, base.periodStart, today),
      fixedReserve: { periodStart: base.periodStart, amount: r.reserved } })
    expect(r.reserved).toBe(0)
    expect(state.availableToday).toBe(base.availableToday)
  })
})
