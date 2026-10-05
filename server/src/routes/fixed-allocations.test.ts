// @vitest-environment node
import type { FastifyInstance } from 'fastify'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../app.ts'
import { createDb } from '../db/client.ts'
import { runMigrations } from '../db/migrate.ts'
import { env } from '../env.ts'
import { prehashPassword } from '../util/password.ts'

let app: FastifyInstance
let pool: ReturnType<typeof createDb>['pool']
let token = ''
let other = ''
const auth = (value = token) => ({ authorization: `Bearer ${value}` })
const periodKey = '2026-10-05'
const bill = async (name: string, amount: number) => {
  const response = await app.inject({ method: 'POST', url: '/api/bills', headers: auth(), payload: { name, amount, dueDay: 5 } })
  expect(response.statusCode).toBe(201)
  return response.json().bill.id as number
}
const transaction = async (amount: number, type = 'expense', status = 'confirmed') => {
  const response = await app.inject({ method: 'POST', url: '/api/transactions', headers: auth(), payload: { amount, type, status, occurredAt: '2026-10-05', merchant: '原始银行流水', occurredTime: '12:34:56' } })
  expect(response.statusCode).toBe(201)
  return response.json().transaction.id as number
}
const allocate = (id: number, allocations: Array<{ billId: number; periodKey: string; amount: number }>, value = token) =>
  app.inject({ method: 'PUT', url: `/api/transactions/${id}/fixed-allocations`, headers: auth(value), payload: { allocations } })
const list = async () => (await app.inject({ method: 'GET', url: '/api/bills', headers: auth() })).json()
const row = (billId: number, amount: number, date = periodKey) => ({ billId, periodKey: date, amount })

beforeAll(async () => {
  const connection = createDb(env.testDatabaseUrl)
  pool = connection.pool
  await runMigrations(connection.db)
  await pool.query('SET FOREIGN_KEY_CHECKS=0')
  for (const table of ['bill_allocations', 'email_receipts', 'bill_payments', 'transactions', 'bills', 'budget_events', 'day_overrides', 'categories', 'settings', 'users']) {
    // Before implementation, the red test also runs against the old schema.
    const [tables] = await pool.query('SHOW TABLES LIKE ?', [table])
    if ((tables as unknown[]).length) await pool.query(`TRUNCATE TABLE \`${table}\``)
  }
  await pool.query('SET FOREIGN_KEY_CHECKS=1')
  app = await buildApp({ databaseUrl: env.testDatabaseUrl, jwtSecret: env.jwtSecret, allowRegistration: true })
  await app.ready()
  for (const username of ['fixed_owner', 'fixed_other']) {
    const response = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: prehashPassword('SyntheticTestOnly123') } })
    if (username === 'fixed_owner') token = response.json().token
    else other = response.json().token
  }
})
afterAll(async () => { await app?.close(); await pool?.end() })

