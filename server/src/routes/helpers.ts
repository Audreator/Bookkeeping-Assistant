import type { FastifyReply } from 'fastify'
import { z } from 'zod'

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

/** 真实存在的日历日期（拒绝 2026-02-30） */
export const dateString = z.string().refine(isValidDate, { message: '日期无效' })

/** 严格 24 小时时间，分钟输入补 00 秒。 */
export const timeString = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/)
  .transform((s) => s.length === 5 ? `${s}:00` : s)

export function parseId(raw: string): number | null {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

export function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: '资源不存在' })
}

export function isDupEntry(err: unknown): boolean {
  let cur: unknown = err
  for (let i = 0; i < 5 && typeof cur === 'object' && cur !== null; i++) {
    if ((cur as { errno?: number }).errno === 1062) return true
    cur = (cur as { cause?: unknown }).cause
  }
  return false
}

export function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}
