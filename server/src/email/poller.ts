import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import type { DB } from '../db/client.ts'
import { processRawEmail, type ProcessOutcome } from './process.ts'
import { matchesBankSender } from './sender.ts'

export interface EmailPollerConfig {
  host: string
  port: number
  user: string
  pass: string
  senderFilter: string
  userId: number
}

export interface PollSummary {
  scanned: number
  matched: number
  outcomes: ProcessOutcome[]
}

const htmlToText = (html: unknown): string =>
  typeof html === 'string' ? html.replace(/<[^>]+>/g, ' ') : ''

/** 拉取一次邮箱：只处理白名单发件人的邮件（同 Message-ID 由收据表去重） */
export async function pollOnce(db: DB, cfg: EmailPollerConfig): Promise<PollSummary> {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  })
  const summary: PollSummary = { scanned: 0, matched: 0, outcomes: [] }

  await client.connect()
  try {
    const lock = await client.getMailboxLock('INBOX')
    try {
      const since = new Date(Date.now() - 3 * 86_400_000)
      for await (const msg of client.fetch({ since }, { envelope: true, source: true, internalDate: true })) {
        summary.scanned += 1
        const from = msg.envelope?.from?.[0]?.address ?? ''
        if (!matchesBankSender(from, cfg.senderFilter)) continue
        summary.matched += 1
        const source = msg.source
        if (!source) continue
        const parsed = await simpleParser(source as Buffer)
        const text = parsed.text ?? htmlToText(parsed.html)
        const receivedAt = parsed.date ?? (msg.internalDate ? new Date(msg.internalDate) : undefined)
        if (!receivedAt || Number.isNaN(receivedAt.getTime())) {
          summary.outcomes.push({ status: 'error', reason: '邮件缺少有效接收日期，未自动入账' })
          continue
        }
        const outcome = await processRawEmail(db, cfg.userId, {
          messageId: parsed.messageId ?? '',
          from,
          subject: parsed.subject ?? '',
          text,
          date: receivedAt,
        })
        summary.outcomes.push(outcome)
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => undefined)
  }
  return summary
}

export function startEmailPoller(
  db: DB,
  cfg: EmailPollerConfig,
  intervalSeconds: number,
  log: (message: string) => void = console.log,
): { stop: () => void } {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      const summary = await pollOnce(db, cfg)
      if (summary.matched > 0) {
        log(
          `[邮件自动记账] 扫描 ${summary.scanned} 封，命中 ${summary.matched} 封：${summary.outcomes
            .map((o) => o.status)
            .join(', ')}`,
        )
      }
    } catch (err) {
      log(`[邮件自动记账] 轮询失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      running = false
    }
  }
  void tick()
  const timer = setInterval(() => void tick(), intervalSeconds * 1000)
  return { stop: () => clearInterval(timer) }
}
