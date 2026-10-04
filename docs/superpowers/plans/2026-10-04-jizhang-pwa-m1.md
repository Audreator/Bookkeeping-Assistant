# 记账本 PWA M1 实施计划（v2：MySQL 架构）

> 历史实施计划（2026-10-04），勾选状态是当时的计划记录，不能作为现阶段进度或验收依据。当前验证与待办见 [PROGRESS](../../PROGRESS.md)，实际架构见 [ARCHITECTURE](../../ARCHITECTURE.md)。注册流程、Dexie 移除、收单独立令牌、秒级时间与 iOS 27 自动化已演进；新迭代按当前 AGENTS 与用户需求执行，不必重复本历史计划。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可添加到 iPhone 主屏幕的记账本 PWA：本机 Node API + MySQL 存储，月/周双预算、按天结转、超支负结转、退款回补、固定支出预留、分类统计、搜索筛选、预算调整记录、加密备份、账单 CSV 导入；本机局域网运行供手机预览，全部技术栈开源。

**Architecture:** 前后端分离。`server/`：Fastify + Drizzle ORM + MySQL 8（Docker Compose），JWT 鉴权，全表 user_id 隔离。前端：React 19 + Vite + Tailwind + TanStack Query（HashRouter），预算引擎为前端纯函数模块（TDD）。生产模式由 Fastify 静态托管 `dist/`，单端口对外。

**Tech Stack:** React 19 / TypeScript / Vite 8 / Tailwind CSS v4 / Recharts / TanStack Query / Fastify / Drizzle ORM / mysql2 / bcryptjs / jose / Vitest / Docker Compose / MySQL 8。

**Spec:** `docs/superpowers/specs/2026-10-04-jizhang-pwa-design.md`（v2）

## Global Constraints

- 全中文 UI；金额 `¥`；日期 `YYYY-MM-DD`（本地时区）；金额 DB 用 `DECIMAL(12,2)`，前端展示前经 `round2()`。
- 所有 API 路由（除 `POST /api/auth/register|login`）必须 JWT 鉴权，查询强制带 `user_id`，越权一律 404。
- 表结构见 Spec §5，新增业务表必须带 `user_id` 外键。
- 服务器与数据库的密钥只放 `.env`（gitignore），仓库只提交 `.env.example`。
- 提交信息 `feat:` / `fix:` / `chore:` / `docs:`；提交前 `npm run typecheck && npm run test:run && npm run lint` 必须通过。
- 引擎（`src/engine/`）与纯逻辑（`src/lib/`）TDD 先写失败测试。服务端路由用 Fastify `app.inject` 集成测试（需 DB 已启动）。

## Review Focus

- 浮点金额误差：DB DECIMAL ↔ JS number 的转换统一走 `round2()`。
- 周期起始日 ≠ 1 号跨月边界（如 25 号起始、2 月 28 天）。
- 预算调整日：`issuedSoFar` 只累计到调整日之前，不得重复计算。
- 周模式跨周与"周清零/跨周结转"开关组合。
- 多用户隔离：用户 A 的 token 访问用户 B 的资源必须 404。
- 账单导入去重窗口（金额相同 + 时间差 ≤3 天 + 商家相似）。

---

### Task 1: 脚手架（已完成 v1）

- [x] Vite+React+TS+Tailwind+Vitest+PWA 配置，见 commit `90888b5`。依赖以 v2 为准调整（Task 6 增服务端，Task 8 移除 Dexie）。

### Task 2: 日期工具（TDD）

**Files:** Create `src/lib/dates.ts`、`src/lib/dates.test.ts`

**Interfaces:** `todayISO()`、`toISO(d)`、`fromISO(s)`、`addDays(iso,n)`、`daysBetween(a,b)`、`startOfWeekISO(iso,1|7)`、`formatCN(iso)`、`round2(n)`、`monthKey(iso)`、`parseMonthKey(key)`。

- [ ] 红→绿：跨月加天、闰年 2/29、`daysBetween('2026-02-27','2026-03-02')===3`、周一/周日周起点、`round2(0.1+0.2)===0.3`、本地时区不漂移 → 提交 `feat: date utils`

### Task 3: 预算引擎·期间与时间线（TDD）

**Files:** Create `src/engine/types.ts`、`src/engine/period.ts`、`src/engine/period.test.ts`

**Interfaces（与 spec §4 一致）:**
- `types.ts`: `PeriodMode`、`BudgetEvent`、`EngineTx`、`DayAllowance`、`BudgetState`、`EngineInput`
- `period.ts`: `resolvePeriod(iso, mode, cycleStartDay, weekStartsOn)`、`buildSegments(events)`、`autoWeekBudget(monthBudget, iso)`

