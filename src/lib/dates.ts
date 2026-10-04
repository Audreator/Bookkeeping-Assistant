const WEEKDAYS_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

/** 本地时区的 YYYY-MM-DD */
export function toISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** YYYY-MM-DD → 本地零点 Date */
export function fromISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayISO(): string {
  return toISO(new Date())
}

/** 本地时区的 HH:mm:ss */
export function toLocalTime(d: Date): string {
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((part) => String(part).padStart(2, '0')).join(':')
}

export function addDays(iso: string, n: number): string {
  const d = fromISO(iso)
  d.setDate(d.getDate() + n)
  return toISO(d)
}

/** 日历天差：b − a */
export function daysBetween(a: string, b: string): number {
  const ms = fromISO(b).getTime() - fromISO(a).getTime()
  return Math.round(ms / 86_400_000)
}

/** 所在周的第一天（weekStartsOn：1=周一，7=周日） */
export function startOfWeekISO(iso: string, weekStartsOn: 1 | 7): string {
  const d = fromISO(iso)
  const day = d.getDay() // 0=周日
  const offset = weekStartsOn === 1 ? (day + 6) % 7 : day % 7
  return addDays(iso, -offset)
}

/** 日历第一行空格数量；月、周或模式切换期间都以真实日期对齐。 */
export function calendarOffset(periodStart: string, weekStartsOn: 1 | 7): number {
  return (fromISO(periodStart).getDay() + (weekStartsOn === 1 ? 6 : 0)) % 7
}

export function formatCN(iso: string): string {
  const d = fromISO(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS_CN[d.getDay()]}`
}

export function weekdayCN(iso: string): string {
  return WEEKDAYS_CN[fromISO(iso).getDay()]
}

/** 元金额四舍五入到分（远离零方向），消除浮点误差 */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return n
  const sign = n < 0 ? -1 : 1
  const rounded = Number(Math.round(Number(`${Math.abs(n)}e2`)) + 'e-2')
  return sign * rounded
}

/** '2026-10-04' → '2026-10' */
export function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

/** '2026-10' → 该月第一天 '2026-10-01' */
export function monthStart(key: string): string {
  return `${key}-01`
}

/** 该月天数 */
export function daysInMonthKey(key: string): number {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

/** 金额格式化：1234.5 → '1,234.50' */
export function formatMoney(n: number): string {
  return round2(n).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
