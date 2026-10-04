import type { Tx } from '../api/types'
import { daysBetween, fromISO, round2, toISO } from './dates'

export interface ParsedBill {
  occurredAt: string
  occurredTime: string | null
  amount: number
  type: 'expense' | 'refund'
  merchant: string
  note: string
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      fields.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  fields.push(cur)
  return fields.map((f) => f.trim())
}

/** 微信/支付宝账单 CSV 结构相近：定位表头后按列名取值 */
function parseBillCSV(text: string): ParsedBill[] {
  const lines = text.split(/\r?\n/)
  const headerIndex = lines.findIndex(
    (l) => l.includes('交易时间') && l.includes('收/支') && l.includes('金额'),
  )
  if (headerIndex < 0) return []

  const header = splitCsvLine(lines[headerIndex])
  const col = (name: string) => header.findIndex((h) => h === name || h.startsWith(name))
  const iTime = col('交易时间')
  const iMerchant = col('交易对方')
  const iGoods = col('商品')
  const iDirection = col('收/支')
  const iAmount = col('金额')
  const iStatus = col('当前状态') >= 0 ? col('当前状态') : col('交易状态')
  const iType = col('交易类型')

  const bills: ParsedBill[] = []
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim() || line.startsWith('---') || line.startsWith('#')) continue
    const fields = splitCsvLine(line)
    if (fields.length < 5) continue

    const time = fields[iTime] ?? ''
    const stamp = /^(\d{4}-\d{2}-\d{2})(?:[ T]([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?)?$/.exec(time)
    if (!stamp) continue
    const date = stamp[1]
    if (toISO(fromISO(date)) !== date) continue
    const occurredTime = stamp[2] ? `${stamp[2]}:${stamp[3]}:${stamp[4] ?? '00'}` : null

    const rawAmount = (fields[iAmount] ?? '').replace(/[¥￥,]/g, '')
    if (!/^\d+(?:\.\d{1,2})?$/.test(rawAmount)) continue
    const amount = round2(Number(rawAmount))
    if (!Number.isFinite(amount) || amount <= 0) continue

    const direction = fields[iDirection] ?? ''
    const status = iStatus >= 0 ? (fields[iStatus] ?? '') : ''
    if (/失败|关闭|取消|处理中|待|未支付/.test(status)) continue
    const isRefund = /退款成功|退回成功/.test(status) ||
      (iType >= 0 && /退款/.test(fields[iType] ?? '') && /成功/.test(status))
    if (!isRefund && !direction.includes('支出')) continue
    if (iStatus >= 0 && !/成功|已全额退款|已部分退款/.test(status)) continue

    bills.push({
      occurredAt: date,
      occurredTime,
      amount,
      type: isRefund ? 'refund' : 'expense',
      merchant: fields[iMerchant] ?? '',
      note: (iGoods >= 0 ? fields[iGoods] : '') ?? '',
    })
  }
  return bills
}

export const parseWeChatCSV = parseBillCSV

/** 支付宝导出的 CSV 为 GBK 编码，调用方需先用 TextDecoder('gbk') 解码 */
export const parseAlipayCSV = parseBillCSV

export interface DedupeResult {
  fresh: ParsedBill[]
  dupes: ParsedBill[]
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

const similar = (
  a: string | null | undefined,
  b: string | null | undefined,
): boolean => {
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return false
  return x === y || x.includes(y) || y.includes(x)
}

export function dedupe(bills: ParsedBill[], existing: Tx[], windowDays = 3): DedupeResult {
  const fresh: ParsedBill[] = []
  const dupes: ParsedBill[] = []
  const used = new Set<number>()
  for (const b of bills) {
    const hit = existing.find(
      (t) =>
        !used.has(t.id) &&
        t.type === b.type &&
        round2(t.amount) === round2(b.amount) &&
        (t.occurredTime && b.occurredTime
          ? t.occurredAt === b.occurredAt && t.occurredTime === b.occurredTime
          : Math.abs(daysBetween(t.occurredAt, b.occurredAt)) <= windowDays) &&
        similar(t.merchant, b.merchant),
    )
    if (hit) {
      used.add(hit.id)
      dupes.push(b)
    } else {
      fresh.push(b)
    }
  }
  return { fresh, dupes }
}
