/** 服务端自用的小工具（与前端 src/lib/dates.ts 保持同语义，避免跨工程引用） */

export function todayISO(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function nowDateTime(): string {
  return formatDateTime(new Date())
}

/** Date → 'YYYY-MM-DD HH:mm:ss'（本地时区） */
export function formatDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function round2(n: number): number {
  if (!Number.isFinite(n)) return n
  const sign = n < 0 ? -1 : 1
  return sign * Number(Math.round(Number(`${Math.abs(n)}e2`)) + 'e-2')
}

/** 解析 'YYYY-MM-DD HH:mm:ss' 为本机时区 Date */
export function parseDateTime(s: string): Date {
  const [datePart, timePart = '00:00:00'] = s.split(' ')
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh, mi, ss] = timePart.split(':').map(Number)
  return new Date(y, m - 1, d, hh, mi, ss)
}

/** 当前时间 + n 分钟，格式 'YYYY-MM-DD HH:mm:ss' */
export function nowDateTimePlusMinutes(minutes: number): string {
  const d = new Date(Date.now() + minutes * 60_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
