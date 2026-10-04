import { and, asc, eq } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { createHash, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { transactions, users } from '../db/schema.ts'
import { parsePaymentText } from '../ingest/payment.ts'
import { describeInput, extractNotificationText } from '../ingest/notification.ts'
import { nowDateTime, round2 } from '../util/date.ts'
import { dateString, isDupEntry, timeString } from './helpers.ts'

export interface IngestOptions {
  token?: string
  /** 单用户默认选第一个账号；多用户部署必须明确配置。 */
  userId?: number
}

const metaInput = {
  date: dateString.optional(),
  time: timeString.optional(),
  eventId: z.string().trim().min(1).max(128).optional(),
}
const textInput = z.object({ text: z.preprocess(extractNotificationText, z.string().trim().min(1).max(5000)), ...metaInput })
const amountInput = z.union([
  z.number().finite(),
  z.string().trim().regex(/^\d+(?:\.\d{1,2})?$/).transform(Number),
]).refine(n => n >= 0.01 && n <= 100_000_000 && Math.abs(n * 100 - Math.round(n * 100)) < 0.000001)
const transactionInput = z.object({
  type: z.enum(['expense', 'refund']),
  amount: amountInput,
  merchant: z.string().trim().max(128).optional(),
  note: z.string().trim().max(256).optional(),
  ...metaInput,
})

type PaymentInput = {
  type: 'expense' | 'refund'
  amount: number
  merchant: string
  occurredAt: string
  occurredTime: string | null
  /** 去重使用来源时间；接收时刻不参与指纹，避免重试变成新交易。 */
  identityTime?: string | null
  /** 有事件 ID 时，只对比来源日期，缺省接收日期不产生午夜冲突。 */
  identityDate?: string | null
  eventId?: string
  text?: string
  note?: string
}
const normalize = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim()
const digest = (s: string) => createHash('sha256').update(s).digest('hex')
const publicTx = (row: typeof transactions.$inferSelect) => ({
  id: row.id, type: row.type, amount: row.amount, merchant: row.merchant,
  occurredAt: row.occurredAt, occurredTime: row.occurredTime, source: row.source,
})

export function registerIngestRoutes(app: FastifyInstance, opts: IngestOptions) {
  const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!opts.token) return reply.code(503).send({ error: '服务器未配置 INGEST_TOKEN' })
    const supplied = request.headers['x-ingest-token'] ??
      (request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : undefined)
    if (typeof supplied !== 'string') return reply.code(401).send({ error: '令牌无效' })
    const expected = Buffer.from(opts.token)
    const actual = Buffer.from(supplied)
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return reply.code(401).send({ error: '令牌无效' })
    }
  }

  const save = async (payment: PaymentInput, reply: FastifyReply) => {
    const owner = await app.db.select({ id: users.id }).from(users)
      .where(opts.userId ? eq(users.id, opts.userId) : undefined).orderBy(asc(users.id)).limit(1)
    const userId = owner[0]?.id
    if (!userId) return reply.code(503).send({ error: '没有可用账号' })
    const amount = round2(payment.amount)
    const merchant = normalize(payment.merchant)
    const identityTime = payment.identityTime === undefined ? payment.occurredTime : payment.identityTime
    const identityDate = payment.identityDate === undefined ? payment.occurredAt : payment.identityDate
    const identity = [payment.type, amount.toFixed(2), payment.occurredAt, identityTime, merchant]
    // 有交易时间时按语义去重；无时间时加入完整文本，避免把不同截图同金额误合并。
    const ingestKey = digest(payment.eventId ? `event:${payment.eventId}` : JSON.stringify([
      ...identity, identityTime ? '' : normalize(payment.text ?? ''),
    ]))
    const lookup = async () => (await app.db.select().from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.ingestKey, ingestKey))).limit(1))[0]
    const duplicate = (row: typeof transactions.$inferSelect) => {
      if (payment.eventId && (row.type !== payment.type || row.amount !== amount || (identityDate !== null && row.occurredAt !== identityDate) || (identityTime !== null && row.occurredTime !== identityTime) || normalize(row.merchant ?? '') !== merchant)) {
        console.log('[入账] 事件 ID 内容冲突')
        return reply.code(409).send({ error: '事件 ID 已用于另一笔记录，请核对原交易参数' })
      }
      console.log(`[入账] 重复已跳过 · ${payment.occurredAt} ${payment.occurredTime ?? '时间未记录'}`)
      return { duplicate: true, message: '已存在这笔记录，已去重', transaction: publicTx(row) }
    }
    const existing = await lookup()
    if (existing) return duplicate(existing)
    try {
      const [result] = await app.db.insert(transactions).values({
        userId, type: payment.type, amount, merchant: merchant || null,
        note: payment.note || '快捷指令入账', occurredAt: payment.occurredAt,
        occurredTime: payment.occurredTime, ingestKey, source: 'ocr',
        status: 'confirmed', createdAt: nowDateTime(),
      })
      console.log(`[入账] 已写入 ${payment.type === 'refund' ? '退款' : '支出'} ¥${amount.toFixed(2)} · ${payment.occurredAt} ${payment.occurredTime ?? '时间未记录'}`)
      return reply.code(201).send({
        duplicate: false, message: `已入账：${payment.type === 'refund' ? '退款' : '支出'} ¥${amount.toFixed(2)}`,
        transaction: { id: Number(result.insertId), type: payment.type, amount, merchant: merchant || null, occurredAt: payment.occurredAt, occurredTime: payment.occurredTime, source: 'ocr' },
      })
    } catch (err) {
      // 数据库唯一约束是并发重试的最终防线。
      if (isDupEntry(err)) {
        const row = await lookup()
        if (row) return duplicate(row)
      }
      throw err
    }
  }

  app.post('/api/ingest/ocr', { preHandler: authenticate }, async (request, reply) => {
    const receivedAt = nowDateTime()
    const query = request.query as Record<string, unknown>
    const body = typeof request.body === 'string' ? { text: request.body } : request.body
    const input = { ...query, ...(typeof body === 'object' && body !== null ? body : {}) } as Record<string, unknown>
    const inputShape = describeInput(input)
    console.log('[入账] 输入结构 ' + JSON.stringify(inputShape))
    const parsed = textInput.safeParse({ ...input, text: input.text ?? input.notification ?? input.通知 })
    if (!parsed.success) return reply.code(400).send({
      error: '参数错误：text 需为通知正文文本或包含 title/body/message/信息的通知对象；date 为 YYYY-MM-DD，time 为 HH:mm:ss',
      inputShape,
      invalidFields: [...new Set(parsed.error.issues.map(issue => issue.path.join('.')))],
    })
    const payment = parsePaymentText(parsed.data.text, parsed.data.date ?? receivedAt.slice(0, 10))
    if (!payment) {
      console.log(`[入账] 文本未匹配已完成支付/退款（${parsed.data.text.length} 字）`)
      return reply.code(422).send({ error: '未识别到明确完成的支付或退款及唯一金额，请检查原交易状态' })
    }
    const sourceTime = parsed.data.time ?? payment.occurredTime ?? null
    return save({
      ...payment, occurredAt: parsed.data.date ?? payment.occurredAt ?? receivedAt.slice(0, 10),
      identityDate: parsed.data.date ?? payment.occurredAt ?? null,
      occurredTime: sourceTime ?? receivedAt.slice(11, 19), identityTime: sourceTime,
      eventId: parsed.data.eventId, text: parsed.data.text,
    }, reply)
  })

  app.post('/api/ingest/transaction', { preHandler: authenticate }, async (request, reply) => {
    const receivedAt = nowDateTime()
    const parsed = transactionInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '参数错误，需明确支出/退款、正数金额及有效日期时间' })
    const data = parsed.data
    return save({
      type: data.type, amount: data.amount, merchant: data.merchant ?? '', note: data.note,
      occurredAt: data.date ?? receivedAt.slice(0, 10), occurredTime: data.time ?? receivedAt.slice(11, 19),
      identityDate: data.date ?? null, identityTime: data.time ?? null, eventId: data.eventId,
    }, reply)
  })
}
