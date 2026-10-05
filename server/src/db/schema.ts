import {
  bigint,
  boolean,
  date,
  datetime,
  decimal,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  tinyint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core'

export const users = mysqlTable('users', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  username: varchar('username', { length: 64 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 100 }).notNull(),
  displayName: varchar('display_name', { length: 64 }).notNull(),
  /** 当前唯一有效的登录会话（单设备登录）；每次登录换新，登出清空 */
  sessionId: varchar('session_id', { length: 64 }),
  /** 连续密码错误次数，成功后清零 */
  failedAttempts: tinyint('failed_attempts').notNull().default(0),
  /** 冷却截止时间（YYYY-MM-DD HH:mm:ss），为空表示未锁定 */
  lockedUntil: datetime('locked_until', { mode: 'string' }),
  createdAt: datetime('created_at', { mode: 'string' }).notNull(),
})

export const categories = mysqlTable(
  'categories',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 32 }).notNull(),
    icon: varchar('icon', { length: 16 }).notNull().default(''),
    color: varchar('color', { length: 16 }).notNull().default('#64748b'),
    sort: int('sort').notNull().default(0),
    type: varchar('type', { length: 16 }).notNull().default('expense'),
  },
  (t) => [uniqueIndex('uq_cat_user_name').on(t.userId, t.name)],
)

export const transactions = mysqlTable(
  'transactions',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: mysqlEnum('type', ['expense', 'refund']).notNull(),
    amount: decimal('amount', { precision: 12, scale: 2, mode: 'number' }).notNull(),
    categoryId: bigint('category_id', { mode: 'number', unsigned: true }).references(
      () => categories.id,
      { onDelete: 'set null' },
    ),
    merchant: varchar('merchant', { length: 128 }),
    note: varchar('note', { length: 256 }),
    occurredAt: date('occurred_at', { mode: 'string' }).notNull(),
    /** 原交易本地时间；未知历史时间保持 NULL，不使用入库时间代替 */
    occurredTime: varchar('occurred_time', { length: 8 }),
    /** 自动入账幂等指纹；手动/历史记录为空 */
    ingestKey: varchar('ingest_key', { length: 64 }),
    source: mysqlEnum('source', ['manual', 'ocr', 'import', 'bank-email'])
      .notNull()
      .default('manual'),
    refundOfId: bigint('refund_of_id', { mode: 'number', unsigned: true }),
    status: mysqlEnum('status', ['pending', 'confirmed']).notNull().default('confirmed'),
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
  },
  (t) => [
    index('idx_tx_user_occurred').on(t.userId, t.occurredAt),
    index('idx_tx_user_category').on(t.userId, t.categoryId),
    uniqueIndex('uq_tx_user_ingest').on(t.userId, t.ingestKey),
  ],
)

export const budgetEvents = mysqlTable(
  'budget_events',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    at: date('at', { mode: 'string' }).notNull(),
    mode: mysqlEnum('mode', ['month', 'week']).notNull(),
    monthBudget: decimal('month_budget', { precision: 12, scale: 2, mode: 'number' }).notNull(),
    weekBudgetOverride: decimal('week_budget_override', {
      precision: 12,
      scale: 2,
      mode: 'number',
    }),
    cycleStartDay: tinyint('cycle_start_day').notNull(),
    weekStartsOn: tinyint('week_starts_on').notNull(),
    note: varchar('note', { length: 128 }),
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
  },
  (t) => [index('idx_evt_user_at').on(t.userId, t.at)],
)

export const bills = mysqlTable('bills', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number', unsigned: true })
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 64 }).notNull(),
  amount: decimal('amount', { precision: 12, scale: 2, mode: 'number' }).notNull(),
  categoryId: bigint('category_id', { mode: 'number', unsigned: true }).references(
    () => categories.id,
    { onDelete: 'set null' },
  ),
  dueDay: tinyint('due_day').notNull(),
  remindDaysBefore: tinyint('remind_days_before').notNull().default(3),
  active: boolean('active').notNull().default(true),
})

export const billPayments = mysqlTable(
  'bill_payments',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    billId: bigint('bill_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => bills.id, { onDelete: 'cascade' }),
    periodKey: varchar('period_key', { length: 32 }).notNull(),
    paidAt: date('paid_at', { mode: 'string' }).notNull(),
    transactionId: bigint('transaction_id', { mode: 'number', unsigned: true }),
  },
  (t) => [uniqueIndex('uq_billpay').on(t.userId, t.billId, t.periodKey)],
)

/** 真实流水的固定支出部分；原交易金额与统计始终保持不变。 */
export const billAllocations = mysqlTable(
  'bill_allocations',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number', unsigned: true }).notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    transactionId: bigint('transaction_id', { mode: 'number', unsigned: true }).notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    billId: bigint('bill_id', { mode: 'number', unsigned: true }).notNull()
      .references(() => bills.id, { onDelete: 'restrict' }),
    periodKey: date('period_key', { mode: 'string' }).notNull(),
    amount: decimal('amount', { precision: 12, scale: 2, mode: 'number' }).notNull(),
  },
  (t) => [
    uniqueIndex('uq_bill_allocation').on(t.userId, t.transactionId, t.billId, t.periodKey),
    index('idx_bill_allocation_occurrence').on(t.userId, t.billId, t.periodKey),
  ],
)

export const emailReceipts = mysqlTable(
  'email_receipts',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    messageId: varchar('message_id', { length: 255 }).notNull(),
    fromAddr: varchar('from_addr', { length: 255 }).notNull(),
    subject: varchar('subject', { length: 255 }).notNull().default(''),
    receivedAt: datetime('received_at', { mode: 'string' }),
    status: mysqlEnum('status', [
      'parsed',
      'refund',
      'ignored',
      'unrecognized',
      'duplicate',
      'error',
    ]).notNull(),
    transactionId: bigint('transaction_id', { mode: 'number', unsigned: true }),
    note: varchar('note', { length: 255 }),
    rawText: text('raw_text'),
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
  },
  (t) => [
    uniqueIndex('uq_email_msg').on(t.userId, t.messageId),
    index('idx_email_user').on(t.userId, t.id),
  ],
)

export const dayOverrides = mysqlTable(
  'day_overrides',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    amount: decimal('amount', { precision: 12, scale: 2, mode: 'number' }).notNull(),
    note: varchar('note', { length: 128 }),
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
  },
  (t) => [uniqueIndex('uq_day_override').on(t.userId, t.date)],
)

export const settings = mysqlTable(
  'settings',
  {
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: varchar('key', { length: 64 }).notNull(),
    value: json('value').$type<unknown>(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
)
