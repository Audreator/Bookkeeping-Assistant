import { and, asc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { categories, transactions } from '../db/schema.ts'
import { isDupEntry, notFound, parseId, stripUndefined } from './helpers.ts'

const input = z.object({
  name: z.string().min(1).max(32),
  icon: z.string().max(16).optional(),
  color: z.string().max(16).optional(),
  sort: z.number().int().min(0).max(9999).optional(),
  type: z.string().max(16).optional(),
})

const serialize = (row: typeof categories.$inferSelect) => ({
  id: row.id,
  name: row.name,
  icon: row.icon,
  color: row.color,
  sort: row.sort,
  type: row.type,
})

export function registerCategoryRoutes(app: FastifyInstance) {
  app.get('/api/categories', async (request) => {
    const rows = await app.db
      .select()
      .from(categories)
      .where(eq(categories.userId, request.userId as number))
      .orderBy(asc(categories.sort), asc(categories.id))
    return { categories: rows.map(serialize) }
  })

  app.post('/api/categories', async (request, reply) => {
    const parsed = input.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '分类参数错误' })
    const uid = request.userId as number
    try {
      const [result] = await app.db.insert(categories).values({
        userId: uid,
        name: parsed.data.name,
        icon: parsed.data.icon ?? '',
        color: parsed.data.color ?? '#64748b',
        sort: parsed.data.sort ?? 0,
        type: parsed.data.type ?? 'expense',
      })
      const rows = await app.db
        .select()
        .from(categories)
        .where(and(eq(categories.userId, uid), eq(categories.id, Number(result.insertId))))
      return reply.code(201).send({ category: serialize(rows[0]) })
    } catch (err) {
      if (isDupEntry(err)) return reply.code(409).send({ error: '分类名已存在' })
      throw err
    }
  })

  app.put('/api/categories/:id', async (request, reply) => {
    const id = parseId((request.params as { id: string }).id)
    if (!id) return reply.code(400).send({ error: '参数错误' })
    const parsed = input.partial().safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '分类参数错误' })
    const patch = stripUndefined(parsed.data)
    if (Object.keys(patch).length === 0) return reply.code(400).send({ error: '无更新内容' })
    const uid = request.userId as number
    try {
      const [result] = await app.db
        .update(categories)
        .set(patch)
        .where(and(eq(categories.userId, uid), eq(categories.id, id)))
      if (result.affectedRows === 0) return notFound(reply)
      const rows = await app.db
        .select()
        .from(categories)
        .where(and(eq(categories.userId, uid), eq(categories.id, id)))
      return { category: serialize(rows[0]) }
    } catch (err) {
      if (isDupEntry(err)) return reply.code(409).send({ error: '分类名已存在' })
      throw err
    }
  })

  app.delete('/api/categories/:id', async (request, reply) => {
    const id = parseId((request.params as { id: string }).id)
    if (!id) return reply.code(400).send({ error: '参数错误' })
    const uid = request.userId as number
    const used = await app.db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.userId, uid), eq(transactions.categoryId, id)))
      .limit(1)
    if (used.length > 0) {
      return reply.code(409).send({ error: '该分类下还有交易，不能删除' })
    }
    const [result] = await app.db
      .delete(categories)
      .where(and(eq(categories.userId, uid), eq(categories.id, id)))
    if (result.affectedRows === 0) return notFound(reply)
    return reply.code(204).send()
  })
}
