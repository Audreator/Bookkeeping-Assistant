import { extractExplicitMerchant } from './merchant.ts'

export interface ParsedPayment {
  type: 'expense' | 'refund'
  amount: number
  merchant: string
  occurredAt?: string
  occurredTime?: string
}

// 符号、品牌名以及“退款”两个字都不是交易完成的证据。
const INCOMPLETE_RE = /(?:支付|付款|付费|交易|消费|扣款|扣费|退款|退费|出账|入账|收款|转入|转出|进账|存入|汇入|转存|退回|退还|退货|退单|冲正|返款|返还|支取|取现|花费|缴费|还款)(?:状态|到账)?[：:\s]*(?:未成功|失败|取消|已取消|关闭|处理中|处理失败|中|未到账)|(?:待|等待|未|即将|预计)(?:支付|付款|退款|出账|扣款|入账|进账|到账|收款|转入|转出|退回|退还|支取|取现|收入|退费|缴费|还款)|(?:退款|退回|退还|退单|退费)申请(?:已提交|提交成功|成功|处理中)|申请(?:退款|退回|退还|退单|退费)(?:已提交|成功|处理中)|(?:退款|退回|退还|退单|退费)(?:已)?受理|预计[^\n]{0,20}退款到账|退款[^\n]{0,10}预计到账/
// 退款完成：退款/退回/退还/退货/退单/退费/冲正/返款/返还等近义词，以及“已”前缀的完成表述。
// 「返还/退还」等营销高频词只在带成功、到账、完成证据时才算退款，避免条件文案误伤。
// 金额标签只决定金额优先级；“原路退回”和“快捷支付退款”本身不证明退款完成。
const REFUND_SUCCESS_RE = /退款(?:已)?(?:成功|到账|完成)(?!时间)|已(?:完成|成功|全额|全部|自动|原路)?(?:退款|退回|退还|退货|退单|退费|撤销|冲正|返款|返还)|(?:退回|退还|退货|退单|退费|冲正|返款|返还)(?:成功|已到账|到账|完成)|收到(?:了)?(?:一笔)?(?:退款|返款)/
// 钱进来的证据（收款/转入/入账/进账/存入/汇入/工资/奖金/利息等）；不含“收款方”，避免把付款页的收款对象误判为进账。
const INCOME_CREDIT_RE = /(?:收款|转入|入账|进账|存入|汇入|转存)[：:\s]*(?:成功|到账|完成|收入|人民币|[¥￥]|金额|\d)|(?:工资|奖金|补贴|利息|报销|收入)[：:\s]*(?:已)?(?:到账|入账|发放|进账|成功|人民币|[¥￥]|金额|\d)|(?<!红包)(?<!奖励)(?<!返现)(?<!优惠)(?<!券)(?<!积分)已(?:收款|到账|入账|进账)|转[账帐](?:已)?(?:收入|入账|到账|到款)|(?:收\s*[/／]\s*支|收支(?:方向|类型)?|交易(?:方向|类型))[：:\s]*(?:收入|收款|转入|入账|进账)|收到(?:了)?(?:一笔)?(?:转入|收入|工资|奖金|报销|转账)|发生一笔(?:转入|收入|工资|奖金|报销)|(?:^|\n)\s*(?:收入|收款|转入|入账|进账)[：:\s+¥￥]/
const PAYMENT_SUCCESS_RE = /(?:支付|付款|付费|消费|扣款|扣费|支出|花费|支取|取现|转出|缴费|还款)(?:已)?(?:成功|完成)|已(?:完成)?(?:支付|付款|付费|扣款|扣费|支出|支取|取现|转出|缴费|还款)|发生(?:了)?(?:一笔)?[^\n，。,；;]{0,12}?(?:支出|消费|扣款|支付|付费|花费|支取|转出)|账户(?:已)?出账[^\n，。,；;]{0,12}(?:支出|消费|扣款|支取|转出)/
const GENERIC_SUCCESS_RE = /交易成功|交易完成|交易状态[：:\s]*成功/
const EXPENSE_DIRECTION_RE = /(?:收\s*[/／]\s*支|收支(?:方向|类型)?|交易(?:方向|类型))[：:\s]*(?:支出|付款|支付|消费|扣款|扣费|付费|花费|支取|取现|转出|缴费|还款)|(?:实付|实际支付|实际付款|支付|付款|消费|支出|扣款|扣费|花费|付费|支取)金额|(?:^|\n)\s*[-−–—·・]\s*\d/
// “发生快捷支付退款”中的支付是退款事件的一部分，不能截取为支付完成。
// 只拦截复合交易词/发生事件，不影响付款成功页上的独立“申请退款”按钮。
const REFUND_EVENT_RE = /(?:支付|付款|付费|消费|扣款|扣费|支出|花费|支取|取现|转出|缴费|还款)\s*(?:退款|退费|退回|退还|退货|退单|返款|返还|冲正|撤销)|发生(?:了)?(?:一笔)?[^\n，。,；;]{0,24}(?:退款|退费|退回|退还|退货|退单|返款|返还|冲正|撤销)/

