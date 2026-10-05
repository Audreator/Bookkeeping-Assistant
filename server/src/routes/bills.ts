import { and, asc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { billAllocations, billPayments, bills, categories, transactions } from '../db/schema.ts'
import { nowDateTime, round2 } from '../util/date.ts'
import { dateString, isDupEntry, isValidDate, notFound, parseId, stripUndefined, timeString } from './helpers.ts'
import { serializeTransaction } from './transactions.ts'
import { AllocationError, allocationFailure, lockAllocationUser, replaceAllocations, serializeAllocation, transactionAllocations } from './fixed-allocations.ts'

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
  // Older backups used month keys. Keep metadata without inventing a due date.
  periodKey: z.string().min(1).max(32),
  paidAt: dateString,
  transactionId: z.number().int().positive().nullable().optional(),
  markerOnly: z.boolean().optional(),
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
    const allocationRows = await app.db.select().from(billAllocations)
      .where(eq(billAllocations.userId, uid)).orderBy(asc(billAllocations.id))
    return { bills: billRows.map(serializeBill), payments: payRows.map(serializePayment), allocations: allocationRows.map(serializeAllocation) }
  })

  app.post('/api/bills', async (request, reply) => {
    const parsed = billInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '固定支出参数错误' })
    const uid = request.userId as number
    const data = parsed.data
    if (data.categoryId != null && !(await app.db.select({ id: categories.id }).from(categories)
      .where(and(eq(categories.id, data.categoryId), eq(categories.userId, uid))).limit(1)).length) return notFound(reply)
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
    if (patch.categoryId != null && !(await app.db.select({ id: categories.id }).from(categories)
      .where(and(eq(categories.id, patch.categoryId), eq(categories.userId, uid))).limit(1)).length) return notFound(reply)
    try {
      return await app.db.transaction(async connection => {
        await lockAllocationUser(connection, uid)
        const owned = (await connection.select().from(bills).where(and(eq(bills.userId, uid), eq(bills.id, id))).limit(1))[0]
        if (!owned) throw new AllocationError(404, '资源不存在')
        await connection.update(bills).set(patch).where(and(eq(bills.userId, uid), eq(bills.id, id)))
        const updated = (await connection.select().from(bills).where(eq(bills.id, id)))[0]
        return { bill: serializeBill(updated) }
      })
    } catch (error) { return allocationFailure(error, reply) }
  })

  app.delete('/api/bills/:id', async (request, reply) => {
    const id = parseId((request.params as { id: string }).id)
    if (!id) return reply.code(400).send({ error: '参数错误' })
    const uid = request.userId as number
    try {
      await app.db.transaction(async connection => {
        await lockAllocationUser(connection, uid)
        const owned = (await connection.select({ id: bills.id }).from(bills).where(and(eq(bills.userId, uid), eq(bills.id, id))).limit(1))[0]
        if (!owned) throw new AllocationError(404, '资源不存在')
        const allocations = await connection.select({ id: billAllocations.id }).from(billAllocations)
          .where(and(eq(billAllocations.userId, uid), eq(billAllocations.billId, id))).limit(1)
        if (allocations.length) throw new AllocationError(409, '该账单仍有关联流水，请先撤销固定支出分摊，或停用账单保留历史记录')
        await connection.delete(bills).where(and(eq(bills.userId, uid), eq(bills.id, id)))
      })
      return reply.code(204).send()
    } catch (error) { return allocationFailure(error, reply) }
  })

  app.post('/api/bills/:id/pay', async (request, reply) => {
    const id = parseId((request.params as { id: string }).id)
    if (!id) return reply.code(400).send({ error: '参数错误' })
    const parsed = z.object({ periodKey: dateString, paidAt: dateString, occurredTime: timeString.nullable().optional() }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '固定支出记账参数错误' })
    const uid = request.userId as number
    const data = parsed.data
    try {
    const outcome = await app.db.transaction(async (connection) => {
      await lockAllocationUser(connection, uid)
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
        const allocations = tx ? (await transactionAllocations(connection, uid, tx.id)).map(serializeAllocation) : []
        return { duplicate: true, payment: serializePayment(row), transaction: tx ? serializeTransaction(tx, allocations) : null }
      }
      const [txResult] = await connection.insert(transactions).values({
        userId: uid, type: 'expense', amount: bill.amount, categoryId: bill.categoryId,
        merchant: bill.name, note: '固定支出', occurredAt: data.paidAt,
        occurredTime: data.occurredTime ?? null, source: 'manual', status: 'confirmed', createdAt: nowDateTime(),
      })
      const transactionId = Number(txResult.insertId)
      const allocations = await replaceAllocations(connection, uid, transactionId, [{ billId: id, periodKey: data.periodKey, amount: bill.amount }])
      const [payResult] = await connection.insert(billPayments).values({ userId: uid, billId: id, periodKey: data.periodKey, paidAt: data.paidAt, transactionId })
      const pay = (await connection.select().from(billPayments).where(eq(billPayments.id, Number(payResult.insertId))))[0]
      const tx = (await connection.select().from(transactions).where(eq(transactions.id, transactionId)))[0]
      return { duplicate: false, payment: serializePayment(pay), transaction: serializeTransaction(tx, allocations) }
    })
    if (!outcome) return notFound(reply)
    return reply.code(outcome.duplicate ? 200 : 201).send(outcome)
    } catch (error) { return allocationFailure(error, reply) }
  })

  app.post('/api/bill-payments', async (request, reply) => {
    const parsed = paymentInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '支付记录参数错误' })
    const uid = request.userId as number
    const data = parsed.data
    try {
      const payment = await app.db.transaction(async connection => {
        await lockAllocationUser(connection, uid)
        const owned = (await connection.select().from(bills)
          .where(and(eq(bills.userId, uid), eq(bills.id, data.billId))).limit(1))[0]
        if (!owned) throw new AllocationError(404, '资源不存在')
        if (data.transactionId != null) {
          const tx = (await connection.select().from(transactions).where(and(eq(transactions.userId, uid), eq(transactions.id, data.transactionId))).limit(1))[0]
          if (!tx) throw new AllocationError(404, '资源不存在')
          const shouldAllocate = !data.markerOnly && isValidDate(data.periodKey) && data.periodKey >= '1000-01-01'
          if (shouldAllocate && tx.type !== 'expense') throw new AllocationError(409, '支付标记只能关联支出，请通过固定支出分摊接口关联退款')
          const current = await transactionAllocations(connection, uid, data.transactionId)
          if (shouldAllocate && !current.some(value => value.billId === data.billId && value.periodKey === data.periodKey)) {
            await replaceAllocations(connection, uid, data.transactionId, [
              ...current.map(value => ({ billId: value.billId, periodKey: value.periodKey, amount: value.amount })),
              { billId: data.billId, periodKey: data.periodKey, amount: owned.amount },
            ])
          }
        }
      const [result] = await connection.insert(billPayments).values({
        userId: uid,
        billId: data.billId,
        periodKey: data.periodKey,
        paidAt: data.paidAt,
        transactionId: data.transactionId ?? null,
      })
      const rows = await connection
        .select()
        .from(billPayments)
        .where(and(eq(billPayments.userId, uid), eq(billPayments.id, Number(result.insertId))))
        return serializePayment(rows[0])
      })
      return reply.code(201).send({ payment })
    } catch (err) {
      if (isDupEntry(err)) return reply.code(409).send({ error: '该账单本期已记录支付' })
      return allocationFailure(err, reply)
    }
  })

  app.delete('/api/bill-payments/:id', async (request, reply) => {
    const id = parseId((request.params as { id: string }).id)
    if (!id) return reply.code(400).send({ error: '参数错误' })
    const uid = request.userId as number
    try {
      await app.db.transaction(async connection => {
        await lockAllocationUser(connection, uid)
        const payment = (await connection.select().from(billPayments)
          .where(and(eq(billPayments.userId, uid), eq(billPayments.id, id))).limit(1))[0]
        if (!payment) throw new AllocationError(404, '资源不存在')
        if (payment.transactionId != null) {
          const tx = (await connection.select({ id: transactions.id }).from(transactions)
            .where(and(eq(transactions.userId, uid), eq(transactions.id, payment.transactionId))).limit(1))[0]
          if (tx) {
            const current = await transactionAllocations(connection, uid, tx.id)
            await replaceAllocations(connection, uid, tx.id, current.filter(value => !(value.billId === payment.billId && value.periodKey === payment.periodKey))
              .map(value => ({ billId: value.billId, periodKey: value.periodKey, amount: value.amount })))
          }
        }
        await connection.delete(billPayments).where(and(eq(billPayments.userId, uid), eq(billPayments.id, id)))
      })
      return reply.code(204).send()
    } catch (error) { return allocationFailure(error, reply) }
  })
}
