import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { buildApp } from './app.ts'
import { startEmailPoller } from './email/poller.ts'
import { env } from './env.ts'

const app = await buildApp({
  databaseUrl: env.databaseUrl,
  jwtSecret: env.jwtSecret,
  defaultUser: env.defaultPassword
    ? { username: env.defaultUsername, password: env.defaultPassword }
    : undefined,
  ingestToken: env.ingestToken,
  ingestUserId: env.ingestUserId,
})

if (env.imapUser && env.imapPass && env.autoEmailUserId) {
  startEmailPoller(
    app.db,
    {
      host: env.imapHost,
      port: env.imapPort,
      user: env.imapUser,
      pass: env.imapPass,
      senderFilter: env.bankSenderFilter,
      userId: env.autoEmailUserId,
    },
    env.emailPollSeconds,
  )
  console.log(`邮件自动记账已启动（每 ${env.emailPollSeconds} 秒检查一次，白名单：${env.bankSenderFilter}）`)
}

const distDir = path.resolve(process.cwd(), 'dist')
if (existsSync(distDir)) {
  await app.register(fastifyStatic, { root: distDir })
}

await app.listen({ port: env.port, host: env.host })
console.log(`记账本服务已启动：http://localhost:${env.port}`)
