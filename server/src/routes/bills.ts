import { and, asc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { billPayments, bills, transactions } from '../db/schema.ts'
import { nowDateTime, round2 } from '../util/date.ts'
import { dateString, isDupEntry, notFound, parseId, stripUndefined, timeString } from './helpers.ts'
import { serializeTransaction } from './transactions.ts'

const billInput = z.object({
  name: z.string().min(1).max(64),
  amount: z.number().positive().max(10_000_000),
  categoryId: z.number().int().positive().nullable().optional(),
  dueDay: z.number().int().min(1).max(31),
  remindDaysBefore: z.number().int().min(0).max(30).optional(),
  active: z.boolean().optional(),
})

const paymentInput = z.object({
  billId: z.number().int().positive(),
  periodKey: z.string().min(1).max(32),
  paidAt: dateString,
  transactionId: z.number().int().positive().nullable().optional(),
})

const serializeBill = (row: typeof bills.$inferSelect) => ({
  id: row.id,
  name: row.name,
  amount: row.amount,
  categoryId: row.categoryId,
  dueDay: row.dueDay,
  remindDaysBefore: row.remindDaysBefore,
  active: row.active,
})

const serializePayment = (row: typeof billPayments.$inferSelect) => ({
  id: row.id,
  billId: row.billId,
  periodKey: row.periodKey,
  paidAt: row.paidAt,
  transactionId: row.transactionId,
})

export function registerBillRoutes(app: FastifyInstance) {
  app.get('/api/bills', async (request) => {
    const uid = request.userId as number
    const billRows = await app.db
      .select()
      .from(bills)
      .where(eq(bills.userId, uid))
      .orderBy(asc(bills.dueDay), asc(bills.id))
    const payRows = await app.db
      .select()
      .from(billPayments)
      .where(eq(billPayments.userId, uid))
      .orderBy(asc(billPayments.paidAt), asc(billPayments.id))
    return { bills: billRows.map(serializeBill), payments: payRows.map(serializePayment) }
  })

  app.post('/api/bills', async (request, reply) => {
    const parsed = billInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '固定支出参数错误' })
    const uid = request.userId as number
    const data = parsed.data
    const [result] = await app.db.insert(bills).values({
      userId: uid,
      name: data.name,
      amount: round2(data.amount),
      categoryId: data.categoryId ?? null,
      dueDay: data.dueDay,
      remindDaysBefore: data.remindDaysBefore ?? 3,
      active: data.active ?? true,
    })
    const rows = await app.db
      .select()
      .from(bills)
      .where(and(eq(bills.userId, uid), eq(bills.id, Number(result.insertId))))
    return reply.code(201).send({ bill: serializeBill(rows[0]) })
  })

  app.put('/api/bills/:id', async (request, reply) => {
    const id = parseId((request.params as { id: string }).id)
    if (!id) return reply.code(400).send({ error: '参数错误' })
    const parsed = billInput.partial().safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '固定支出参数错误' })
    const patch = stripUndefined(parsed.data)
    if (Object.keys(patch).length === 0) return reply.code(400).send({ error: '无更新内容' })
    if (typeof patch.amount === 'number') patch.amount = round2(patch.amount)
    const uid = request.userId as number
    const [result] = await app.db
      .update(bills)
      .set(patch)
      .where(and(eq(bills.userId, uid), eq(bills.id, id)))
    if (result.affectedRows === 0) return notFound(reply)
    const rows = await app.db
      .select()
      .from(bills)
      .where(and(eq(bills.userId, uid), eq(bills.id, id)))
    return { bill: serializeBill(rows[0]) }
  })

  app.delete('/api/bills/:id', async (request, reply) => {
    const id = parseId((request.params as { id: string }).id)
    if (!id) return reply.code(400).send({ error: '参数错误' })
    const uid = request.userId as number
    const [result] = await app.db
      .delete(bills)
      .where(and(eq(bills.userId, uid), eq(bills.id, id)))
    if (result.affectedRows === 0) return notFound(reply)
    return reply.code(204).send()
  })

  app.post('/api/bills/:id/pay', async (request, reply) => {
    const id = parseId((request.params as { id: string }).id)
    if (!id) return reply.code(400).send({ error: '参数错误' })
    const parsed = z.object({ periodKey: dateString, paidAt: dateString, occurredTime: timeString.nullable().optional() }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '固定支出记账参数错误' })
    const uid = request.userId as number
    const data = parsed.data
    const outcome = await app.db.transaction(async (connection) => {
      // 锁定该用户的账单，重试和并发请求都在同一事务里判断本期是否已付。
      const owned = await connection.select().from(bills)
        .where(and(eq(bills.userId, uid), eq(bills.id, id))).limit(1).for('update')
      const bill = owned[0]
      if (!bill) return null
      const previous = await connection.select().from(billPayments)
        .where(and(eq(billPayments.userId, uid), eq(billPayments.billId, id), eq(billPayments.periodKey, data.periodKey))).limit(1)
      if (previous[0]) {
        const row = previous[0]
        const tx = row.transactionId ? (await connection.select().from(transactions)
          .where(and(eq(transactions.userId, uid), eq(transactions.id, row.transactionId))).limit(1))[0] : undefined
        return { duplicate: true, payment: serializePayment(row), transaction: tx ? serializeTransaction(tx) : null }
      }
      const [txResult] = await connection.insert(transactions).values({
        userId: uid, type: 'expense', amount: bill.amount, categoryId: bill.categoryId,
        merchant: bill.name, note: '固定支出', occurredAt: data.paidAt,
        occurredTime: data.occurredTime ?? null, source: 'manual', status: 'confirmed', createdAt: nowDateTime(),
      })
      const transactionId = Number(txResult.insertId)
      const [payResult] = await connection.insert(billPayments).values({ userId: uid, billId: id, periodKey: data.periodKey, paidAt: data.paidAt, transactionId })
      const pay = (await connection.select().from(billPayments).where(eq(billPayments.id, Number(payResult.insertId))))[0]
      const tx = (await connection.select().from(transactions).where(eq(transactions.id, transactionId)))[0]
      return { duplicate: false, payment: serializePayment(pay), transaction: serializeTransaction(tx) }
    })
    if (!outcome) return notFound(reply)
    return reply.code(outcome.duplicate ? 200 : 201).send(outcome)
  })

  app.post('/api/bill-payments', async (request, reply) => {
    const parsed = paymentInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '支付记录参数错误' })
    const uid = request.userId as number
    const data = parsed.data
    const owned = await app.db
      .select({ id: bills.id })
      .from(bills)
      .where(and(eq(bills.userId, uid), eq(bills.id, data.billId)))
      .limit(1)
    if (owned.length === 0) return notFound(reply)
    if (data.transactionId != null) {
      const txOwned = await app.db
        .select({ id: transactions.id })
        .from(transactions)
        .where(and(eq(transactions.userId, uid), eq(transactions.id, data.transactionId)))
        .limit(1)
      if (txOwned.length === 0) return notFound(reply)
    }
    try {
      const [result] = await app.db.insert(billPayments).values({
        userId: uid,
        billId: data.billId,
        periodKey: data.periodKey,
        paidAt: data.paidAt,
        transactionId: data.transactionId ?? null,
      })
      const rows = await app.db
        .select()
        .from(billPayments)
        .where(and(eq(billPayments.userId, uid), eq(billPayments.id, Number(result.insertId))))
      return reply.code(201).send({ payment: serializePayment(rows[0]) })
    } catch (err) {
      if (isDupEntry(err)) return reply.code(409).send({ error: '该账单本期已记录支付' })
      throw err
    }
  })

  app.delete('/api/bill-payments/:id', async (request, reply) => {
    const id = parseId((request.params as { id: string }).id)
    if (!id) return reply.code(400).send({ error: '参数错误' })
    const uid = request.userId as number
    const [result] = await app.db
      .delete(billPayments)
      .where(and(eq(billPayments.userId, uid), eq(billPayments.id, id)))
    if (result.affectedRows === 0) return notFound(reply)
    return reply.code(204).send()
  })
}