- [ ] 红→绿：起始日 1/25、周一起始、改额→切模式→再改额 的 Segment 切分、`autoWeekBudget` 跨月 → 提交 `feat: budget engine period timeline`

### Task 4: 预算引擎·发放/结转/可花（TDD 核心）

**Files:** Create `src/engine/engine.ts`、`src/engine/engine.test.ts`

**Interfaces:** `computeBudgetState(input): BudgetState`，字段见 spec §4。

**测试（≥12）:** 无消费累计可花；花 80/基础 100 → 明日 120；花 150 → 明日 50 且后续扣回；`round2` 精确；中期加/减预算公式；退款回补；周模式 + 周清零/跨周结转开关；起始日 25；模式切换池保留；未来投影。

- [ ] 红→绿 → 提交 `feat: budget rollover engine`

### Task 5: 预算引擎·固定支出预留（TDD）

**Files:** Create `src/engine/reserve.ts`、`src/engine/reserve.test.ts`

**Interfaces:** `computeReserve(bills, payments, periodStart, periodEnd, today): { reserved; reservedIds: string[]; upcoming: UpcomingBill[] }`；`UpcomingBill = { billId; name; amount; dueDate; paid; dueSoon }`。

- [ ] 红→绿：未付计入/已付不计；`dueDay=31` 小月钳制月末；`remindDaysBefore` → 提交 `feat: recurring bill reserve`

### Task 6: 服务端地基（MySQL + Fastify + Drizzle + 鉴权）

**Files:**
- Create: `compose.yaml`、`.env.example`、`server/docker/init.sql`
- Create: `server/package.json`? 否——根 `package.json` 管理全部依赖（scripts 增加 `db:up/db:down/db:migrate/dev:server/dev:all/start`）
- Create: `server/src/env.ts`、`server/src/db/client.ts`、`server/src/db/schema.ts`、`server/src/db/migrate.ts`、`server/src/auth.ts`、`server/src/app.ts`、`server/src/index.ts`
- Create: `server/src/app.test.ts`（`// @vitest-environment node`）
- Create: `server/drizzle.config.ts`、`server/tsconfig.json`

**Interfaces:**
- `compose.yaml`: mysql:8.4（utf8mb4），端口 `127.0.0.1:3306`，卷持久化，`init.sql` 创建 `jizhang` 与 `jizhang_test` 两库
- `buildApp(): FastifyInstance`（测试用 `app.inject`）
- `app.authenticate` 预处理器
- `POST /api/auth/register` → `{ token, user }`；`POST /api/auth/login`；`GET /api/auth/me`
- `GET /api/health` → `{ ok: true }`
- Drizzle schema 与 Spec §5 逐字段一致

**Tests:** 健康检查 200；注册→登录→me（token 有效）；重复用户名 409；错误密码 401；无 token 访问受保护路由 401；密码不以明文入库。

- [ ] `docker compose up -d` 等健康 → `npm run db:migrate` 建表 → 红→绿测试 → 提交 `feat: server foundation with mysql auth`

### Task 7: 服务端业务 API（路由 + 隔离测试）

**Files:**
- Create: `server/src/routes/transactions.ts`、`categories.ts`、`events.ts`、`bills.ts`、`settings.ts`
- Create: `server/src/routes/routes.test.ts`
- Modify: `server/src/app.ts`

**Interfaces（全部需 JWT，均带 user_id 过滤）:**
- `GET/POST /api/transactions`、`PUT/DELETE /api/transactions/:id`（GET 支持 `from,to,q,categoryId,type,source,status,limit`）
- `GET/POST /api/categories`、`PUT/DELETE /api/categories/:id`（有交易引用时拒绝删除 409）
- `GET/POST /api/events`
- `GET/POST /api/bills`、`PUT/DELETE /api/bills/:id`；`GET/POST /api/bill-payments`、`DELETE /api/bill-payments/:id`
- `GET/PUT /api/settings`（JSON kv）
- 分类为空时注册后自动种子 12 个默认分类 + 初始预算事件

**Tests:** CRUD 往返；筛选（from/to/type/q）；用户 A 不能读写 B 的分类/交易（404）；金额 DECIMAL 往返精度；默认分类与初始事件自动创建。

- [ ] 红→绿 → 提交 `feat: business api with per-user isolation`

### Task 8: 前端数据层 + 鉴权 + 应用骨架

**Files:**
- Create: `src/api/client.ts`、`src/api/types.ts`、`src/api/hooks.ts`、`src/state/AuthContext.tsx`、`src/pages/Login.tsx`（注册/登录/引导建账）
- Create: `src/state/useBudgetState.ts`、`src/components/TabBar.tsx`、`src/components/Page.tsx`、`src/components/Money.tsx`
- Modify: `src/App.tsx`、`src/main.tsx`、`vite.config.ts`（proxy `/api → http://127.0.0.1:8787`）
- Remove: `dexie`、`dexie-react-hooks`（`npm uninstall ...`）