const NUMBER_SOURCE = '(?:[1-9]\\d{0,2}(?:,\\d{3})+|(?:0|[1-9]\\d*))(?:\\.\\d{1,2})?'
// 银行通知的省略状态只接受个人账户、日期时间、可选封闭通道栏、退款事件和紧邻金额。
// 中间不跨过说明、条件或确认文字；金额后仅接受通知结束、余额字段和查看详情提示。
// 没有明示成功的模板不能忽略未知后文，否则待确认/审核状态会冒充到账。
const BANK_SEPARATOR_SOURCE = '[\\s，。,；;]*'
const BANK_NOTIFICATION_END_SOURCE = `${BANK_SEPARATOR_SOURCE}(?:(?:账户余额|可用余额|余额)[：:\\s]*(?:人民币\\s*|[¥￥]\\s*)?${NUMBER_SOURCE}(?![\\d,.])(?:\\s*元)?${BANK_SEPARATOR_SOURCE})?(?:(?:点此|点击)查看详情${BANK_SEPARATOR_SOURCE})?$`
const BANK_CHANNEL_SOURCE = '(?:在\\s*(?:【[^【】\\[\\]]{1,120}】|\\[[^【】\\[\\]]{1,120}\\])\\s*)?'
const BANK_QUICK_REFUND_RE = new RegExp(`(?:您(?:的)?(?:尾号|末四位)\\s*\\d{4}\\s*的账户|您(?:的)?账户\\s*\\d{4})(?:[\\s\\d年月日/:：.\\-]|于){0,32}${BANK_CHANNEL_SOURCE}(?:发生(?:了)?(?:一笔)?\\s*)?快捷支付退款[，,：:\\s]*(?:人民币\\s*|[¥￥]\\s*)?${NUMBER_SOURCE}(?![\\d,.])(?:\\s*元)?(?=${BANK_NOTIFICATION_END_SOURCE})`)
const LABEL_SOURCE = '实付金额|实际支付金额|实际支付|实付|退款金额|本次退款|实退金额|退回金额|退还金额|支付金额|付款金额|消费金额|支出金额|扣款金额|交易金额|金额'
const NON_TX_LABEL_RE = /(?:账户余额|可用余额|余额|原付款金额|原支付金额|原交易金额|原价|订单金额|商品金额|优惠金额|优惠|红包|奖励|立减|优惠券|手续费|累计金额)[：:\s]*$/
const MARKETING_BEFORE_RE = /(?:领取|领|最高|满|可得|返现|奖励|赠送)[^\n\d]{0,8}$/
const MARKETING_AFTER_RE = /^[\s元]*(?:红包|优惠券|奖励|返现)/
const pad = (value: number) => String(value).padStart(2, '0')
const SHORT_DATE_SOURCE = '(?<![\\d年/.-])(\\d{1,2})(?:月|/)(\\d{1,2})(?!\\d)(?:日)?'

function dateValue(year: number, month: number, day: number): number | null {
  const value = Date.UTC(year, month - 1, day)
  const date = new Date(value)
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : null
}

function resolveShortDates(text: string, referenceDate?: string): string {
  const reference = referenceDate?.match(/^((?:19|20|21)\d{2})-(\d{2})-(\d{2})$/)
  if (!reference) return text
  const [year, month, day] = reference.slice(1).map(Number)
  const base = dateValue(year, month, day)
  if (base === null) return text
  return text.replace(new RegExp(SHORT_DATE_SOURCE, 'g'), (raw: string, rawMonth: string, rawDay: string) => {
    const month = Number(rawMonth)
    const day = Number(rawDay)
    const candidates = [year - 1, year, year + 1].flatMap((candidateYear) => {
      const value = dateValue(candidateYear, month, day)
      return value === null ? [] : [{ year: candidateYear, distance: Math.abs(value - base) }]
    }).sort((a, b) => a.distance - b.distance)
    if (!candidates.length || candidates[0].distance === candidates[1]?.distance) return raw
    return `${candidates[0].year}-${pad(month)}-${pad(day)}${raw.endsWith('日') ? ' ' : ''}`
  })
}

function hasCompletedStatus(text: string, pattern: RegExp): boolean {
  return [...text.matchAll(new RegExp(pattern.source, 'g'))].some((match) => {
    const clause = text.slice(0, match.index).split(/[\n，。,；;]/).at(-1) ?? ''
    if (/(?:如果|若|当(?!前)|将会|将|预计|申请)[^\n，。,；;]{0,100}$/.test(clause)) return false
    return !/^(?:后|时|可|即|将|则|才能)/.test(text.slice(match.index + match[0].length))
  })
}

