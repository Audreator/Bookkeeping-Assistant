// @vitest-environment node
import type { FastifyInstance } from 'fastify'
import { SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { buildApp } from './app.ts'
import { createDb } from './db/client.ts'
import { runMigrations } from './db/migrate.ts'
import { budgetEvents, categories, settings, users } from './db/schema.ts'
import { env } from './env.ts'
import { prehashPassword } from './util/password.ts'

let app: FastifyInstance
let pool: ReturnType<typeof createDb>['pool']
let db: ReturnType<typeof createDb>['db']

const TABLES = [
  'bill_allocations',
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
    allowRegistration: true,
    defaultUser: { username: 'fixed_owner', password: 'owner-pass-123' },
  })
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await pool.end()
})

const register = (username: string, password = 'secret123', extra: object = {}) =>
  app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: prehashPassword(password), ...extra },
  })

describe('健康检查', () => {
  it('GET /api/health 返回 ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })
})

describe('注册 / 登录 / 鉴权', () => {
  it('注册成功返回 token 并自动种子分类、初始预算事件、设置', async () => {
    const res = await register('alice')
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.token).toBeTruthy()
    expect(body.user.username).toBe('alice')

    const userId = body.user.id as number
    expect(await db.select().from(categories).where(eq(categories.userId, userId))).toHaveLength(12)
    expect(await db.select().from(budgetEvents).where(eq(budgetEvents.userId, userId))).toHaveLength(1)
    expect(await db.select().from(settings).where(eq(settings.userId, userId))).toHaveLength(2)
  })

  it('可自定义初始月预算与周期起始日', async () => {
    const res = await register('bob', 'secret123', { monthBudget: 5200, cycleStartDay: 25 })
    expect(res.statusCode).toBe(201)
    const rows = await db
      .select()
      .from(budgetEvents)
      .where(eq(budgetEvents.userId, res.json().user.id as number))
    expect(rows[0].monthBudget).toBe(5200)
    expect(rows[0].cycleStartDay).toBe(25)
  })

  it('重复用户名 409', async () => {
    expect((await register('alice')).statusCode).toBe(409)
  })

  it('非法用户名 400（密码长度由客户端校验，服务端只接收预哈希）', async () => {
    expect((await register('ab')).statusCode).toBe(400)
  })

  it('密码不以明文入库', async () => {
    const rows = await db.select().from(users).where(eq(users.username, 'alice'))
    expect(rows[0].passwordHash).not.toBe('secret123')
    expect(rows[0].passwordHash.startsWith('$2')).toBe(true)
  })

  it('登录：错误密码 401，正确密码返回 token', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: prehashPassword('wrong') },
    })
    expect(bad.statusCode).toBe(401)

    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: prehashPassword('secret123') },
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().token).toBeTruthy()
  })

  it('受保护路由：无 token 401，有效 token 返回用户', async () => {
    const noToken = await app.inject({ method: 'GET', url: '/api/auth/me' })
    expect(noToken.statusCode).toBe(401)

    const badToken = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: 'Bearer not-a-token' },
    })
    expect(badToken.statusCode).toBe(401)

    const { token, user } = (await register('dave')).json()
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(me.statusCode).toBe(200)
    expect(me.json().user).toEqual(user)
  })
})

describe('单用户模式：固定账号、单设备登录与密码冷却', () => {
  it('固定账号启动即可登录，且已种子分类与初始预算', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'fixed_owner', password: prehashPassword('owner-pass-123') },
    })
    expect(res.statusCode).toBe(200)
    const userId = res.json().user.id as number
    expect(await db.select().from(categories).where(eq(categories.userId, userId))).toHaveLength(12)
    expect(await db.select().from(budgetEvents).where(eq(budgetEvents.userId, userId))).toHaveLength(1)
  })

  it('单设备登录：新登录使旧 token 立即失效', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'fixed_owner', password: prehashPassword('owner-pass-123') },
    })
    const oldToken = first.json().token as string
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/auth/me',
          headers: { authorization: `Bearer ${oldToken}` },
        })
      ).statusCode,
    ).toBe(200)

    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'fixed_owner', password: prehashPassword('owner-pass-123') },
    })
    const newToken = second.json().token as string

    const oldNow = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${oldToken}` },
    })
    expect(oldNow.statusCode).toBe(401)
    expect(oldNow.json().error).toContain('其他设备')

    const newOk = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${newToken}` },
    })
    expect(newOk.statusCode).toBe(200)
  })

  it('登出后 token 立即失效', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'fixed_owner', password: prehashPassword('owner-pass-123') },
    })
    const token = login.json().token as string
    const out = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(out.statusCode).toBe(200)
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(me.statusCode).toBe(401)
  })

  it('连续 5 次密码错误锁定 5 分钟，到期后可恢复', async () => {
    await register('lock_target', 'secret123')
    for (let i = 0; i < 4; i++) {
      const bad = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'lock_target', password: prehashPassword('wrong-pass') },
      })
      expect(bad.statusCode).toBe(401)
    }
    const fifth = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'lock_target', password: 'wrong-pass' },
    })
    expect(fifth.statusCode).toBe(401)
    expect(fifth.json().error).toContain('锁定')

    const locked = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'lock_target', password: prehashPassword('secret123') },
    })
    expect(locked.statusCode).toBe(429)
    expect(locked.json().error).toContain('分钟')

    await db
      .update(users)
      .set({ lockedUntil: null, failedAttempts: 0 })
      .where(eq(users.username, 'lock_target'))
    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'lock_target', password: prehashPassword('secret123') },
    })
    expect(ok.statusCode).toBe(200)
  })

  it('关闭注册时注册接口返回 403', async () => {
    const app2 = await buildApp({ databaseUrl: env.testDatabaseUrl, jwtSecret: env.jwtSecret })
    await app2.ready()
    const res = await app2.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'nobody_here', password: 'secret123' },
    })
    expect(res.statusCode).toBe(403)
    await app2.close()
  })
})

describe('token 自动续期（滑动会话）', () => {
  it('新 token 不触发续期', async () => {
    const { token } = (await register('renew_fresh')).json()
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['x-jizhang-token']).toBeUndefined()
  })

  it('签发超过 7 天的 token 自动换发新 token，且新 token 可用', async () => {
    const { user } = (await register('renew_old')).json()
    const rows = await db.select().from(users).where(eq(users.username, 'renew_old'))
    const sid = rows[0].sessionId as string
    const now = Math.floor(Date.now() / 1000)
    const oldToken = await new SignJWT({ uid: user.id as number, sid })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(now - 8 * 86_400)
      .setExpirationTime(now + 22 * 86_400)
      .sign(new TextEncoder().encode(env.jwtSecret))

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${oldToken}` },
    })
    expect(res.statusCode).toBe(200)
    const refreshed = res.headers['x-jizhang-token']
    expect(typeof refreshed).toBe('string')
    expect(refreshed).not.toBe(oldToken)

    const again = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${refreshed as string}` },
    })
    expect(again.statusCode).toBe(200)
    expect(again.json().user.username).toBe('renew_old')
  })
})
