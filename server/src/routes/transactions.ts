import { and, desc, eq, gte, inArray, like, lt, lte, or, type SQL } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { billAllocations, billPayments, categories, transactions } from '../db/schema.ts'
import { nowDateTime, round2 } from '../util/date.ts'
import { dateString, isDupEntry, notFound, parseId, stripUndefined, timeString } from './helpers.ts'
import { AllocationError, allocationFailure, allocationInput, lockAllocationUser, replaceAllocations, serializeAllocation, transactionAllocations, validateAllocationBalances } from './fixed-allocations.ts'

async function ensureOwned(
  app: FastifyInstance,
  uid: number,
  kind: 'category' | 'transaction',
  id: number,
): Promise<boolean> {
  if (kind === 'category') {
    const rows = await app.db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.userId, uid), eq(categories.id, id)))
      .limit(1)
    return rows.length > 0
  }
  const rows = await app.db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.userId, uid), eq(transactions.id, id)))
    .limit(1)
  return rows.length > 0
}

const txInput = z.object({
  type: z.enum(['expense', 'refund']),
  amount: z.number().positive().max(100_000_000).refine(n => round2(n) >= 0.01),
  categoryId: z.number().int().positive().nullable().optional(),
  merchant: z.string().max(128).nullable().optional(),
  note: z.string().max(256).nullable().optional(),
  occurredAt: dateString,
  occurredTime: timeString.nullable().optional(),
  source: z.enum(['manual', 'ocr', 'import', 'bank-email']).optional(),
  refundOfId: z.number().int().positive().nullable().optional(),
  status: z.enum(['pending', 'confirmed']).optional(),
  requestId: z.string().trim().min(1).max(128).optional(),
})

const querySchema = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
  q: z.string().max(64).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  type: z.enum(['expense', 'refund']).optional(),
  source: z.enum(['manual', 'ocr', 'import', 'bank-email']).optional(),
  status: z.enum(['pending', 'confirmed']).optional(),
  limit: z.coerce.number().int().min(1).max(20000).optional(),
  pagination: z.literal('id').optional(),
  beforeId: z.coerce.number().int().positive().optional(),
})

export const serializeTransaction = (row: typeof transactions.$inferSelect, fixedAllocations: ReturnType<typeof serializeAllocation>[] = []) => ({
  id: row.id,
  type: row.type,
  amount: row.amount,
  categoryId: row.categoryId,
  merchant: row.merchant,
  note: row.note,
  occurredAt: row.occurredAt,
  occurredTime: row.occurredTime,
  source: row.source,
  refundOfId: row.refundOfId,
  status: row.status,
  createdAt: row.createdAt,
  fixedAllocations,
})

