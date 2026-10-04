import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { env } from '../env.ts'
import { parseBankEmail } from './parse.ts'
import { matchesBankSender } from './sender.ts'

/** 诊断命令：拉取最近 7 天白名单发件人的邮件，只打印解析结果，不写库 */
async function run() {
  if (!env.imapUser || !env.imapPass) {
    console.log('未配置 IMAP_USER / IMAP_PASS（在 .env 中填写 QQ 邮箱与授权码）')
    return
  }
  const client = new ImapFlow({
    host: env.imapHost,
    port: env.imapPort,
    secure: true,
    auth: { user: env.imapUser, pass: env.imapPass },
    logger: false,
  })
  await client.connect()
  try {
    const lock = await client.getMailboxLock('INBOX')
    try {
      const since = new Date(Date.now() - 7 * 86_400_000)
      let matched = 0
      for await (const msg of client.fetch({ since }, { envelope: true, source: true })) {
        const from = msg.envelope?.from?.[0]?.address ?? ''
        if (!matchesBankSender(from, env.bankSenderFilter)) continue
        matched += 1
        const source = msg.source
        if (!source) continue
        const parsed = await simpleParser(source as Buffer)
        const text =
          parsed.text ??
          (typeof parsed.html === 'string' ? parsed.html.replace(/<[^>]+>/g, ' ') : '')
        const result = parseBankEmail({
          from,
          subject: parsed.subject ?? '',
          text,
          date: parsed.date ?? new Date(),
        })
        console.log('----------------------------------------')
        console.log('发件人：', from)
        console.log('主题：', parsed.subject ?? '')
        console.log(
          '解析：',
          result.kind,
          '| 金额：',
          result.amount,
          '| 日期：',
          result.occurredAt,
          '| 时间：',
          result.occurredTime,
          '| 商户：',
          JSON.stringify(result.merchant),
          '| 卡尾号：',
          result.cardTail,
          '| 说明：',
          result.reason,
        )
        console.log('正文摘要：', text.replace(/\s+/g, ' ').slice(0, 200))
      }
      console.log(`共命中白名单邮件 ${matched} 封（以上均未写入数据库）`)
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => undefined)
  }
}

void run().catch((err) => {
  console.error('诊断失败：', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
