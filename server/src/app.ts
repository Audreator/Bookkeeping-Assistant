import cors from '@fastify/cors'
import formbody from '@fastify/formbody'
import { eq } from 'drizzle-orm'
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  hashPassword,
  signToken,
  verifyPassword,
  verifyToken,
} from './auth.ts'
import { createDb, type DB } from './db/client.ts'
import { users } from './db/schema.ts'
import { registerIngestRoutes } from './routes/ingest.ts'
import { registerBusinessRoutes } from './routes/index.ts'
import { ensureDefaultUser, seedUser } from './seed.ts'
import {
  nowDateTime,
  nowDateTimePlusMinutes,
  parseDateTime,
} from './util/date.ts'

export interface AppOptions {
  databaseUrl: string
  jwtSecret: string
  /** 是否开放注册（单用户模式下关闭，仅测试开启） */
  allowRegistration?: boolean
  /** 固定账号：启动时确保存在并可用 */
  defaultUser?: { username: string; password: string; displayName?: string }
  /** 快捷指令 OCR 通道令牌 */
  ingestToken?: string
  /** OCR 入账归属用户（缺省取第一个用户） */
  ingestUserId?: number
}

declare module 'fastify' {
  interface FastifyInstance {
    db: DB
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
  interface FastifyRequest {
    userId?: number
  }
}

const MAX_FAILED_ATTEMPTS = 5
const LOCK_MINUTES = 5

const registerSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).max(72),
  displayName: z.string().min(1).max(32).optional(),
  monthBudget: z.number().positive().max(10_000_000).optional(),
  cycleStartDay: z.number().int().min(1).max(28).optional(),
})

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 5 * 1024 * 1024 })
  // 快捷指令兼容：允许纯文本与表单请求体（{"text": "..."} 之外的形式）
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => {
    done(null, { text: body })
  })
  await app.register(formbody)
  const { pool, db } = createDb(opts.databaseUrl)
  app.decorate('db', db)
  app.addHook('onClose', async () => {
    await pool.end()
  })

  if (opts.defaultUser) {
    await ensureDefaultUser(db, opts.defaultUser)
  }

  app.register(cors, { origin: true, exposedHeaders: ['x-jizhang-token'] })

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null
    const verified = token ? await verifyToken(opts.jwtSecret, token) : null
    if (!verified) {
      return reply.code(401).send({ error: '未登录或登录已过期' })
    }

    // 单设备登录：token 中的会话必须与该用户当前的唯一会话一致
    const rows = await db
      .select({ sessionId: users.sessionId })
      .from(users)
      .where(eq(users.id, verified.userId))
      .limit(1)
    const user = rows[0]
    if (!user || !verified.sessionId || user.sessionId !== verified.sessionId) {
      return reply.code(401).send({ error: '账号已在其他设备登录，请重新登录' })
    }

    request.userId = verified.userId
    // 滑动会话：使用超过 7 天自动换发新 token，客户端从响应头取回并保存
    const now = Math.floor(Date.now() / 1000)
    if (verified.issuedAt !== null && now - verified.issuedAt > 7 * 86_400) {
      reply.header(
        'x-jizhang-token',
        await signToken(opts.jwtSecret, verified.userId, verified.sessionId),
      )
    }
  })

  app.get('/api/health', async () => ({ ok: true }))

  app.post('/api/auth/register', async (request, reply) => {
    if (!opts.allowRegistration) {
      return reply.code(403).send({ error: '已关闭注册，请使用固定账号登录' })
    }
    const parsed = registerSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: '用户名需 3-32 位字母数字下划线，密码至少 8 位' })
    }
    const { username, password, displayName, monthBudget, cycleStartDay } = parsed.data

    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .limit(1)
    if (existing.length > 0) {
      return reply.code(409).send({ error: '用户名已存在' })
    }

    const passwordHash = await hashPassword(password)
    const sessionId = randomUUID()
    const [result] = await db.insert(users).values({
      username,
      passwordHash,
      displayName: displayName ?? username,
      sessionId,
      createdAt: nowDateTime(),
    })
    const userId = Number(result.insertId)
    await seedUser(db, userId, { monthBudget, cycleStartDay })
    const token = await signToken(opts.jwtSecret, userId, sessionId)
    return reply
      .code(201)
      .send({ token, user: { id: userId, username, displayName: displayName ?? username } })
  })

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = z
      .object({ username: z.string().min(1), password: z.string().min(1) })
      .safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: '请输入用户名和密码' })
    }
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.username, parsed.data.username))
      .limit(1)
    const user = rows[0]
    if (!user) {
      return reply.code(401).send({ error: '用户名或密码错误' })
    }

    const now = Date.now()
    if (user.lockedUntil && parseDateTime(user.lockedUntil).getTime() > now) {
      const minutes = Math.max(
        1,
        Math.ceil((parseDateTime(user.lockedUntil).getTime() - now) / 60_000),
      )
      return reply
        .code(429)
        .send({ error: `密码错误次数过多，请 ${minutes} 分钟后再试` })
    }

    const ok = await verifyPassword(parsed.data.password, user.passwordHash)
    if (!ok) {
      const attempts = user.failedAttempts + 1
      if (attempts >= MAX_FAILED_ATTEMPTS) {
        await db
          .update(users)
          .set({ failedAttempts: 0, lockedUntil: nowDateTimePlusMinutes(LOCK_MINUTES) })
          .where(eq(users.id, user.id))
        return reply
          .code(401)
          .send({ error: `密码错误次数过多，已锁定 ${LOCK_MINUTES} 分钟` })
      }
      await db
        .update(users)
        .set({ failedAttempts: attempts })
        .where(eq(users.id, user.id))
      return reply
        .code(401)
        .send({ error: `用户名或密码错误（还可尝试 ${MAX_FAILED_ATTEMPTS - attempts} 次）` })
    }

    // 登录成功：重置锁定、签发新的唯一会话（使其他设备失效）
    const sessionId = randomUUID()
    await db
      .update(users)
      .set({ sessionId, failedAttempts: 0, lockedUntil: null })
      .where(eq(users.id, user.id))
    const token = await signToken(opts.jwtSecret, user.id, sessionId)
    return { token, user: { id: user.id, username: user.username, displayName: user.displayName } }
  })

  app.get('/api/auth/me', { preHandler: app.authenticate }, async (request, reply) => {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.id, request.userId as number))
      .limit(1)
    const user = rows[0]
    if (!user) return reply.code(404).send({ error: '用户不存在' })
    return { user: { id: user.id, username: user.username, displayName: user.displayName } }
  })

  app.post('/api/auth/logout', { preHandler: app.authenticate }, async (request) => {
    await db
      .update(users)
      .set({ sessionId: null })
      .where(eq(users.id, request.userId as number))
    return { ok: true }
  })

  registerBusinessRoutes(app)
  registerIngestRoutes(app, { token: opts.ingestToken, userId: opts.ingestUserId })

  return app
}