/** 只提取文本中的交易时间；不会用系统时间补出未知的秒。 */
export function parsePaymentDateTime(input: string, type: 'expense' | 'refund', referenceDate?: string): {
  occurredAt?: string
  occurredTime?: string
} {
  const text = resolveShortDates(input, referenceDate)
  const dateSource = '(?<!\\d)((?:19|20|21)\\d{2})[年\\-/.](\\d{1,2})[月\\-/.](\\d{1,2})(?!\\d)(?:日)?'
  const timeSource = '(?<![\\d:])(\\d{1,2})[:：](\\d{2})(?:[:：](\\d{2}))?(?![\\d:：])'
  const candidates: { value: string; priority: number }[] = []
  const labels = [...text.matchAll(/((?:原订单|原|订单)?(?:退款到账|退款|到账|付款|支付|消费|扣款|支出|交易|发生|创建)(?:时间|日期))[：:\s]*/g)]
  const labeledRanges: { start: number; end: number }[] = []
  for (const [index, match] of labels.entries()) {
    const label = match[1]
    const start = match.index + match[0].length
    const nextLine = text.indexOf('\n', start)
    let end = Math.min(labels[index + 1]?.index ?? text.length, nextLine < 0 ? text.length : nextLine)
    const value = text.slice(start, end)
    // OCR 可能把同一字段里的日期、时间拆成相邻两行。只拼接下一行纯时间。
    if (end === nextLine && new RegExp(dateSource).test(value) && !new RegExp(timeSource).test(value)) {
      const followingLineEnd = text.indexOf('\n', end + 1)
      const followingEnd = followingLineEnd < 0 ? text.length : followingLineEnd
      const followingLine = text.slice(end + 1, followingEnd)
      if (new RegExp(`^\\s*${timeSource}\\s*$`).test(followingLine)) end = followingEnd
    }
    // 所有标签范围均从裸日期兜底中排除，避免把被拒绝的时间再次捡回。
    labeledRanges.push({ start: match.index, end })
    if (/^原|创建/.test(label)) continue
    const isRefund = /退款|到账/.test(label)
    const isPayment = /付款|支付|消费|扣款|支出/.test(label)
    if ((type === 'refund' && isPayment) || (type === 'expense' && isRefund)) continue
    candidates.push({ value: text.slice(start, end), priority: isRefund || isPayment ? 3 : 2 })
  }
  for (const match of text.matchAll(new RegExp(`${dateSource}(?:[ \\tT]{0,3}${timeSource})?`, 'g'))) {
    if (labeledRanges.some(({ start, end }) => match.index >= start && match.index < end)) continue
    candidates.push({ value: match[0], priority: 1 })
  }
  if (!candidates.length) return {}
  const parsed = candidates.map(({ value, priority }) => {
    const date = value.match(new RegExp(dateSource))
    const shortDate = value.match(new RegExp(SHORT_DATE_SOURCE))
    const time = value.match(new RegExp(timeSource))
    let occurredAt: string | undefined
    let invalidDate = !!shortDate
    if (date) {
      const [year, month, day] = date.slice(1).map(Number)
      const check = new Date(Date.UTC(year, month - 1, day))
      invalidDate = check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day
      if (!invalidDate) occurredAt = `${year}-${pad(month)}-${pad(day)}`
    }
    let occurredTime: string | undefined
    if (time && !invalidDate) {
      const [hour, minute, second] = [Number(time[1]), Number(time[2]), Number(time[3] ?? 0)]
      if (hour < 24 && minute < 60 && second < 60) occurredTime = `${pad(hour)}:${pad(minute)}:${pad(second)}`
    }
    return { occurredAt, occurredTime, hasDate: !!date || !!shortDate, hasTime: !!time, priority }
  })
  // 日期和时间可以分别位于不同字段；各自按优先级选择，避免 time-only 覆盖日期。
  const select = (field: 'occurredAt' | 'occurredTime', present: 'hasDate' | 'hasTime', available = parsed): string | undefined => {
    const matching = available.filter((candidate) => candidate[present])
    if (!matching.length) return undefined
    const priority = Math.max(...matching.map((candidate) => candidate.priority))
    const values = new Set(matching.filter((candidate) => candidate.priority === priority).map((candidate) => candidate[field]))
    return values.size === 1 ? [...values][0] : undefined
  }
  const occurredAt = select('occurredAt', 'hasDate')
  // 有日期但日期无效/有歧义时，不拿另一个候选的时间拼出完整时刻。
  if (!occurredAt && parsed.some((candidate) => candidate.hasDate)) return {}
  const sameDate = parsed.filter((candidate) => !candidate.hasDate || candidate.occurredAt === occurredAt)
  return { occurredAt, occurredTime: select('occurredTime', 'hasTime', sameDate) }
}

