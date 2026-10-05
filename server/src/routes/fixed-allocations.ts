import { and, eq } from 'drizzle-orm'
import type { FastifyReply } from 'fastify'
import { z } from 'zod'
import type { DB } from '../db/client.ts'
import { billAllocations, billPayments, bills, transactions, users } from '../db/schema.ts'
import { dateString } from './helpers.ts'

export type Connection = Parameters<Parameters<DB['transaction']>[0]>[0]
export type AllocationInput = { billId: number; periodKey: string; amount: number }
export const allocationInput = z.object({
  allocations: z.array(z.object({
    billId: z.number().int().positive(),
    periodKey: dateString.refine(value => value >= '1000-01-01'),
    amount: z.number().finite().positive().max(100_000_000)
      .refine(value => Number(value.toFixed(2)) === value, '金额最多两位小数'),
  })).max(48),
})
export const serializeAllocation = (row: typeof billAllocations.$inferSelect) => ({
  id: row.id, transactionId: row.transactionId, billId: row.billId,
  periodKey: row.periodKey, amount: row.amount,
})

export class AllocationError extends Error {
  statusCode: number
  constructor(statusCode: number, message: string) { super(message); this.statusCode = statusCode }
}
export const allocationFailure = (error: unknown, reply: FastifyReply) => {
  if (!(error instanceof AllocationError)) throw error
  return reply.code(error.statusCode).send({ error: error.message })
}

/** Every allocation-affecting write locks the owner first, including legacy routes. */
export async function lockAllocationUser(connection: Connection, userId: number) {
  const rows = await connection.select({ id: users.id }).from(users)
    .where(eq(users.id, userId)).limit(1).for('update')
  if (!rows.length) throw new AllocationError(404, '资源不存在')
}

export async function transactionAllocations(connection: Connection, userId: number, transactionId: number) {
  return connection.select().from(billAllocations)
    .where(and(eq(billAllocations.userId, userId), eq(billAllocations.transactionId, transactionId)))
}

/** Read all occurrence balances under the owner lock; refund allocation may never exceed payments. */
export async function validateAllocationBalances(connection: Connection, userId: number, transactionId: number,
  type: 'expense' | 'refund', occurredAt: string, replacement: AllocationInput[]) {
  const existing = await connection.select({ allocation: billAllocations, type: transactions.type, occurredAt: transactions.occurredAt })
    .from(billAllocations).innerJoin(transactions, eq(transactions.id, billAllocations.transactionId))
    .where(eq(billAllocations.userId, userId))
  const balances = new Map<string, Map<string, number>>()
  const add = (billId: number, periodKey: string, amount: number, sign: number, date: string) => {
    const key = `${billId}:${periodKey}`
    const days = balances.get(key) ?? new Map<string, number>()
    days.set(date, (days.get(date) ?? 0) + Math.round(amount * 100) * sign)
    balances.set(key, days)
  }
  for (const value of existing) if (value.allocation.transactionId !== transactionId) {
    add(value.allocation.billId, value.allocation.periodKey, value.allocation.amount, value.type === 'expense' ? 1 : -1, value.occurredAt)
  }
  for (const value of replacement) add(value.billId, value.periodKey, value.amount, type === 'expense' ? 1 : -1, occurredAt)
  const invalid = [...balances.values()].some(days => {
    let balance = 0
    for (const [, amount] of [...days.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      balance += amount
      if (balance < 0) return true
    }
    return false
  })
  if (invalid) {
    throw new AllocationError(409, type === 'refund'
      ? '退款分摊超过退款当日该账单期次的已付未退金额，请核对付款日期、账单与到期日'
      : '该付款已有关联的退款分摊，请先撤销对应退款分摊')
  }
}

/** Caller must hold the owner lock. Full replacement is atomic and safe to retry. */
export async function replaceAllocations(connection: Connection, userId: number, transactionId: number,
  replacement: AllocationInput[]) {
  if (!allocationInput.safeParse({ allocations: replacement }).success) throw new AllocationError(400, '分摊金额、到期日或项目数量无效')
  const tx = (await connection.select().from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.id, transactionId))).limit(1))[0]
  if (!tx) throw new AllocationError(404, '资源不存在')
  if (replacement.length && tx.status !== 'confirmed') throw new AllocationError(409, '请先确认该流水，再关联固定支出')
  const unique = new Set(replacement.map(value => `${value.billId}:${value.periodKey}`))
  if (unique.size !== replacement.length) throw new AllocationError(400, '同一账单与到期日不能重复分摊')
  if (replacement.reduce((sum, value) => sum + Math.round(value.amount * 100), 0) > Math.round(tx.amount * 100)) {
    throw new AllocationError(400, '固定支出分摊总额不能超过原流水金额')
  }
  if (replacement.length) {
    const owned = new Set((await connection.select({ id: bills.id }).from(bills).where(eq(bills.userId, userId))).map(value => value.id))
    if (replacement.some(value => !owned.has(value.billId))) throw new AllocationError(404, '资源不存在')
  }
  await validateAllocationBalances(connection, userId, transactionId, tx.type, tx.occurredAt, replacement)
  // A legacy paid marker must not survive after its linked occurrence is unassigned.
  const markers = await connection.select().from(billPayments)
    .where(and(eq(billPayments.userId, userId), eq(billPayments.transactionId, transactionId)))
  for (const marker of markers) if (!replacement.some(value => value.billId === marker.billId && value.periodKey === marker.periodKey)) {
    await connection.delete(billPayments).where(and(eq(billPayments.userId, userId), eq(billPayments.id, marker.id)))
  }
  await connection.delete(billAllocations)
    .where(and(eq(billAllocations.userId, userId), eq(billAllocations.transactionId, transactionId)))
  if (replacement.length) await connection.insert(billAllocations).values(replacement.map(value => ({
    userId, transactionId, billId: value.billId, periodKey: value.periodKey, amount: value.amount,
  })))
  return (await transactionAllocations(connection, userId, transactionId)).map(serializeAllocation)
}
