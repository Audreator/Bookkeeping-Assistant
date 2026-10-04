import { and, asc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { dayOverrides } from '../db/schema.ts'
import { nowDateTime, round2 } from '../util/date.ts'
import { dateString, notFound, parseId } from './helpers.ts'

const input = z.object({
  date: dateString,
  amount: z.number().positive().max(10_000_000),
  note: z.string().max(128).optional(),
})

const serialize = (row: typeof dayOverrides.$inferSelect) => ({
  id: row.id,
  date: row.date,
  amount: row.amount,
  note: row.note,
})

export function registerDayOverrideRoutes(app: FastifyInstance) {
  app.get('/api/day-overrides', async (request) => {
    const rows = await app.db
      .select()
      .from(dayOverrides)
      .where(eq(dayOverrides.userId, request.userId as number))
      .orderBy(asc(dayOverrides.date), asc(dayOverrides.id))
    return { overrides: rows.map(serialize) }
  })

  app.put('/api/day-overrides', async (request, reply) => {
    const parsed = input.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '单独预算参数错误' })
    const uid = request.userId as number
    const { date, amount, note } = parsed.data

    await app.db
      .insert(dayOverrides)
      .values({ userId: uid, date, amount: round2(amount), note: note ?? null, createdAt: nowDateTime() })
      .onDuplicateKeyUpdate({ set: { amount: round2(amount), note: note ?? null } })

    const rows = await app.db
      .select()
      .from(dayOverrides)
      .where(and(eq(dayOverrides.userId, uid), eq(dayOverrides.date, date)))
    return { override: serialize(rows[0]) }
  })

  app.delete('/api/day-overrides/:id', async (request, reply) => {
    const id = parseId((request.params as { id: string }).id)
    if (!id) return reply.code(400).send({ error: '参数错误' })
    const uid = request.userId as number
    const [result] = await app.db
      .delete(dayOverrides)
      .where(and(eq(dayOverrides.userId, uid), eq(dayOverrides.id, id)))
    if (result.affectedRows === 0) return notFound(reply)
    return reply.code(204).send()
  })
}