function parseAmount(text: string, type: ParsedPayment['type']): number | null {
  const candidates: { amount: number; priority: number }[] = []
  const patterns = [
    new RegExp(`(?:[¥￥]\\s*|人民币\\s*)(${NUMBER_SOURCE})(?![\\d,.])`, 'g'),
    new RegExp(`(?<![\\d,.])(${NUMBER_SOURCE})\\s*元`, 'g'),
    new RegExp(`(?<![\\d¥￥,.])(?:[+\\-−–—·・])\\s*(${NUMBER_SOURCE})(?![\\d,.])`, 'g'),
    new RegExp(`(?:^|\\n)[ \\t]*(${NUMBER_SOURCE})[ \\t]*(?=\\n|$)`, 'g'),
    new RegExp(`(?:${LABEL_SOURCE})[：:\\s]*(?:人民币\\s*|[¥￥]\\s*)?(${NUMBER_SOURCE})(?![\\d,.])`, 'g'),
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1]
      // 未带币种或金额标签的整数可能是卡尾号、订单号，不作为金额。
      if ((pattern === patterns[2] || pattern === patterns[3]) && !/\.\d{2}$/.test(raw)) continue
      const index = match.index + match[0].lastIndexOf(raw)
      const before = text.slice(Math.max(0, index - 30), index).replace(/(?:人民币|[¥￥]|[+\-−–—·・])\s*$/, '')
      const after = text.slice(index + raw.length, index + raw.length + 15)
      if (NON_TX_LABEL_RE.test(before) || MARKETING_BEFORE_RE.test(before) || MARKETING_AFTER_RE.test(after)) continue
      if (/[\d,.]/.test(text[index - 1] ?? '') || /[\d,.]/.test(text[index + raw.length] ?? '')) continue
      if (/[¥￥]\s*[+\-−–—·・]\s*$/.test(text.slice(Math.max(0, index - 6), index))) continue
      const label = before.match(new RegExp(`(${LABEL_SOURCE})[：:\\s]*$`))?.[1]
      const refundLabel = !!label && /退款|实退|退回|退还/.test(label)
      const expenseLabel = !!label && /实付|实际支付|支付金额|付款金额|消费金额|支出金额|扣款金额/.test(label)
      if ((type === 'expense' && refundLabel) || (type === 'refund' && expenseLabel)) continue
      const priority = type === 'refund'
        ? refundLabel ? 3 : label ? 2 : 1
        : /实付|实际支付/.test(label ?? '') ? 3 : label ? 2 : 1
      const amount = Number(raw.replace(/,/g, ''))
      if (Number.isFinite(amount) && amount > 0 && amount <= 100_000_000) candidates.push({ amount: Math.round(amount * 100) / 100, priority })
    }
  }
  if (!candidates.length) return null
  const priority = Math.max(...candidates.map((candidate) => candidate.priority))
  const amounts = new Set(candidates.filter((candidate) => candidate.priority === priority).map((candidate) => candidate.amount))
  return amounts.size === 1 ? [...amounts][0] : null
}

/** 完成状态 → 金额字段优先级 → 日期时间。存在歧义时由调用方要求人工复核。 */
export function parsePaymentText(text: string, referenceDate?: string): ParsedPayment | null {
  const t = text.replace(/\u3000/g, ' ').replace(/\r\n?/g, '\n')
  if (INCOMPLETE_RE.test(t)) return null
  const positiveUnknown = new RegExp(`(?:^|\\n)\\s*\\+\\s*${NUMBER_SOURCE}\\s*(?:元)?\\s*(?=\\n|$)`).test(t)
  const paid = hasCompletedStatus(t, PAYMENT_SUCCESS_RE) || (hasCompletedStatus(t, GENERIC_SUCCESS_RE) && EXPENSE_DIRECTION_RE.test(t) && !positiveUnknown)
  const refunded = hasCompletedStatus(t, REFUND_SUCCESS_RE) || hasCompletedStatus(t, BANK_QUICK_REFUND_RE)
  const credited = hasCompletedStatus(t, INCOME_CREDIT_RE)
  if (!refunded && !credited && REFUND_EVENT_RE.test(t)) return null
  const type = refunded || credited ? 'refund' : paid ? 'expense' : null
  if (type === null) return null
  const amount = parseAmount(t, type)
  if (amount === null) return null
  return { type, amount, merchant: extractExplicitMerchant(t), ...parsePaymentDateTime(t, type, referenceDate) }
}
