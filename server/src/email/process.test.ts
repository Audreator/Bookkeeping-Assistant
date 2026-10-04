// @vitest-environment node
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/client.ts'
import { runMigrations } from '../db/migrate.ts'
import { categories, emailReceipts, transactions, users } from '../db/schema.ts'
import { env } from '../env.ts'
import { processRawEmail } from './process.ts'

let pool: ReturnType<typeof createDb>['pool']
let db: ReturnType<typeof createDb>['db']
let userId = 0

const TABLES = [
  'email_receipts',
  'bill_payments',
  'transactions',
  'bills',
  'budget_events',
  'day_overrides',
  'categories',
  'settings',
  'users',
]

const raw = (over: Partial<Parameters<typeof processRawEmail>[2]> = {}) => ({
  messageId: 'msg-1@cmb',
  from: 'notify@message.cmbchina.com',
  subject: '账户变动通知',
  text: '您账户末四位1234于2026年10月04日发生一笔支出，金额人民币35.50元，商户名称：瑞幸咖啡。【招商银行】',
  date: new Date(2026, 9, 4, 12, 30),
  ...over,
})

beforeAll(async () => {
  const conn = createDb(env.testDatabaseUrl)
  pool = conn.pool
  db = conn.db
  await runMigrations(db)
  await pool.query('SET FOREIGN_KEY_CHECKS=0')
  for (const t of TABLES) await pool.query(`TRUNCATE TABLE \`${t}\``)
  await pool.query('SET FOREIGN_KEY_CHECKS=1')
  const [res] = await db.insert(users).values({
    username: 'email_owner',
    passwordHash: 'x',
    displayName: 'email_owner',
    createdAt: '2026-10-04 00:00:00',
  })
  userId = Number(res.insertId)
})

afterAll(async () => {
  await pool.end()
})

describe('processRawEmail', () => {
  it('消费邮件：写入交易（来源 bank-email）并记录收据', async () => {
    const outcome = await processRawEmail(db, userId, raw())
    expect(outcome.status).toBe('parsed')
    const txs = await db.select().from(transactions).where(eq(transactions.userId, userId))
    expect(txs).toHaveLength(1)
    expect(txs[0]).toMatchObject({ type: 'expense', amount: 35.5, occurredAt: '2026-10-04', source: 'bank-email' })
    const receipts = await db.select().from(emailReceipts).where(eq(emailReceipts.userId, userId))
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ messageId: 'msg-1@cmb', status: 'parsed' })
  })

  it('同 Message-ID 重复处理：只记一次，第二次为 duplicate', async () => {
    const again = await processRawEmail(db, userId, raw())
    expect(again.status).toBe('duplicate')
    expect(await db.select().from(transactions).where(eq(transactions.userId, userId))).toHaveLength(1)
  })

  it('退款邮件：写入退款交易', async () => {
    const outcome = await processRawEmail(
      db,
      userId,
      raw({
        messageId: 'msg-2@cmb',
        text: '您账户末四位1234于2026年10月06日收到一笔退款人民币35.50元，商户名称：瑞幸咖啡。【招商银行】',
      }),
    )
    expect(outcome.status).toBe('refund')
    const txs = await db.select().from(transactions).where(eq(transactions.userId, userId))
    expect(txs.some((t) => t.type === 'refund' && t.amount === 35.5)).toBe(true)
  })

  it('自动按历史商家匹配分类', async () => {
    await db.insert(categories).values({ userId, name: '咖啡测试', icon: '☕', color: '#000', sort: 1, type: 'expense' })
    const cat = await db.select().from(categories).where(eq(categories.userId, userId))
    const catId = cat[0].id
    await db.update(transactions).set({ categoryId: catId }).where(eq(transactions.merchant, '瑞幸咖啡'))
    const outcome = await processRawEmail(
      db,
      userId,
      raw({ messageId: 'msg-3@cmb', text: '您账户末四位1234于2026年10月07日发生一笔支出，金额人民币20.00元，商户名称：瑞幸咖啡。【招商银行】' }),
    )
    expect(outcome.status).toBe('parsed')
    const latest = await db.select().from(transactions).where(eq(transactions.amount, 20))
    expect(latest[0].categoryId).toBe(catId)
  })

  it('收入类邮件：不写交易，收据为 ignored', async () => {
    const outcome = await processRawEmail(
      db,
      userId,
      raw({ messageId: 'msg-4@cmb', text: '您账户于10月08日发生一笔转入，金额人民币500.00元，摘要：工资。【招商银行】' }),
    )
    expect(outcome.status).toBe('ignored')
    expect(await db.select().from(transactions).where(eq(transactions.amount, 500))).toHaveLength(0)
  })

  it('保存银行文本原交易时间而不是邮件到达时间', async () => {
    const outcome = await processRawEmail(db, userId, raw({ messageId: 'timed@cmb', text: '您账户于2026年10月04日12:34:56发生一笔支出，金额人民币18.92元。【招商银行】' }))
    expect(outcome.status).toBe('parsed')
    const rows = await db.select().from(transactions).where(eq(transactions.id, outcome.transactionId!))
    expect(rows[0]).toMatchObject({ occurredAt: '2026-10-04', occurredTime: '12:34:56' })
  })

  it('相同 Message-ID 并发处理只写一笔交易', async () => {
    const outcomes = await Promise.all(Array.from({ length: 4 }, () => processRawEmail(db, userId, raw({ messageId: 'parallel@cmb', text: '您账户于2026年10月04日发生一笔支出，金额人民币23.45元。【招商银行】' }))))
    expect(outcomes.filter(o => o.status === 'parsed')).toHaveLength(1)
    expect(outcomes.filter(o => o.status === 'duplicate')).toHaveLength(3)
    expect(await db.select().from(transactions).where(eq(transactions.amount, 23.45))).toHaveLength(1)
  })
})
