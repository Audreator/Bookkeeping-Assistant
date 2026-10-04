import { and, asc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { budgetEvents } from '../db/schema.ts'
import { nowDateTime, round2, todayISO } from '../util/date.ts'
import { dateString } from './helpers.ts'

const input = z.object({
  at: dateString.optional(),
  mode: z.enum(['month', 'week']),
  monthBudget: z.number().min(0).max(10_000_000),
  weekBudgetOverride: z.number().positive().max(10_000_000).nullable().optional(),
  cycleStartDay: z.number().int().min(1).max(28),
  weekStartsOn: z.union([z.literal(1), z.literal(7)]),
  note: z.string().max(128).optional(),
})

const serialize = (row: typeof budgetEvents.$inferSelect) => ({
  id: row.id,
  at: row.at,
  mode: row.mode,
  monthBudget: row.monthBudget,
  weekBudgetOverride: row.weekBudgetOverride,
  cycleStartDay: row.cycleStartDay,
  weekStartsOn: row.weekStartsOn,
  note: row.note,
  createdAt: row.createdAt,
})

export function registerEventRoutes(app: FastifyInstance) {
  app.get('/api/events', async (request) => {
    const rows = await app.db
      .select()
      .from(budgetEvents)
      .where(eq(budgetEvents.userId, request.userId as number))
      .orderBy(asc(budgetEvents.at), asc(budgetEvents.id))
    return { events: rows.map(serialize) }
  })

  app.post('/api/events', async (request, reply) => {
    const parsed = input.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '预算事件参数错误' })
    const uid = request.userId as number
    const data = parsed.data
    const [result] = await app.db.insert(budgetEvents).values({
      userId: uid,
      at: data.at ?? todayISO(),
      mode: data.mode,
      monthBudget: round2(data.monthBudget),
      weekBudgetOverride:
        data.weekBudgetOverride == null ? null : round2(data.weekBudgetOverride),
      cycleStartDay: data.cycleStartDay,
      weekStartsOn: data.weekStartsOn,
      note: data.note ?? null,
      createdAt: nowDateTime(),
    })
    const rows = await app.db
      .select()
      .from(budgetEvents)
      .where(and(eq(budgetEvents.userId, uid), eq(budgetEvents.id, Number(result.insertId))))
    return reply.code(201).send({ event: serialize(rows[0]) })
  })
}
