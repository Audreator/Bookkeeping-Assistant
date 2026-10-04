import { eq } from 'drizzle-orm'
import { hashPassword, verifyPassword } from './auth.ts'
import type { DB } from './db/client.ts'
import { budgetEvents, categories, settings, users } from './db/schema.ts'
import { nowDateTime, todayISO } from './util/date.ts'
import { prehashPassword } from './util/password.ts'

export const DEFAULT_CATEGORIES: Array<{ name: string; icon: string; color: string }> = [
  { name: '餐饮', icon: '🍜', color: '#f97316' },
  { name: '交通', icon: '🚇', color: '#3b82f6' },
  { name: '购物', icon: '🛍️', color: '#ec4899' },
  { name: '娱乐', icon: '🎮', color: '#8b5cf6' },
  { name: '居住', icon: '🏠', color: '#14b8a6' },
  { name: '水电通讯', icon: '💡', color: '#eab308' },
  { name: '医疗', icon: '💊', color: '#ef4444' },
  { name: '教育', icon: '📚', color: '#0ea5e9' },
  { name: '人情', icon: '🧧', color: '#f43f5e' },
  { name: '旅行', icon: '✈️', color: '#22c55e' },
  { name: '宠物', icon: '🐱', color: '#a855f7' },
  { name: '其他', icon: '📦', color: '#64748b' },
]

export async function seedUser(
  db: DB,
  userId: number,
  opts: { monthBudget?: number; cycleStartDay?: number } = {},
): Promise<void> {
  await db.insert(categories).values(
    DEFAULT_CATEGORIES.map((c, i) => ({
      userId,
      name: c.name,
      icon: c.icon,
      color: c.color,
      sort: i,
      type: 'expense',
    })),
  )

  await db.insert(budgetEvents).values({
    userId,
    at: todayISO(),
    mode: 'month',
    monthBudget: opts.monthBudget ?? 3000,
    weekBudgetOverride: null,
    cycleStartDay: opts.cycleStartDay ?? 1,
    weekStartsOn: 1,
    note: '初始预算',
    createdAt: nowDateTime(),
  })

  await db.insert(settings).values([
    { userId, key: 'reserveEnabled', value: true },
    { userId, key: 'carryoverAcrossPeriod', value: false },
  ])
}

/** 幂等补齐：老用户缺少种子时调用 */
export async function ensureSeeded(db: DB, userId: number): Promise<void> {
  const cats = await db.select().from(categories).where(eq(categories.userId, userId)).limit(1)
  if (cats.length === 0) {
    await db.insert(categories).values(
      DEFAULT_CATEGORIES.map((c, i) => ({
        userId,
        name: c.name,
        icon: c.icon,
        color: c.color,
        sort: i,
        type: 'expense',
      })),
    )
  }
  const evts = await db.select().from(budgetEvents).where(eq(budgetEvents.userId, userId)).limit(1)
  if (evts.length === 0) {
    await db.insert(budgetEvents).values({
      userId,
      at: todayISO(),
      mode: 'month',
      monthBudget: 3000,
      weekBudgetOverride: null,
      cycleStartDay: 1,
      weekStartsOn: 1,
      note: '初始预算',
      createdAt: nowDateTime(),
    })
  }
}

/**
 * 单用户模式：按配置确保固定账号存在（不存在则创建并种子；密码不一致则重置为配置值）
 */
export async function ensureDefaultUser(
  db: DB,
  input: { username: string; password: string; displayName?: string },
): Promise<void> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.username, input.username))
    .limit(1)
  if (rows.length === 0) {
    const passwordHash = await hashPassword(prehashPassword(input.password))
    const [result] = await db.insert(users).values({
      username: input.username,
      passwordHash,
      displayName: input.displayName ?? input.username,
      createdAt: nowDateTime(),
    })
    await seedUser(db, Number(result.insertId))
    return
  }
  const user = rows[0]
  const matches = await verifyPassword(prehashPassword(input.password), user.passwordHash)
  if (!matches) {
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(prehashPassword(input.password)) })
      .where(eq(users.id, user.id))
  }
}
