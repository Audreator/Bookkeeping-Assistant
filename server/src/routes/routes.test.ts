// @vitest-environment node
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../app.ts'
import { createDb } from '../db/client.ts'
import { runMigrations } from '../db/migrate.ts'
import { env } from '../env.ts'
import { prehashPassword } from '../util/password.ts'

let app: FastifyInstance
let pool: ReturnType<typeof createDb>['pool']
let db: ReturnType<typeof createDb>['db']
let tokenA = ''
let tokenB = ''
let catA = 0
let txA = 0
let billA = 0
let payA = 0

const TABLES = [
  'bill_allocations',
  'email_receipts',
  'bill_payments',
  'transactions',
  'bills',
  'budget_events',
  'day_overrides',
  'categories',
  'settings',
  'users',
]

const auth = (token: string) => ({ authorization: `Bearer ${token}` })

beforeAll(async () => {
  const conn = createDb(env.testDatabaseUrl)
  pool = conn.pool
  db = conn.db
  await runMigrations(db)
  await pool.query('SET FOREIGN_KEY_CHECKS=0')
  for (const t of TABLES) await pool.query(`TRUNCATE TABLE \`${t}\``)
  await pool.query('SET FOREIGN_KEY_CHECKS=1')
  app = await buildApp({
    databaseUrl: env.testDatabaseUrl,
    jwtSecret: env.jwtSecret,
    allowRegistration: true,
  })
  await app.ready()

  const a = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'user_a', password: prehashPassword('secret123') },
  })
  tokenA = a.json().token
  const b = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'user_b', password: prehashPassword('secret123') },
  })
  tokenB = b.json().token
})

afterAll(async () => {
  await app.close()
  await pool.end()
})

describe('分类 API', () => {
  it('默认 12 个并按 sort 排序', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/categories', headers: auth(tokenA) })
    expect(res.statusCode).toBe(200)
    const list = res.json().categories
    expect(list).toHaveLength(12)
    expect(list[0].name).toBe('餐饮')
  })

  it('新增分类与重名 409', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: '/api/categories',
      headers: auth(tokenA),
      payload: { name: '咖啡', icon: '☕', color: '#8b5cf6', sort: 99 },
    })
    expect(ok.statusCode).toBe(201)
    catA = ok.json().category.id

    const dup = await app.inject({
      method: 'POST',
      url: '/api/categories',
      headers: auth(tokenA),
      payload: { name: '咖啡' },
    })
    expect(dup.statusCode).toBe(409)
  })

  it('改名与删除（未使用）', async () => {
    const renamed = await app.inject({
      method: 'PUT',
      url: `/api/categories/${catA}`,
      headers: auth(tokenA),
      payload: { name: '咖啡奶茶' },
    })
    expect(renamed.statusCode).toBe(200)
    expect(renamed.json().category.name).toBe('咖啡奶茶')

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/categories/${catA}`,
      headers: auth(tokenA),
    })
    expect(del.statusCode).toBe(204)
    catA = 0
  })
})

describe('交易 API', () => {
  it('新增交易（金额四舍五入到分）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: auth(tokenA),
      payload: {
        type: 'expense',
        amount: 12.345,
        merchant: '便利店',
        note: '矿泉水',
        occurredAt: '2026-10-01',
        source: 'manual',
      },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().transaction.amount).toBe(12.35)
    txA = res.json().transaction.id
  })

  it('新增第二笔并支持筛选', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: auth(tokenA),
      payload: { type: 'expense', amount: 30, merchant: '地铁', occurredAt: '2026-10-05' },
    })
    const all = await app.inject({ method: 'GET', url: '/api/transactions', headers: auth(tokenA) })
    expect(all.json().transactions).toHaveLength(2)

    const byRange = await app.inject({
      method: 'GET',
      url: '/api/transactions?from=2026-10-04&to=2026-10-31',
      headers: auth(tokenA),
    })
    expect(byRange.json().transactions).toHaveLength(1)

    const byQ = await app.inject({
      method: 'GET',
      url: '/api/transactions?q=' + encodeURIComponent('便利'),
      headers: auth(tokenA),
    })
    expect(byQ.json().transactions[0].merchant).toBe('便利店')
  })

  it('更新与删除', async () => {
    const upd = await app.inject({
      method: 'PUT',
      url: `/api/transactions/${txA}`,
      headers: auth(tokenA),
      payload: { amount: 13.5, type: 'refund' },
    })
    expect(upd.statusCode).toBe(200)
    expect(upd.json().transaction).toMatchObject({ amount: 13.5, type: 'refund' })

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/transactions/${txA}`,
      headers: auth(tokenA),
    })
    expect(del.statusCode).toBe(204)
  })

  it('删除被交易引用的分类返回 409', async () => {
    const cat = await app.inject({
      method: 'POST',
      url: '/api/categories',
      headers: auth(tokenA),
      payload: { name: '临时分类' },
    })
    const catId = cat.json().category.id
    const tx = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: auth(tokenA),
      payload: { type: 'expense', amount: 5, occurredAt: '2026-10-06', categoryId: catId },
    })
    expect(tx.statusCode).toBe(201)
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/categories/${catId}`,
      headers: auth(tokenA),
    })
    expect(del.statusCode).toBe(409)
  })
})

describe('用户隔离', () => {
  it('B 的列表看不到 A 的数据', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/transactions', headers: auth(tokenB) })
    expect(res.json().transactions).toHaveLength(0)
    const cats = await app.inject({ method: 'GET', url: '/api/categories', headers: auth(tokenB) })
    expect(cats.json().categories).toHaveLength(12)
    expect(cats.json().categories.every((c: { name: string }) => c.name !== '临时分类')).toBe(true)
  })

  it('B 修改/删除 A 的资源一律 404', async () => {
    const aTx = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: auth(tokenA),
      payload: { type: 'expense', amount: 9.9, occurredAt: '2026-10-07' },
    })
    const id = aTx.json().transaction.id
    const put = await app.inject({
      method: 'PUT',
      url: `/api/transactions/${id}`,
      headers: auth(tokenB),
      payload: { amount: 1 },
    })
    expect(put.statusCode).toBe(404)
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/transactions/${id}`,
      headers: auth(tokenB),
    })
    expect(del.statusCode).toBe(404)
    const events = await app.inject({
      method: 'GET',
      url: '/api/events',
      headers: auth(tokenB),
    })
    expect(events.json().events).toHaveLength(1)
  })
})