describe('已有流水分摊固定支出', () => {
  it('一笔支付可拆给房租、水费；流水金额、商家和秒级时间原样保留', async () => {
    const rent = await bill('分摊房租', 800)
    const water = await bill('分摊水费', 50)
    const id = await transaction(880)
    const response = await allocate(id, [row(rent, 800), row(water, 50)])
    expect(response.statusCode).toBe(200)
    expect(response.json().allocations.map((value: { amount: number }) => value.amount)).toEqual([800, 50])
    const data = await list()
    expect(data.allocations.filter((value: { transactionId: number }) => value.transactionId === id)).toHaveLength(2)
    const original = (await app.inject({ method: 'GET', url: '/api/transactions', headers: auth() })).json().transactions.find((value: { id: number }) => value.id === id)
    expect(original).toMatchObject({ amount: 880, merchant: '原始银行流水', occurredTime: '12:34:56' })
    const otherList = (await app.inject({ method: 'GET', url: '/api/bills', headers: auth(other) })).json()
    expect(otherList.allocations).toEqual([])
  })

  it('同一账单允许多次付款、超过计划金额和不同到期月份', async () => {
    const id = await bill('多次交租', 800)
    expect((await allocate(await transaction(400), [row(id, 400)])).statusCode).toBe(200)
    expect((await allocate(await transaction(450), [row(id, 450)])).statusCode).toBe(200)
    expect((await allocate(await transaction(800), [row(id, 800, '2026-11-05')])).statusCode).toBe(200)
  })

  it('拒绝超过原流水、重复账单日期、不足一分和多于两位小数；失败不覆盖旧分摊', async () => {
    const billId = await bill('金额检查', 800)
    const id = await transaction(100)
    expect((await allocate(id, [row(billId, 50)])).statusCode).toBe(200)
    for (const values of [[row(billId, 100.01)], [row(billId, 20), row(billId, 20)], [row(billId, 0)], [row(billId, 0.001)], [row(billId, 1.234)]]) {
      expect((await allocate(id, values)).statusCode).toBe(400)
    }
    expect((await list()).allocations.find((value: { transactionId: number }) => value.transactionId === id).amount).toBe(50)
    expect((await allocate(id, [row(billId, 10, '2026-02-30')])).statusCode).toBe(400)
  })

  it('pending 流水拒绝分摊，越权与不存在的账单或交易返回 404', async () => {
    const billId = await bill('归属检查', 10)
    const id = await transaction(10)
    expect((await allocate(await transaction(10, 'expense', 'pending'), [row(billId, 10)])).statusCode).toBe(409)
    expect((await allocate(id, [row(billId, 10)], other)).statusCode).toBe(404)
    expect((await allocate(id, [row(9999999, 10)])).statusCode).toBe(404)
    const otherTransaction = await app.inject({ method: 'POST', url: '/api/transactions', headers: auth(other), payload: { type: 'expense', amount: 10, occurredAt: '2026-10-05' } })
    expect((await allocate(otherTransaction.json().transaction.id, [row(billId, 10)])).statusCode).toBe(404)
  })

  it('退款不能超过同账单期次的已付未退；原付款撤销或删除要先撤销退款分摊', async () => {
    const billId = await bill('退款房租', 800)
    const expense = await transaction(800)
    const refund = await transaction(300, 'refund')
    expect((await allocate(refund, [row(billId, 300)])).statusCode).toBe(409)
    expect((await allocate(expense, [row(billId, 800)])).statusCode).toBe(200)
    expect((await allocate(refund, [row(billId, 300)])).statusCode).toBe(200)
    expect((await allocate(await transaction(600, 'refund'), [row(billId, 600)])).statusCode).toBe(409)
    expect((await allocate(expense, [])).statusCode).toBe(409)
    expect((await app.inject({ method: 'DELETE', url: `/api/transactions/${expense}`, headers: auth() })).statusCode).toBe(409)
    expect((await allocate(expense, [row(billId, 200)])).statusCode).toBe(409)
    expect((await allocate(refund, [])).statusCode).toBe(200)
    expect((await allocate(expense, [])).statusCode).toBe(200)
    expect((await app.inject({ method: 'DELETE', url: `/api/transactions/${expense}`, headers: auth() })).statusCode).toBe(204)
  })

  it('有分摊的流水不允许缩到分摊额以下、换类型或改成待确认；日期与备注允许修改', async () => {
    const billId = await bill('编辑检查', 100)
    const id = await transaction(120)
    await allocate(id, [row(billId, 100)])
    const update = (payload: object) => app.inject({ method: 'PUT', url: `/api/transactions/${id}`, headers: auth(), payload })
    for (const payload of [{ amount: 90 }, { type: 'refund' }, { status: 'pending' }]) expect((await update(payload)).statusCode).toBe(409)
    expect((await update({ amount: 150, note: '可编辑备注', occurredAt: '2026-10-04' })).statusCode).toBe(200)
    expect((await app.inject({ method: 'DELETE', url: `/api/bills/${billId}`, headers: auth() })).statusCode).toBe(409)
    expect((await app.inject({ method: 'PUT', url: `/api/bills/${billId}`, headers: auth(), payload: { active: false, dueDay: 10, amount: 110 } })).statusCode).toBe(200)
    expect((await list()).allocations.find((value: { transactionId: number }) => value.transactionId === id).periodKey).toBe(periodKey)
    expect((await allocate(id, [])).statusCode).toBe(200)
    expect((await app.inject({ method: 'DELETE', url: `/api/bills/${billId}`, headers: auth() })).statusCode).toBe(204)
  })

  it('并发退款串行校验，同一交易并发全量替换不累加', async () => {
    const billId = await bill('并发退款', 100)
    await allocate(await transaction(100), [row(billId, 100)])
    const first = await transaction(70, 'refund')
    const second = await transaction(70, 'refund')
    const responses = await Promise.all([allocate(first, [row(billId, 70)]), allocate(second, [row(billId, 70)])])
    expect(responses.map(value => value.statusCode).sort()).toEqual([200, 409])
    const expense = await transaction(20)
    expect((await Promise.all([allocate(expense, [row(billId, 10)]), allocate(expense, [row(billId, 20)])])).every(value => value.statusCode === 200)).toBe(true)
    expect((await list()).allocations.filter((value: { transactionId: number }) => value.transactionId === expense)).toHaveLength(1)
  })

  it('旧支付 API 创建及撤销分摊，原子记账重试保持唯一', async () => {
    const billId = await bill('旧接口', 30)
    const tx = await transaction(50)
    const response = await app.inject({ method: 'POST', url: '/api/bill-payments', headers: auth(), payload: { billId, periodKey, paidAt: '2026-10-05', transactionId: tx } })
    expect(response.statusCode).toBe(201)
    expect((await list()).allocations.find((value: { transactionId: number }) => value.transactionId === tx).amount).toBe(30)
    expect((await app.inject({ method: 'DELETE', url: `/api/bill-payments/${response.json().payment.id}`, headers: auth() })).statusCode).toBe(204)
    expect((await list()).allocations.some((value: { transactionId: number }) => value.transactionId === tx)).toBe(false)
    const pay = () => app.inject({ method: 'POST', url: `/api/bills/${billId}/pay`, headers: auth(), payload: { periodKey, paidAt: '2026-10-05' } })
    const responses = await Promise.all([pay(), pay()])
    expect(responses.map(value => value.statusCode).sort()).toEqual([200, 201])
    expect((await list()).allocations.filter((value: { billId: number }) => value.billId === billId)).toHaveLength(1)
  })

  it('旧接口也不能超额或关联退款；旧支付标记撤销受退款守恒保护', async () => {
    const billId = await bill('旧接口校验', 100)
    const send = (transactionId: number) => app.inject({ method: 'POST', url: '/api/bill-payments', headers: auth(), payload: { billId, periodKey, paidAt: '2026-10-05', transactionId } })
    expect((await send(await transaction(50))).statusCode).toBe(400)
    expect((await send(await transaction(100, 'refund'))).statusCode).toBe(409)
    const expense = await transaction(100)
    const payment = await send(expense)
    expect(payment.statusCode).toBe(201)
    const refund = await transaction(10, 'refund')
    await allocate(refund, [row(billId, 10)])
    const remove = () => app.inject({ method: 'DELETE', url: `/api/bill-payments/${payment.json().payment.id}`, headers: auth() })
    expect((await remove()).statusCode).toBe(409)
    await allocate(refund, [])
    expect((await remove()).statusCode).toBe(204)
  })

  it('交易修改与分摊并发不会产生分摊超过交易金额', async () => {
    const billId = await bill('并发修改', 100)
    const id = await transaction(100)
    const responses = await Promise.all([
      allocate(id, [row(billId, 100)]),
      app.inject({ method: 'PUT', url: `/api/transactions/${id}`, headers: auth(), payload: { amount: 50 } }),
    ])
    expect(responses.some(value => value.statusCode === 200)).toBe(true)
    expect(responses.some(value => value.statusCode === 400 || value.statusCode === 409)).toBe(true)
    const original = (await app.inject({ method: 'GET', url: '/api/transactions', headers: auth() })).json().transactions.find((value: { id: number }) => value.id === id)
    const sum = original.fixedAllocations.reduce((total: number, value: { amount: number }) => total + value.amount, 0)
    expect(sum).toBeLessThanOrEqual(original.amount)
  })

  it('未来付款不能覆盖更早退款，改动付款或退款日期也不得让退款早于可退付款', async () => {
    const billId = await bill('退款日期检查', 800)
    const expense = await transaction(800)
    const refund = await transaction(100, 'refund')
    const change = (id: number, occurredAt: string) => app.inject({ method: 'PUT', url: `/api/transactions/${id}`, headers: auth(), payload: { occurredAt } })
    await change(expense, '2026-10-06')
    await allocate(expense, [row(billId, 800)])
    expect((await allocate(refund, [row(billId, 100)])).statusCode).toBe(409)
    await change(expense, '2026-10-04')
    expect((await allocate(refund, [row(billId, 100)])).statusCode).toBe(200)
    expect((await change(expense, '2026-10-06')).statusCode).toBe(409)
    expect((await change(refund, '2026-10-03')).statusCode).toBe(409)
    const rows = (await app.inject({ method: 'GET', url: '/api/transactions', headers: auth() })).json().transactions
    expect(rows.find((value: { id: number }) => value.id === expense).occurredAt).toBe('2026-10-04')
    expect(rows.find((value: { id: number }) => value.id === refund).occurredAt).toBe('2026-10-05')
  })

  it('分摊全量撤销同步清除对应旧支付标记', async () => {
    const billId = await bill('撤销旧标记', 30)
    const response = await app.inject({ method: 'POST', url: `/api/bills/${billId}/pay`, headers: auth(), payload: { periodKey, paidAt: '2026-10-05' } })
    expect(response.statusCode).toBe(201)
    const id = response.json().transaction.id
    expect((await allocate(id, [])).statusCode).toBe(200)
    expect((await list()).payments.some((value: { transactionId: number }) => value.transactionId === id)).toBe(false)
  })

  it('旧月份标记与新版 markerOnly 备份恢复保留元数据，不推断分摊金额', async () => {
    const billId = await bill('备份元数据', 100)
    const id = await transaction(30)
    const restore = (period: string, markerOnly?: boolean, value = token) => app.inject({ method: 'POST', url: '/api/bill-payments', headers: auth(value), payload: { billId, transactionId: id, periodKey: period, paidAt: '2026-10-05', ...(markerOnly ? { markerOnly } : {}) } })
    expect((await restore('2026-10')).statusCode).toBe(201)
    expect((await restore('2026-11-05', true)).statusCode).toBe(201)
    expect((await restore('2026-12-05', true, other)).statusCode).toBe(404)
    const data = await list()
    expect(data.payments.filter((value: { transactionId: number }) => value.transactionId === id)).toHaveLength(2)
    expect(data.allocations.some((value: { transactionId: number }) => value.transactionId === id)).toBe(false)
  })

  it('markerOnly 可恢复旧退款与待确认的支付标记，非日期历史退款标记也兼容', async () => {
    const first = await bill('历史标记房租', 800)
    const second = await bill('历史标记水费', 100)
    const refund = await transaction(20, 'refund')
    const pending = await transaction(10, 'expense', 'pending')
    const restore = (billId: number, transactionId: number, period: string, markerOnly?: boolean) => app.inject({
      method: 'POST', url: '/api/bill-payments', headers: auth(),
      payload: { billId, transactionId, periodKey: period, paidAt: '2026-10-05', ...(markerOnly ? { markerOnly } : {}) },
    })
    expect((await restore(first, refund, '2026-11-05', true)).statusCode).toBe(201)
    expect((await restore(second, refund, '2026-11-05', true)).statusCode).toBe(201)
    expect((await restore(first, pending, '2026-12-05', true)).statusCode).toBe(201)
    expect((await restore(first, refund, '2027-01')).statusCode).toBe(201)
    const data = await list()
    expect(data.payments.filter((value: { transactionId: number }) => [refund, pending].includes(value.transactionId))).toHaveLength(4)
    expect(data.allocations.some((value: { transactionId: number }) => [refund, pending].includes(value.transactionId))).toBe(false)
  })

  it('迁移仅回填合法旧支付关联；非法日期、待确认、退款和超額组合保持未关联', async () => {
    // Isolate the final migration fixture from earlier API rows. The test DB is disposable.
    await pool.query('DELETE FROM bill_allocations')
    await pool.query('DELETE FROM bill_payments')
    const owner = (await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth() })).json().user.id
    const first = await bill('迁移房租', 80)
    const second = await bill('迁移水费', 30)
    const valid = await transaction(120)
    const invalidDate = await transaction(120)
    const pending = await transaction(120, 'expense', 'pending')
    const refund = await transaction(120, 'refund')
    const oversized = await transaction(100)
    const insert = (transactionId: number, billId: number, date: string) => pool.query('INSERT INTO bill_payments (user_id,bill_id,period_key,paid_at,transaction_id) VALUES (?,?,?,?,?)', [owner, billId, date, '2026-10-05', transactionId])
    await insert(valid, first, '2026-11-05')
    await insert(valid, second, '2026-11-05')
    await insert(invalidDate, first, '2026-02-30')
    await insert(invalidDate, first, 'unknown')
    await insert(pending, first, '2026-12-05')
    await insert(refund, first, '2027-01-05')
    await insert(oversized, first, '2027-02-05')
    await insert(oversized, second, '2027-02-05')
    const migration = await readFile(new URL('../../drizzle/0005_exotic_doctor_octopus.sql', import.meta.url), 'utf8')
    await pool.query(migration.slice(migration.indexOf('-- Backfill')))
    const values = (await list()).allocations
    expect(values).toHaveLength(2)
    expect(values.every((value: { transactionId: number }) => value.transactionId === valid)).toBe(true)
    expect(values.map((value: { amount: number }) => value.amount).sort((a: number, b: number) => a - b)).toEqual([30, 80])
  })
})