**Interfaces:** `api.get/post/put/del`（带 token、401 统一处理）；TanStack Query hooks：`useTransactions(filter)`、`useCategories()`、`useEvents()`、`useBills()`、`useSettings()`；`AuthProvider` 暴露 `{ user, login, register, logout }`；五个路由页面骨架 + 底部 TabBar。

- [ ] 手测：注册→登录→刷新保持→退出；`typecheck`/`lint` 通过 → 提交 `feat: api client auth shell`

### Task 9: 快速记账 + 账本页

**Files:** Create `src/components/QuickAdd.tsx`、`src/components/TxList.tsx`、`src/components/TxEditDialog.tsx`、`src/pages/Ledger.tsx`

**Interfaces:** QuickAdd（金额键盘、分类、日期、备注、支出/退款）；TxList（按日分组 + 当日合计）；Ledger 筛选栏（关键词/分类/类型/来源/日期预置）。

- [ ] 手测：记账→今天数字变化；编辑/删除；标记退款→回补；筛选 → 提交 `feat: quick add and ledger`

### Task 10: 今天页

**Files:** Create `src/pages/Today.tsx`、`src/components/ProgressRing.tsx`

- [ ] 大字今日可花 + 自由可花（预留）+ 进度环 + 最近 5 笔 + FAB；三组场景手测 → 提交 `feat: today page`

### Task 11: 规划页

**Files:** Create `src/pages/Planner.tsx`、`src/components/MonthGrid.tsx`、`src/components/BudgetDialog.tsx`、`src/components/HistoryList.tsx`

- [ ] 月/周切换、日历可花额、点日看明细、改预算写事件、历史列表 → 提交 `feat: planner page`

### Task 12: 统计页

**Files:** Create `src/pages/Stats.tsx`、`src/lib/stats.ts`、`src/lib/stats.test.ts`

**Interfaces:** `monthlyByCategory(txs, monthKey)`、`dailyTotals(txs, monthKey)`、`topMerchants(txs, monthKey, n)`（退款冲减，纯函数）。

- [ ] 红→绿 → 饼图+柱状图+对比 → 提交 `feat: stats page`

### Task 13: 设置页（分类/固定支出/备份/账号）

**Files:** Create `src/pages/Settings.tsx`、`src/components/CategoryEditor.tsx`、`src/components/BillEditor.tsx`、`src/lib/backup.ts`、`src/lib/backup.test.ts`

**Interfaces:** `collectBackup(): Promise<BackupV1>`（从 API 拉全量）、`restoreBackup(b, passphrase?)`、`encryptBackup(data, pass)`、`decryptBackup(blob, pass)`（AES-GCM+PBKDF2）。

- [ ] 红→绿（加解密往返/错误口令失败）→ 手测导出导入、分类、账单 CRUD → 提交 `feat: settings backup categories bills`

### Task 14: 账单 CSV 导入对账

**Files:** Create `src/lib/billimport.ts`、`src/lib/billimport.test.ts`、`src/components/ImportDialog.tsx`

**Interfaces:** `parseWeChatCSV(text)`、`parseAlipayCSV(text)`、`dedupe(bills, existing, windowDays=3)`、导入写 API（source `'import'`）。

- [ ] 红→绿：真实格式样例、退款行、去重窗口边界、GBK 解码 → 提交 `feat: bill csv import`

### Task 15: PWA 资源、文档、局域网服务器验证

**Files:** Create `README.md`（更新）、`docs/ARCHITECTURE.md`、`docs/MAINTENANCE.md`、`docs/ROADMAP.md`、`docs/SECURITY.md`、`docs/guides/*.md`、`workers/relay/README.md`

- [ ] `pwa-assets-generator` 生成图标 → `npm run build` → `npm run start`（Fastify 托管 dist + API）→ `http://<PC-IP>:8787` 手机可访问 → 提交 `docs: m1 documentation and pwa assets`
- [ ] 最终评审 subagent → Critical/Important 一轮修复 → 完成

## 验收清单（M1）

- [ ] `npm run typecheck` / `npm run lint` / `npm run test:run` 全绿（含服务端集成测试）
- [ ] `docker compose up -d` + `npm run db:migrate` 后 `npm run dev:all` 或 `npm run start` 可用
- [ ] 手机同一局域网访问 `http://<PC-IP>:8787`：注册→记账→今天数字正确→改预算→退款→导入导出→账单导入
- [ ] 文档齐全无占位符