describe('预算事件 API', () => {
  it('新增事件且列表按时间升序', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: auth(tokenA),
      payload: {
        at: '2026-10-15',
        mode: 'month',
        monthBudget: 5000,
        cycleStartDay: 1,
        weekStartsOn: 1,
        note: '加预算',
      },
    })
    expect(res.statusCode).toBe(201)
    const list = await app.inject({ method: 'GET', url: '/api/events', headers: auth(tokenA) })
    expect(list.json().events).toHaveLength(2)
    expect(list.json().events[0].at <= list.json().events[1].at).toBe(true)
  })

  it('非法事件 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: auth(tokenA),
      payload: { mode: 'month', monthBudget: -1, cycleStartDay: 99, weekStartsOn: 3 },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('固定支出 API', () => {
  it('创建账单与支付，重复支付 409', async () => {
    const bill = await app.inject({
      method: 'POST',
      url: '/api/bills',
      headers: auth(tokenA),
      payload: { name: '房租', amount: 3000, dueDay: 15, remindDaysBefore: 3 },
    })
    expect(bill.statusCode).toBe(201)
    billA = bill.json().bill.id

    const pay = await app.inject({
      method: 'POST',
      url: '/api/bill-payments',
      headers: auth(tokenA),
      payload: { billId: billA, periodKey: '2026-10-15', paidAt: '2026-10-15' },
    })
    expect(pay.statusCode).toBe(201)
    payA = pay.json().payment.id

    const dup = await app.inject({
      method: 'POST',
      url: '/api/bill-payments',
      headers: auth(tokenA),
      payload: { billId: billA, periodKey: '2026-10-15', paidAt: '2026-10-15' },
    })
    expect(dup.statusCode).toBe(409)

    const list = await app.inject({ method: 'GET', url: '/api/bills', headers: auth(tokenA) })
    expect(list.json().bills).toHaveLength(1)
    expect(list.json().payments).toHaveLength(1)
  })

  it('删除支付记录', async () => {
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/bill-payments/${payA}`,
      headers: auth(tokenA),
    })
    expect(del.statusCode).toBe(204)
  })

  it('更新账单本体并持久化金额、日期、提醒和启用状态', async () => {
    const updated = await app.inject({
      method: 'PUT',
      url: `/api/bills/${billA}`,
      headers: auth(tokenA),
      payload: { name: '续约房租', amount: 3123.456, dueDay: 20, remindDaysBefore: 7, active: false },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json().bill).toMatchObject({
      id: billA,
      name: '续约房租',
      amount: 3123.46,
      categoryId: null,
      dueDay: 20,
      remindDaysBefore: 7,
      active: false,
    })
    const list = await app.inject({ method: 'GET', url: '/api/bills', headers: auth(tokenA) })
    expect(list.json().bills.find((bill: { id: number }) => bill.id === billA)).toEqual(updated.json().bill)
  })

  it('B 更新 A 的账单返回 404，原账单内容保持不变', async () => {
    const before = await app.inject({ method: 'GET', url: '/api/bills', headers: auth(tokenA) })
    const original = before.json().bills.find((bill: { id: number }) => bill.id === billA)
    expect(original).toBeDefined()
    const denied = await app.inject({
      method: 'PUT',
      url: `/api/bills/${billA}`,
      headers: auth(tokenB),
      payload: { name: '未经授权修改', amount: 1, active: true },
    })
    expect(denied.statusCode).toBe(404)
    const after = await app.inject({ method: 'GET', url: '/api/bills', headers: auth(tokenA) })
    expect(after.json().bills.find((bill: { id: number }) => bill.id === billA)).toEqual(original)
  })

  it('B 删除 A 的账单返回 404，原账单仍属于 A', async () => {
    const denied = await app.inject({ method: 'DELETE', url: `/api/bills/${billA}`, headers: auth(tokenB) })
    expect(denied.statusCode).toBe(404)
    const owner = await app.inject({ method: 'GET', url: '/api/bills', headers: auth(tokenA) })
    expect(owner.json().bills.some((bill: { id: number }) => bill.id === billA)).toBe(true)
    const other = await app.inject({ method: 'GET', url: '/api/bills', headers: auth(tokenB) })
    expect(other.json().bills).toHaveLength(0)
  })

  it('A 删除自己的账单后列表移除，重复删除返回 404', async () => {
    const deleted = await app.inject({ method: 'DELETE', url: `/api/bills/${billA}`, headers: auth(tokenA) })
    expect(deleted.statusCode).toBe(204)
    const list = await app.inject({ method: 'GET', url: '/api/bills', headers: auth(tokenA) })
    expect(list.json().bills.some((bill: { id: number }) => bill.id === billA)).toBe(false)
    const again = await app.inject({ method: 'DELETE', url: `/api/bills/${billA}`, headers: auth(tokenA) })
    expect(again.statusCode).toBe(404)
  })

  it('有关联流水的账单需先撤销分摊才能删除，删除后保留原交易', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/bills',
      headers: auth(tokenA),
      payload: { name: '删除后保留支出', amount: 39.9, dueDay: 10 },
    })
    expect(created.statusCode).toBe(201)
    const billId = created.json().bill.id as number
    const paid = await app.inject({
      method: 'POST',
      url: `/api/bills/${billId}/pay`,
      headers: auth(tokenA),
      payload: { periodKey: '2026-10-10', paidAt: '2026-10-10', occurredTime: '12:13:14' },
    })
    expect(paid.statusCode).toBe(201)
    const paymentId = paid.json().payment.id as number
    const originalTransaction = paid.json().transaction
    const before = await app.inject({ method: 'GET', url: '/api/bills', headers: auth(tokenA) })
    expect(before.json().payments.some((payment: { id: number }) => payment.id === paymentId)).toBe(true)

    const denied = await app.inject({ method: 'DELETE', url: `/api/bills/${billId}`, headers: auth(tokenA) })
    expect(denied.statusCode).toBe(409)
    const unlinked = await app.inject({ method: 'PUT', url: `/api/transactions/${originalTransaction.id}/fixed-allocations`, headers: auth(tokenA), payload: { allocations: [] } })
    expect(unlinked.statusCode).toBe(200)
    const deleted = await app.inject({ method: 'DELETE', url: `/api/bills/${billId}`, headers: auth(tokenA) })
    expect(deleted.statusCode).toBe(204)
    const after = await app.inject({ method: 'GET', url: '/api/bills', headers: auth(tokenA) })
    expect(after.json().bills.some((bill: { id: number }) => bill.id === billId)).toBe(false)
    expect(after.json().payments.some((payment: { billId: number }) => payment.billId === billId)).toBe(false)
    const stalePayment = await app.inject({ method: 'DELETE', url: `/api/bill-payments/${paymentId}`, headers: auth(tokenA) })
    expect(stalePayment.statusCode).toBe(404)
    const transactions = await app.inject({ method: 'GET', url: '/api/transactions', headers: auth(tokenA) })
    expect(transactions.json().transactions.find((transaction: { id: number }) => transaction.id === originalTransaction.id))
      .toEqual({ ...originalTransaction, fixedAllocations: [] })
  })
})

describe('设置 API', () => {
  it('PUT 后 GET 往返一致', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: auth(tokenA),
      payload: { reserveEnabled: false, theme: 'light' },
    })
    expect(put.statusCode).toBe(200)
    const get = await app.inject({ method: 'GET', url: '/api/settings', headers: auth(tokenA) })
    expect(get.json().settings).toMatchObject({ reserveEnabled: false, theme: 'light' })
  })
})

describe('外键归属与日期校验', () => {
  it('B 不能引用 A 的分类（404）', async () => {
    const cat = await app.inject({
      method: 'POST',
      url: '/api/categories',
      headers: auth(tokenA),
      payload: { name: '归属测试' },
    })
    const catId = cat.json().category.id
    const res = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: auth(tokenB),
      payload: { type: 'expense', amount: 1, occurredAt: '2026-10-08', categoryId: catId },
    })
    expect(res.statusCode).toBe(404)
  })

  it('不存在的日历日期返回 400 而不是 500', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: auth(tokenA),
      payload: { type: 'expense', amount: 1, occurredAt: '2026-02-30' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('不足一分的金额不能四舍五入成零元交易', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/transactions', headers: auth(tokenA), payload: { type: 'expense', amount: 0.001, occurredAt: '2026-10-08' } })
    expect(res.statusCode).toBe(400)
  })
})

describe('单独某天预算 API', () => {
  it('设置、同一天覆盖为更新、列表与删除', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/day-overrides',
      headers: auth(tokenA),
      payload: { date: '2026-10-20', amount: 500 },
    })
    expect(put.statusCode).toBe(200)
    expect(put.json().override.amount).toBe(500)

    const again = await app.inject({
      method: 'PUT',
      url: '/api/day-overrides',
      headers: auth(tokenA),
      payload: { date: '2026-10-20', amount: 620, note: '朋友聚会' },
    })
    expect(again.statusCode).toBe(200)

    const list = await app.inject({
      method: 'GET',
      url: '/api/day-overrides',
      headers: auth(tokenA),
    })
    const mine = (list.json().overrides as Array<{ id: number; date: string; amount: number }>).filter(
      (o) => o.date === '2026-10-20',
    )
    expect(mine).toHaveLength(1)
    expect(mine[0].amount).toBe(620)

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/day-overrides/${mine[0].id}`,
      headers: auth(tokenA),
    })
    expect(del.statusCode).toBe(204)
  })

  it('用户隔离：B 看不到 A 的单独预算，删除 A 的返回 404', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/day-overrides',
      headers: auth(tokenA),
      payload: { date: '2026-10-21', amount: 88 },
    })
    const id = put.json().override.id as number

    const listB = await app.inject({
      method: 'GET',
      url: '/api/day-overrides',
      headers: auth(tokenB),
    })
    expect(listB.json().overrides).toHaveLength(0)

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/day-overrides/${id}`,
      headers: auth(tokenB),
    })
    expect(del.statusCode).toBe(404)
  })

  it('非法日期 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/day-overrides',
      headers: auth(tokenA),
      payload: { date: '2026-02-30', amount: 5 },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('鉴权兜底', () => {
  it('无 token 访问业务路由一律 401', async () => {
    for (const url of ['/api/transactions', '/api/categories', '/api/events', '/api/bills', '/api/settings']) {
      const res = await app.inject({ method: 'GET', url })
      expect(res.statusCode).toBe(401)
    }
  })
})

describe('交易秒级时间', () => {
  it('同一 requestId 的导入重试只入账一次并拒绝内容冲突', async () => {
    const payload = { type: 'expense', amount: 9.87, occurredAt: '2026-10-23', occurredTime: '12:13:14', merchant: '导入重试', source: 'import', requestId: 'import-file-row-001' }
    const send = (body: object) => app.inject({ method: 'POST', url: '/api/transactions', headers: auth(tokenA), payload: body })
    const responses = await Promise.all([send(payload), send(payload), send(payload)])
    expect(responses.filter(r => r.statusCode === 201)).toHaveLength(1)
    expect(responses.filter(r => r.statusCode === 200)).toHaveLength(2)
    expect(new Set(responses.map(r => r.json().transaction.id)).size).toBe(1)
    expect((await send({ ...payload, amount: 9.88 })).statusCode).toBe(409)
  })
  it('游标分页不截断交易且保持用户隔离', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/transactions?pagination=id&limit=1', headers: auth(tokenA) })
    expect(first.json().nextCursor).toBeTypeOf('number')
    const second = await app.inject({ method: 'GET', url: `/api/transactions?pagination=id&limit=1&beforeId=${first.json().nextCursor}`, headers: auth(tokenA) })
    expect(second.json().transactions[0].id).toBeLessThan(first.json().transactions[0].id)
    const other = await app.inject({ method: 'GET', url: '/api/transactions?pagination=id&limit=1', headers: auth(tokenB) })
    expect(other.json().transactions).toHaveLength(0)
    expect(other.json().nextCursor).toBeNull()
    expect((await app.inject({ method: 'GET', url: '/api/transactions?beforeId=20', headers: auth(tokenA) })).statusCode).toBe(400)
  })
  it('新增/更新/清空时间，列表按发生时间排序', async () => {
    const send = (time: string) => app.inject({ method: 'POST', url: '/api/transactions', headers: auth(tokenA), payload: { type: 'expense', amount: 2.01, occurredAt: '2026-10-25', occurredTime: time } })
    const later = await send('18:01:02')
    const earlier = await send('08:02:03')
    expect(later.statusCode).toBe(201)
    expect(later.json().transaction.occurredTime).toBe('18:01:02')
    const list = await app.inject({ method: 'GET', url: '/api/transactions?from=2026-10-25&to=2026-10-25', headers: auth(tokenA) })
    expect(list.json().transactions.map((t: { occurredTime: string }) => t.occurredTime)).toEqual(['18:01:02', '08:02:03'])
    const id = earlier.json().transaction.id
    const changed = await app.inject({ method: 'PUT', url: `/api/transactions/${id}`, headers: auth(tokenA), payload: { occurredTime: '09:10:11' } })
    expect(changed.json().transaction.occurredTime).toBe('09:10:11')
    const cleared = await app.inject({ method: 'PUT', url: `/api/transactions/${id}`, headers: auth(tokenA), payload: { occurredTime: null } })
    expect(cleared.json().transaction.occurredTime).toBeNull()
    expect((await send('24:00:00')).statusCode).toBe(400)
  })
})

describe('原子固定支出记账', () => {
  it('并发或网络重试只生成一笔支出与一个支付标记', async () => {
    const bill = await app.inject({ method: 'POST', url: '/api/bills', headers: auth(tokenA), payload: { name: '原子订阅', amount: 29.91, dueDay: 20 } })
    const id = bill.json().bill.id
    const send = () => app.inject({ method: 'POST', url: `/api/bills/${id}/pay`, headers: auth(tokenA), payload: { periodKey: '2026-10-20', paidAt: '2026-10-04', occurredTime: '18:19:20' } })
    const responses = await Promise.all([send(), send(), send()])
    expect(responses.filter(r => r.statusCode === 201)).toHaveLength(1)
    expect(responses.filter(r => r.statusCode === 200)).toHaveLength(2)
    const txIds = responses.map(r => r.json().transaction.id)
    expect(new Set(txIds).size).toBe(1)
    expect(responses[0].json().transaction.occurredTime).toBe('18:19:20')
    const txs = await app.inject({ method: 'GET', url: '/api/transactions?q=原子订阅', headers: auth(tokenA) })
    expect(txs.json().transactions).toHaveLength(1)
    expect((await app.inject({ method: 'POST', url: `/api/bills/${id}/pay`, headers: auth(tokenB), payload: { periodKey: '2026-10-20', paidAt: '2026-10-04' } })).statusCode).toBe(404)
    const deleted = await app.inject({ method: 'DELETE', url: `/api/transactions/${txIds[0]}`, headers: auth(tokenA) })
    expect(deleted.statusCode).toBe(204)
    const repaid = await send()
    expect(repaid.statusCode).toBe(201)
    expect(repaid.json().transaction.id).not.toBe(txIds[0])
    const after = await app.inject({ method: 'GET', url: '/api/transactions?q=原子订阅', headers: auth(tokenA) })
    expect(after.json().transactions).toHaveLength(1)
  })
})
