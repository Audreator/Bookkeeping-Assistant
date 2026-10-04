import { and, desc, eq } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import type { DB } from '../db/client.ts'
import { emailReceipts, transactions } from '../db/schema.ts'
import { isDupEntry } from '../routes/helpers.ts'
import { formatDateTime, nowDateTime, round2, todayISO } from '../util/date.ts'
import { parseBankEmail } from './parse.ts'

export interface RawEmail {
  messageId: string
  from: string
  subject: string
  text: string
  date: Date
}
export type ReceiptStatus = 'parsed' | 'refund' | 'ignored' | 'unrecognized' | 'duplicate' | 'error'
export interface ProcessOutcome {
  status: ReceiptStatus
  transactionId?: number
  reason?: string
}

/** 收据与交易在同一事务中提交；唯一 Message-ID 冲突时整笔回滚。 */
export async function processRawEmail(db: DB, userId: number, raw: RawEmail): Promise<ProcessOutcome> {
  const fallback = createHash('sha256').update(JSON.stringify([
    raw.from, raw.subject, raw.text, raw.date.toISOString(),
  ])).digest('hex')
  const messageId = (raw.messageId || `no-id-${fallback}`).slice(0, 255)
  const receipt = {
    userId, messageId, fromAddr: raw.from.slice(0, 255), subject: raw.subject.slice(0, 255),
    receivedAt: formatDateTime(raw.date), rawText: raw.text.slice(0, 60_000), createdAt: nowDateTime(),
  }
  try {
    return await db.transaction(async (connection) => {
      const existing = await connection.select({ id: emailReceipts.id }).from(emailReceipts)
        .where(and(eq(emailReceipts.userId, userId), eq(emailReceipts.messageId, messageId))).limit(1)
      if (existing.length > 0) return { status: 'duplicate' }

      const parsed = parseBankEmail({ from: raw.from, subject: raw.subject, text: raw.text, date: raw.date })
      if (parsed.kind === 'ignore' || parsed.amount === null) {
        const status: ReceiptStatus = parsed.reason.includes('未解析出金额') ? 'unrecognized' : 'ignored'
        await connection.insert(emailReceipts).values({ ...receipt, status, note: parsed.reason })
        return { status, reason: parsed.reason }
      }

      let categoryId: number | null = null
      if (parsed.merchant) {
        const rows = await connection.select({ categoryId: transactions.categoryId }).from(transactions)
          .where(and(eq(transactions.userId, userId), eq(transactions.merchant, parsed.merchant)))
          .orderBy(desc(transactions.id)).limit(1)
        categoryId = rows[0]?.categoryId ?? null
      }
      const [result] = await connection.insert(transactions).values({
        userId, type: parsed.kind, amount: round2(parsed.amount), categoryId,
        merchant: parsed.merchant || null,
        note: `邮件自动记账${parsed.cardTail ? ` · 卡尾号${parsed.cardTail}` : ''}`,
        occurredAt: parsed.occurredAt ?? todayISO(), occurredTime: parsed.occurredTime,
        source: 'bank-email', status: 'confirmed', createdAt: nowDateTime(),
      })
      const transactionId = Number(result.insertId)
      const status = parsed.kind === 'refund' ? 'refund' : 'parsed'
      await connection.insert(emailReceipts).values({ ...receipt, status, transactionId, note: parsed.reason })
      return { status, transactionId, reason: parsed.reason }
    })
  } catch (err) {
    if (isDupEntry(err)) return { status: 'duplicate' }
    const note = err instanceof Error ? err.message.slice(0, 255) : '未知错误'
    try {
      await db.insert(emailReceipts).values({ ...receipt, status: 'error', note })
    } catch (receiptError) {
      if (isDupEntry(receiptError)) return { status: 'duplicate' }
    }
    return { status: 'error', reason: note }
  }
}
