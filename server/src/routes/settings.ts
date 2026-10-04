import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { settings } from '../db/schema.ts'

export function registerSettingRoutes(app: FastifyInstance) {
  app.get('/api/settings', async (request) => {
    const rows = await app.db
      .select()
      .from(settings)
      .where(eq(settings.userId, request.userId as number))
    const result: Record<string, unknown> = {}
    for (const row of rows) result[row.key] = row.value
    return { settings: result }
  })

  app.put('/api/settings', async (request, reply) => {
    const parsed = z.record(z.string().min(1).max(64), z.unknown()).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '设置参数错误' })
    const uid = request.userId as number
    for (const [key, value] of Object.entries(parsed.data)) {
      await app.db
        .insert(settings)
        .values({ userId: uid, key, value })
        .onDuplicateKeyUpdate({ set: { value } })
    }
    return { ok: true }
  })
}
