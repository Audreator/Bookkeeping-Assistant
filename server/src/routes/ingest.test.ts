// @vitest-environment node
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as dateUtil from '../util/date.ts'
import { buildApp } from '../app.ts'
import { createDb } from '../db/client.ts'
import { runMigrations } from '../db/migrate.ts'
import { transactions } from '../db/schema.ts'
import { env } from '../env.ts'

let app: FastifyInstance
let pool: ReturnType<typeof createDb>['pool']
let db: ReturnType<typeof createDb>['db']

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

const post = (body: unknown, token = 'test-ingest-token') =>
  app.inject({
    method: 'POST',
    url: '/api/ingest/ocr',
    headers: { 'x-ingest-token': token },
    payload: body as object,
  })

beforeAll(async () => {
  const conn = createDb(env.testDatabaseUrl)
  pool = conn.pool
  db = conn.db
  await runMigrations(db)
  await pool.query('SET FOREIGN_KEY_CHECKS=0')
  for (const t of TABLES) await pool.query(`TRUNCATE TABLE \`${t}\``)
  await pool.query('SET FOREIGN_KEY_CHECKS=1')
  app = await buildApp({
    databaseUrl: env.testDatabaseUrl,
    jwtSecret: env.jwtSecret,
    ingestToken: 'test-ingest-token',
    defaultUser: { username: 'ingest_owner', password: 'owner-pass-123' },
  })
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await pool.end()
})

