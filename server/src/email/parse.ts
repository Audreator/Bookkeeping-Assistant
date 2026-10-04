import { parsePaymentDateTime, parsePaymentText } from '../ingest/payment.ts'
import { extractExplicitMerchant } from '../ingest/merchant.ts'

export type BankTxKind = 'expense' | 'refund' | 'ignore'

export interface ParsedBankTx {
  kind: BankTxKind
  amount: number | null
  occurredAt: string | null
  occurredTime: string | null
  merchant: string
  cardTail: string | null
  reason: string
}

const INCOME_RE = /收入|转入|代发|工资|利息|入账|存入|转存|红包/

const pad = (n: number) => String(n).padStart(2, '0')

const toISO = (y: number, m: number, d: number): string => `${y}-${pad(m)}-${pad(d)}`

/**
 * 银行交易邮件解析（当前针对招行通知模板，可通过真实样本校准规则）。
 * 纯函数：只做识别，不写库。
 */
export function parseBankEmail(input: {
  from: string
  subject: string
  text: string
  date?: Date
}): ParsedBankTx {
  const haystack = `${input.subject}\n${input.text}`.replace(/\u3000/g, ' ')
  const base = input.date ?? new Date()
  const full = haystack.match(/(?:19|20|21)\d{2}[年\-/.]\d{1,2}[月\-/.]\d{1,2}/)
  const md = haystack.match(/(?<![\d年/.-])\d{1,2}(?:月|\/)\d{1,2}(?!\d)(?:日)?/)
  const referenceDate = Number.isNaN(base.getTime()) ? undefined : toISO(base.getFullYear(), base.getMonth() + 1, base.getDate())
  const payment = parsePaymentText(haystack, referenceDate)
  const time = parsePaymentDateTime(haystack, payment?.type ?? 'expense', referenceDate)
  // 邮件通道保持“收入/转入类不记账”：文本通知通道已把进账记为退款，这里按收据审计约定忽略。
  const incomeLike = INCOME_RE.test(haystack)
  let kind: BankTxKind = incomeLike ? 'ignore' : payment?.type ?? 'ignore'
  const amount = payment?.amount ?? null
  let occurredAt = time.occurredAt ?? (full || md ? null : Number.isNaN(base.getTime()) ? null : toISO(base.getFullYear(), base.getMonth() + 1, base.getDate()))
  const occurredTime = time.occurredTime ?? null
  let reason = payment ? payment.type === 'refund' ? '已完成退款通知' : '已完成支付/支出通知' : '未识别为已完成交易通知'
  if (incomeLike) reason = '收入/转入类或营销，不记账'
  else if (!payment && /失败|处理中|待支付|退款中|未到账/.test(haystack)) reason = '交易未完成或失败，不记账'
  else if (!payment && /退款|消费|支出|扣款|支付/.test(haystack)) reason = '未解析出金额或交易状态不明确，等待样本校准'
  if ((full || md) && !time.occurredAt) {
    kind = 'ignore'
    occurredAt = null
    reason = '交易日期无效或有歧义，等待样本校准'
  }

  const merchant = extractExplicitMerchant(haystack)

  const tailMatch = haystack.match(/(?:末四位|尾号|卡号后四位|账户|账号)[^\d]{0,6}(\d{4})/)

  return {
    kind,
    amount,
    occurredAt,
    occurredTime,
    merchant,
    cardTail: tailMatch?.[1] ?? null,
    reason,
  }
}
