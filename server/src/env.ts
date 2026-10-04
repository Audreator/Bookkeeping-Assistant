import 'dotenv/config'
import { requireTestDatabaseUrl } from './db/test-database.ts'

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`缺少环境变量 ${name}：请复制 .env.example 为 .env 并填写`)
  }
  return value
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  testDatabaseUrl: process.env.NODE_ENV === 'test'
    ? requireTestDatabaseUrl(process.env.TEST_DATABASE_URL, required('DATABASE_URL'))
    : process.env.TEST_DATABASE_URL ?? '',
  jwtSecret: required('JWT_SECRET'),
  port: Number(process.env.PORT ?? 8787),
  defaultUsername: process.env.DEFAULT_USERNAME ?? 'owner',
  defaultPassword: process.env.DEFAULT_PASSWORD,
  // 邮件自动记账（可选；未配置则不启动轮询）
  imapHost: process.env.IMAP_HOST ?? 'imap.qq.com',
  imapPort: Number(process.env.IMAP_PORT ?? 993),
  imapUser: process.env.IMAP_USER,
  imapPass: process.env.IMAP_PASS,
  bankSenderFilter: process.env.BANK_SENDER_FILTER ?? 'cmbchina.com',
  autoEmailUserId: process.env.AUTO_EMAIL_USER ? Number(process.env.AUTO_EMAIL_USER) : null,
  emailPollSeconds: Number(process.env.EMAIL_POLL_SECONDS ?? 60),
  // 快捷指令 OCR 通道
  ingestToken: process.env.INGEST_TOKEN,
  ingestUserId: Number(process.env.INGEST_USER ?? 0) || undefined,
}