describe('POST /api/ingest/ocr（快捷指令通道）', () => {
  it('识别付款文本并自动入账（来源 ocr）', async () => {
    const res = await post({ text: '微信支付\n付款成功\n收款方\n瑞幸咖啡(国贸店)\n¥35.50' })
    expect(res.statusCode).toBe(201)
    expect(res.json().transaction).toMatchObject({ type: 'expense', amount: 35.5, source: 'ocr' })
  })

  it('同金额同日重复提交判定为 duplicate，不再新增', async () => {
    const res = await post({ text: '微信支付\n付款成功\n收款方\n瑞幸咖啡(国贸店)\n¥35.50' })
    expect(res.statusCode).toBe(200)
    expect(res.json().duplicate).toBe(true)
    expect(await db.select().from(transactions)).toHaveLength(1)
  })

  it('错误令牌 401', async () => {
    expect((await post({ text: '付款成功 ¥1.00' }, 'wrong-token')).statusCode).toBe(401)
  })

  it('无法识别金额 422', async () => {
    expect((await post({ text: '付款成功\n完成' })).statusCode).toBe(422)
  })

  it('退款文本入账为退款', async () => {
    const res = await post({ text: '退款成功\n退款金额 ¥12.00' })
    expect(res.statusCode).toBe(201)
    expect(res.json().transaction).toMatchObject({ type: 'refund', amount: 12 })
  })

  it('支持 text/plain 请求体（快捷指令直接发纯文本）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ingest/ocr',
      headers: { 'x-ingest-token': 'test-ingest-token', 'content-type': 'text/plain' },
      payload: '付款成功 ¥5.00',
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().transaction.amount).toBe(5)
  })

  it('支持表单请求体（字段名 text）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ingest/ocr',
      headers: {
        'x-ingest-token': 'test-ingest-token',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: 'text=' + encodeURIComponent('付款成功 ¥6.00'),
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().transaction.amount).toBe(6)
  })

  it('支持把文本放在 URL 查询参数（?text=，备用通道）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ingest/ocr?text=' + encodeURIComponent('付款成功 ¥8.00'),
      headers: { 'x-ingest-token': 'test-ingest-token' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().transaction.amount).toBe(8)
  })

  it('优先显式日期/秒级时间，其次文本交易时间', async () => {
    const text = '支付成功 ¥17.80\n支付时间 2026-10-03 12:34:56'
    const fromText = await post({ text })
    expect(fromText.statusCode).toBe(201)
    expect(fromText.json().transaction).toMatchObject({ occurredAt: '2026-10-03', occurredTime: '12:34:56' })
    const explicit = await post({ text, date: '2026-10-02', time: '09:08:07' })
    expect(explicit.statusCode).toBe(201)
    expect(explicit.json().transaction).toMatchObject({ occurredAt: '2026-10-02', occurredTime: '09:08:07' })
  })

  it('同金额不同时间、商家或方向各记一笔', async () => {
    const common = { date: '2026-09-30', time: '12:00:01' }
    const a = await post({ ...common, text: '支付成功 ¥19.90\n商户：甲店' })
    const b = await post({ ...common, time: '12:00:02', text: '支付成功 ¥19.90\n商户：甲店' })
    const c = await post({ ...common, text: '支付成功 ¥19.90\n商户：乙店' })
    const d = await post({ ...common, text: '退款成功 ¥19.90\n商户：甲店' })
    expect([a.statusCode, b.statusCode, c.statusCode, d.statusCode]).toEqual([201, 201, 201, 201])
    const again = await post({ ...common, text: '支付成功 ¥19.90\n商户：甲店' })
    expect(again.statusCode).toBe(200)
    expect(again.json().duplicate).toBe(true)
  })

  it('拒绝未成功交易与非法时间', async () => {
    const unknown = await post({ text: '支付成功 ¥13.01', date: '2026-09-29' })
    expect(unknown.json().transaction).toMatchObject({ amount: 13.01, merchant: null })
    expect((await post({ text: '等待付款 ¥14.50' })).statusCode).toBe(422)
    expect((await post({ text: '退款处理中 ¥14.50' })).statusCode).toBe(422)
    expect((await post({ text: '付款成功 ¥14.50', time: '24:00:00' })).statusCode).toBe(400)
  })

  it('查询参数、表单和 JSON 均接收 date/time，并正规化分钟', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/ingest/ocr?date=2026-09-28&time=08%3A09', headers: { 'x-ingest-token': 'test-ingest-token', 'content-type': 'text/plain' }, payload: '支付成功 ¥16.01' })
    expect(res.statusCode).toBe(201)
    expect(res.json().transaction).toMatchObject({ occurredAt: '2026-09-28', occurredTime: '08:09:00' })
  })

  it('结构化通道支持支付和退款，事件 ID 可幂等重试且拒绝冲突', async () => {
    const payload = { type: 'expense', amount: '28.50', date: '2026-09-27', time: '21:20:19', merchant: '书店', eventId: 'bank-event-123' }
    const send = (body: object) => app.inject({ method: 'POST', url: '/api/ingest/transaction', headers: { authorization: 'Bearer test-ingest-token' }, payload: body })
    const res = await send(payload)
    expect(res.statusCode).toBe(201)
    expect(res.json().transaction).toMatchObject({ amount: 28.5, type: 'expense', occurredTime: '21:20:19' })
    expect((await send(payload)).json().duplicate).toBe(true)
    expect((await send({ ...payload, amount: '28.51' })).statusCode).toBe(409)
    expect((await send({ ...payload, type: 'refund', eventId: 'bank-refund-123' })).statusCode).toBe(201)
    expect((await send({ ...payload, amount: '0.001', eventId: 'bad' })).statusCode).toBe(400)
    expect((await send({ ...payload, amount: -1, eventId: 'bad2' })).statusCode).toBe(400)
    expect((await send({ ...payload, time: '25:00:00', eventId: 'bad3' })).statusCode).toBe(400)
  })

  it('同一事件并发重试只新增一次', async () => {
    const responses = await Promise.all(Array.from({ length: 4 }, () => app.inject({ method: 'POST', url: '/api/ingest/transaction', headers: { 'x-ingest-token': 'test-ingest-token' }, payload: { type: 'expense', amount: 39.12, date: '2026-09-26', time: '10:11:12', eventId: 'concurrent-payment' } })))
    expect(responses.filter(r => r.statusCode === 201)).toHaveLength(1)
    expect(responses.filter(r => r.statusCode === 200)).toHaveLength(3)
  })

  it('快捷指令 text 接收通知对象，并按原字段保存时间和未知商家', async () => {
    const res = await post({ text: { title: '银行通知', body: '付款成功 ¥42.13\n支付时间 2026-10-04 19:18:17' } })
    expect(res.statusCode).toBe(201)
    expect(res.json().transaction).toMatchObject({ amount: 42.13, occurredAt: '2026-10-04', occurredTime: '19:18:17', merchant: null })
  })

  it('通知包装与正文字符串重试使用同一语义去重', async () => {
    const body = '付款成功 ¥42.14\n支付时间 2026-10-04 19:18:18'
    expect((await post({ notification: { 标题: '银行通知', 信息: body } })).statusCode).toBe(201)
    const retry = await post({ text: `银行通知\n${body}` })
    expect(retry.statusCode).toBe(200)
    expect(retry.json().duplicate).toBe(true)
  })

  it('通知无法转换时返回具体结构诊断且不泄露原文', async () => {
    const res = await post({ text: { app: '私密名称', payload: 12345 } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('通知正文')
    expect(res.json().inputShape).toMatchObject({ type: 'object', fields: { text: { type: 'object' } } })
    expect(JSON.stringify(res.json())).not.toMatch(/私密名称|12345/)
  })

  it('通知缺时间使用接收时刻，延迟重试保留第一次时间并去重', async () => {
    const clock = vi.spyOn(dateUtil, 'nowDateTime').mockReturnValue('2026-10-04 23:20:01')
    try {
      const payload = { text: '支付成功 ¥52.41', date: '2026-10-04' }
      const first = await post(payload)
      expect(first.statusCode).toBe(201)
      expect(first.json().transaction.occurredTime).toBe('23:20:01')
      clock.mockReturnValue('2026-10-04 23:20:59')
      const retry = await post(payload)
      expect(retry.statusCode).toBe(200)
      expect(retry.json().transaction.occurredTime).toBe('23:20:01')
    } finally { clock.mockRestore() }
  })

  it('缺时间的事件 ID 重试不因当前秒变化返回冲突', async () => {
    const clock = vi.spyOn(dateUtil, 'nowDateTime').mockReturnValue('2026-10-04 23:21:01')
    try {
      const payload = { text: '支付成功 ¥52.42', date: '2026-10-04', eventId: 'received-time-event' }
      expect((await post(payload)).statusCode).toBe(201)
      clock.mockReturnValue('2026-10-04 23:21:59')
      const retry = await post(payload)
      expect(retry.statusCode).toBe(200)
      expect(retry.json().transaction.occurredTime).toBe('23:21:01')
    } finally { clock.mockRestore() }
  })

  it('无消息日期的事件 ID 跨午夜重试保留第一次接收日期时间', async () => {
    const clock = vi.spyOn(dateUtil, 'nowDateTime').mockReturnValue('2026-10-04 23:59:59')
    try {
      const payload = { text: '付款成功 ¥52.43', eventId: 'midnight-event' }
      expect((await post(payload)).statusCode).toBe(201)
      clock.mockReturnValue('2026-10-05 00:00:01')
      const retry = await post(payload)
      expect(retry.statusCode).toBe(200)
      expect(retry.json().transaction).toMatchObject({ occurredAt: '2026-10-04', occurredTime: '23:59:59' })
    } finally { clock.mockRestore() }
  })

  it('真实匿名银行通知按消息时间优先、无时间用接收时刻，商家留空', async () => {
    const clock = vi.spyOn(dateUtil, 'nowDateTime').mockReturnValue('2026-10-04 23:30:01')
    try {
      const rural = await post({ text: { title: '动账通知', message: '您尾号1234的账户出账 网联支出1.23元，点此查看详情' } })
      expect(rural.statusCode).toBe(201)
      expect(rural.json().transaction).toMatchObject({ type: 'expense', amount: 1.23, merchant: null, occurredAt: '2026-10-04', occurredTime: '23:30:01' })
      const cmb = await post({ text: '您账户1234于10月04日22:45在【财付通-微信支付-微信零钱充值账户】发生快捷支付扣款，人民币1.23' })
      expect(cmb.statusCode).toBe(201)
      expect(cmb.json().transaction).toMatchObject({ type: 'expense', amount: 1.23, merchant: null, occurredAt: '2026-10-04', occurredTime: '22:45:00' })
      const credited = await post({ text: '您尾号1234的账户网联 入账收入1.23元，点此查看详情' })
      expect(credited.statusCode).toBe(201)
      expect(credited.json().transaction).toMatchObject({ type: 'refund', amount: 1.23, merchant: null })
      const creditedNoTime = await post({ text: '您尾号1234的账户入账人民币1.23元' })
      expect(creditedNoTime.statusCode).toBe(201)
      expect(creditedNoTime.json().transaction).toMatchObject({ type: 'refund', amount: 1.23, merchant: null, occurredAt: '2026-10-04', occurredTime: '23:30:01' })
    } finally { clock.mockRestore() }
  })

  it('结构化接口缺省日期时间的事件 ID 跨午夜重试保留首次时刻', async () => {
    const clock = vi.spyOn(dateUtil, 'nowDateTime').mockReturnValue('2026-10-04 23:59:58')
    const day = vi.spyOn(dateUtil, 'todayISO').mockReturnValue('2026-10-04')
    try {
      const payload = { type: 'expense', amount: '52.44', eventId: 'structured-midnight-event' }
      const send = () => app.inject({ method: 'POST', url: '/api/ingest/transaction', headers: { 'x-ingest-token': 'test-ingest-token' }, payload })
      expect((await send()).statusCode).toBe(201)
      clock.mockReturnValue('2026-10-05 00:00:02')
      day.mockReturnValue('2026-10-05')
      const retry = await send()
      expect(retry.statusCode).toBe(200)
      expect(retry.json().transaction).toMatchObject({ occurredAt: '2026-10-04', occurredTime: '23:59:58' })
    } finally { clock.mockRestore(); day.mockRestore() }
  })
})
