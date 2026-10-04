import { describe, expect, it } from 'vitest'
import { computeReserve, type BillPayment, type RecurringBill } from './reserve'

const bill = (over: Partial<RecurringBill> = {}): RecurringBill => ({
  id: 1,
  name: '房租',
  amount: 3000,
  categoryId: 10,
  dueDay: 15,
  remindDaysBefore: 3,
  active: true,
  ...over,
})

const payment = (over: Partial<BillPayment> = {}): BillPayment => ({
  id: 1,
  billId: 1,
  periodKey: '2026-10-15',
  paidAt: '2026-10-15',
  transactionId: 1,
  ...over,
})

describe('computeReserve', () => {
  it('本期内未支付的固定支出计入预留', () => {
    const r = computeReserve([bill()], [], '2026-10-01', '2026-10-31', '2026-10-12')
    expect(r.reserved).toBe(3000)
    expect(r.upcoming).toHaveLength(1)
    expect(r.upcoming[0]).toMatchObject({
      billId: 1,
      name: '房租',
      amount: 3000,
      dueDate: '2026-10-15',
      paid: false,
      dueSoon: true,
    })
  })

  it('已支付（periodKey = 到期日）不计入', () => {
    const r = computeReserve([bill()], [payment()], '2026-10-01', '2026-10-31', '2026-10-10')
    expect(r.reserved).toBe(0)
    expect(r.upcoming[0].paid).toBe(true)
  })

  it('已过期未支付仍计入且不标记 dueSoon', () => {
    const r = computeReserve(
      [bill({ dueDay: 5 })],
      [],
      '2026-10-01',
      '2026-10-31',
      '2026-10-10',
    )
    expect(r.reserved).toBe(3000)
    expect(r.upcoming[0].dueSoon).toBe(false)
  })

  it('dueDay=31 在小月钳制到月末', () => {
    const r = computeReserve(
      [bill({ dueDay: 31 })],
      [],
      '2027-02-01',
      '2027-02-28',
      '2027-02-01',
    )
    expect(r.upcoming[0].dueDate).toBe('2027-02-28')
  })

  it('期间外的到期日不计入', () => {
    const r = computeReserve([bill()], [], '2026-10-08', '2026-10-14', '2026-10-08')
    expect(r.reserved).toBe(0)
    expect(r.upcoming).toHaveLength(0)
  })

  it('非激活账单不计入', () => {
    const r = computeReserve(
      [bill({ active: false })],
      [],
      '2026-10-01',
      '2026-10-31',
      '2026-10-10',
    )
    expect(r.reserved).toBe(0)
  })

  it('自定义起始日跨月期间取所在月的到期日（1/25–2/24 的 5 号）', () => {
    const r = computeReserve(
      [bill({ dueDay: 5, amount: 200 })],
      [],
      '2026-01-25',
      '2026-02-24',
      '2026-01-26',
    )
    expect(r.reserved).toBe(200)
    expect(r.upcoming[0].dueDate).toBe('2026-02-05')
  })

  it('多张账单金额合计与提醒窗口', () => {
    const bills = [
      bill({ id: 1, dueDay: 15, amount: 3000, remindDaysBefore: 1 }),
      bill({ id: 2, name: '会员', dueDay: 20, amount: 25, remindDaysBefore: 10 }),
    ]
    const r = computeReserve(bills, [], '2026-10-01', '2026-10-31', '2026-10-10')
    expect(r.reserved).toBe(3025)
    expect(r.upcoming.map((u) => u.dueSoon)).toEqual([false, true])
  })

  it('金额经 round2', () => {
    const r = computeReserve(
      [bill({ amount: 0.1 }), bill({ id: 2, amount: 0.2, dueDay: 16 })],
      [],
      '2026-10-01',
      '2026-10-31',
      '2026-10-10',
    )
    expect(r.reserved).toBe(0.3)
  })
})