export function registerTransactionRoutes(app: FastifyInstance) {
  app.get('/api/transactions', async (request, reply) => {
    const parsed = querySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: '查询参数错误' })
    const { from, to, q, categoryId, type, source, status, limit, pagination, beforeId } = parsed.data
    if (beforeId && pagination !== 'id') return reply.code(400).send({ error: '游标需配合 pagination=id' })
    const uid = request.userId as number

    const conds: SQL[] = [eq(transactions.userId, uid)]
    if (beforeId) conds.push(lt(transactions.id, beforeId))
    if (from) conds.push(gte(transactions.occurredAt, from))
    if (to) conds.push(lte(transactions.occurredAt, to))
    if (categoryId) conds.push(eq(transactions.categoryId, categoryId))
    if (type) conds.push(eq(transactions.type, type))
    if (source) conds.push(eq(transactions.source, source))
    if (status) conds.push(eq(transactions.status, status))
    if (q) {
      conds.push(
        or(like(transactions.merchant, `%${q}%`), like(transactions.note, `%${q}%`)) as SQL,
      )
    }

    const rows = await app.db
      .select()
      .from(transactions)
      .where(and(...conds))
      .orderBy(...(pagination === 'id' ? [desc(transactions.id)] : [desc(transactions.occurredAt), desc(transactions.occurredTime), desc(transactions.id)]))
      .limit(limit ?? 500)
    const allocations = rows.length ? await app.db.select().from(billAllocations)
      .where(and(eq(billAllocations.userId, uid), inArray(billAllocations.transactionId, rows.map(row => row.id)))) : []
    const byTransaction = new Map<number, ReturnType<typeof serializeAllocation>[]>()
    for (const allocation of allocations) {
      const values = byTransaction.get(allocation.transactionId) ?? []
      values.push(serializeAllocation(allocation))
      byTransaction.set(allocation.transactionId, values)
    }
    return { transactions: rows.map(row => serializeTransaction(row, byTransaction.get(row.id) ?? [])), nextCursor: pagination === 'id' && rows.length === (limit ?? 500) ? rows.at(-1)?.id ?? null : null }
  })

  app.post('/api/transactions', async (request, reply) => {
    const parsed = txInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '交易参数错误' })
    const uid = request.userId as number
    const data = parsed.data
    if (data.categoryId != null && !(await ensureOwned(app, uid, 'category', data.categoryId))) {
      return notFound(reply)
    }
    if (data.refundOfId != null && !(await ensureOwned(app, uid, 'transaction', data.refundOfId))) {
      return notFound(reply)
    }
    const ingestKey = data.requestId ? createHash('sha256').update(`write:${data.requestId}`).digest('hex') : null
    const values = {
      userId: uid,
      type: data.type,
      amount: round2(data.amount),
      categoryId: data.categoryId ?? null,
      merchant: data.merchant ?? null,
      note: data.note ?? null,
      occurredAt: data.occurredAt,
      occurredTime: data.occurredTime ?? null,
      source: data.source ?? 'manual',
      refundOfId: data.refundOfId ?? null,
      status: data.status ?? 'confirmed',
      createdAt: nowDateTime(),
      ingestKey,
    }
    const findExisting = async () => ingestKey ? (await app.db.select().from(transactions)
      .where(and(eq(transactions.userId, uid), eq(transactions.ingestKey, ingestKey))).limit(1))[0] : undefined
    const duplicate = (row: typeof transactions.$inferSelect) => {
      const same = row.type === values.type && row.amount === values.amount &&
        row.occurredAt === values.occurredAt && row.occurredTime === values.occurredTime &&
        row.merchant === values.merchant && row.note === values.note && row.categoryId === values.categoryId &&
        row.source === values.source && row.refundOfId === values.refundOfId && row.status === values.status
      return same ? { transaction: serializeTransaction(row), duplicate: true }
        : reply.code(409).send({ error: '请求 ID 已用于其他交易内容，请核对后重试' })
    }
    const existing = await findExisting()
    if (existing) return duplicate(existing)
    let insertId: number
    try {
      const [result] = await app.db.insert(transactions).values(values)
      insertId = Number(result.insertId)
    } catch (err) {
      if (isDupEntry(err)) {
        const row = await findExisting()
        if (row) return duplicate(row)
      }
      throw err
    }
    const rows = await app.db
      .select()
      .from(transactions)
      .where(and(eq(transactions.userId, uid), eq(transactions.id, insertId)))
    return reply.code(201).send({ transaction: serializeTransaction(rows[0]), duplicate: false })
  })

  app.put('/api/transactions/:id', async (request, reply) => {
    const id = parseId((request.params as { id: string }).id)
    if (!id) return reply.code(400).send({ error: '参数错误' })
    const parsed = txInput.omit({ requestId: true }).partial().safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '交易参数错误' })
    const patch = stripUndefined(parsed.data)
    if (Object.keys(patch).length === 0) return reply.code(400).send({ error: '无更新内容' })
    if (typeof patch.amount === 'number') patch.amount = round2(patch.amount)

    const uid = request.userId as number
    if (patch.categoryId != null && !(await ensureOwned(app, uid, 'category', patch.categoryId))) {
      return notFound(reply)
    }
    if (patch.refundOfId != null && !(await ensureOwned(app, uid, 'transaction', patch.refundOfId))) {
      return notFound(reply)
    }
    try {
      return await app.db.transaction(async connection => {
        await lockAllocationUser(connection, uid)
        const owned = (await connection.select().from(transactions)
          .where(and(eq(transactions.userId, uid), eq(transactions.id, id))).limit(1))[0]
        if (!owned) throw new AllocationError(404, '资源不存在')
        const allocations = await transactionAllocations(connection, uid, id)
        if (allocations.length) {
          if ((patch.type && patch.type !== owned.type) || (patch.status && patch.status !== owned.status)) {
            throw new AllocationError(409, '请先撤销该流水的固定支出分摊，再修改交易类型或确认状态')
          }
          if (typeof patch.amount === 'number' && Math.round(patch.amount * 100) < allocations.reduce((sum, value) => sum + Math.round(value.amount * 100), 0)) {
            throw new AllocationError(409, '流水金额不能低于已有固定支出分摊，请先调整分摊金额')
          }
        }
        await connection.update(transactions).set(patch).where(and(eq(transactions.userId, uid), eq(transactions.id, id)))
        const updated = (await connection.select().from(transactions).where(eq(transactions.id, id)))[0]
        if (allocations.length && patch.occurredAt && patch.occurredAt !== owned.occurredAt) {
          await validateAllocationBalances(connection, uid, id, updated.type, updated.occurredAt,
            allocations.map(value => ({ billId: value.billId, periodKey: value.periodKey, amount: value.amount })))
        }
        return { transaction: serializeTransaction(updated, allocations.map(serializeAllocation)) }
      })
    } catch (error) { return allocationFailure(error, reply) }
  })

  app.put('/api/transactions/:id/fixed-allocations', async (request, reply) => {
    const id = parseId((request.params as { id: string }).id)
    if (!id) return reply.code(400).send({ error: '参数错误' })
    const parsed = allocationInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '分摊参数错误：请选择账单、真实到期日及两位小数的正金额（最多 48 项）' })
    const uid = request.userId as number
    try {
      return await app.db.transaction(async connection => {
        await lockAllocationUser(connection, uid)
        const allocations = await replaceAllocations(connection, uid, id, parsed.data.allocations)
        const tx = (await connection.select().from(transactions).where(eq(transactions.id, id)))[0]
        return { allocations, transaction: serializeTransaction(tx, allocations) }
      })
    } catch (error) { return allocationFailure(error, reply) }
  })

  app.delete('/api/transactions/:id', async (request, reply) => {
    const id = parseId((request.params as { id: string }).id)
    if (!id) return reply.code(400).send({ error: '参数错误' })
    const uid = request.userId as number
    try {
    const removed = await app.db.transaction(async (connection) => {
      await lockAllocationUser(connection, uid)
      const owned = await connection.select({ id: transactions.id }).from(transactions)
        .where(and(eq(transactions.userId, uid), eq(transactions.id, id))).limit(1).for('update')
      if (!owned[0]) return false
      await replaceAllocations(connection, uid, id, [])
      // 删除真实流水也撤销关联与旧支付标记；退款记录仍保留但解除引用。
      await connection.delete(billPayments).where(and(eq(billPayments.userId, uid), eq(billPayments.transactionId, id)))
      await connection.update(transactions).set({ refundOfId: null })
        .where(and(eq(transactions.userId, uid), eq(transactions.refundOfId, id)))
      await connection.delete(transactions).where(and(eq(transactions.userId, uid), eq(transactions.id, id)))
      return true
    })
    if (!removed) return notFound(reply)
    return reply.code(204).send()
    } catch (error) { return allocationFailure(error, reply) }
  })
}
