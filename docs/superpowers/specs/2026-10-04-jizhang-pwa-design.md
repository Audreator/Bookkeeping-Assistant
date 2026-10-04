# 记账本 PWA 设计文档（Spec）

> 历史设计（2026-10-04）。本文保留最初需求与当时选型，不是当前功能完成证明。现状以 [ARCHITECTURE](../../ARCHITECTURE.md)、[ROADMAP](../../ROADMAP.md)、[PROGRESS](../../PROGRESS.md) 与代码为准。当前固定账号注册关闭；数据库交易日期为 DATE，秒级时间另存可空字段；Worker/Web Push/ZIP 自动解密仍未实现。Apple iOS 27 已提供通知及截屏触发器，原先关于 iOS 通知/短信不可自动化的概括已过时，按 [快捷指令指南](../../guides/shortcut-ocr.md) 在实际设备验证。不要从本文的计划矩阵推断银行卡全渠道已接入。

- 日期：2026-10-04
- 修订 v2（2026-10-04）：按用户要求，数据库改为 **MySQL**，架构从"纯本地 IndexedDB"调整为 **客户端-服务器**（本机 Node 服务 + MySQL，手机局域网访问，未来直接部署到云服务器）。全部技术栈选用开源软件。
- 状态：已与用户确认（含自动化通道的物理限制说明）
- 项目目录：仓库根目录（公开版本已移除本机路径）
- 目标用户：iPhone 15 Pro+/iOS 18+，中文，单人使用（未来多用户一人一账本）

## 1. 目标

做一个添加到 iPhone 主屏幕的记账本 PWA（前后端分离、MySQL 存储）：

1. 支持**月/周双预算、可手动切换**：提前规划每天可花多少钱；当期未花完的额度按天结转；超支记负结余从之后每天扣回。
2. 消费尽量**自动入账**：银行侧实时自动（招行每笔邮件提醒）+ 余额类/花呗月度账单自动对账 + 快捷指令 OCR 作实时补充。
3. 极简清爽，一屏看清"今天还能花多少"。
4. 数据存自建服务器 MySQL，支持一键导出/导入（可加密）；多用户鉴权与数据隔离从第一天就设计好（`user_id` 全表外键，JWT 登录）。

## 2. 已确认需求

| 项 | 决定 |
|---|---|
| 交付形态 | PWA（Safari 添加到主屏幕）+ 自建 Node API 服务器，本机运行，未来部署云服务器 |
| 数据库 | **MySQL 8**（开源，Docker 官方镜像运行，数据卷持久化） |
| 技术栈 | 全部开源：React 19 / TypeScript / Vite 8 / Tailwind CSS v4 / Fastify / Drizzle ORM / TanStack Query / Vitest（见 §6） |
| 预算模型 | 月 + 周双预算，可手动切换；周期起始日可配置（默认 1 号）；周额度默认由月预算自动拆分，可手改覆盖 |
| 结转规则 | 当日未花完的额度自动加到次日；超支产生负结余，从之后每天扣回；默认不跨月结转（可开关）；周模式周内日结转，周与周之间默认清零（可开关） |
| 预算调整 | 中途改预算/切模式留调整记录；预算额调整按"（新预算 − 已发放）÷ 剩余天数"重算日额；切模式从切换日起开新期间，结转池保留 |
| 退款 | 交易可标记退款（可关联原交易）；退款金额补回当日结转池；账单导入/OCR 识别"退款"自动标记候选 |
| 固定支出 | 房租/订阅等：到期提醒 + 在"今天可花"下显示"已预留"（展示层扣减，记账后释放） |
| 功能 | 分类统计图表、固定支出提醒、搜索筛选、预算调整记录 |
| 界面 | 极简清爽，中文 |
| 安全 | 用户名+密码登录（bcryptjs 哈希、JWT 会话）；全表 `user_id` 隔离；导出备份支持口令加密（WebCrypto AES-GCM）；App 锁（PIN/Passkey）列入 M4 |
| 数据 | MySQL（utf8mb4）；数据层经 `server/src/repo` 封装；前端不直连数据库 |

## 3. 自动化通道与物理限制（已向用户说明并确认）

**硬限制**：微信、支付宝没有个人账单 API；iOS 禁止读取其他 App 的通知/短信，因此微信零钱、余额宝、花呗**不存在**纯 iPhone 实时全自动方案。

**最终自动化矩阵**：

| 消费类型 | 数据源 | 链路 | 手动量 |
|---|---|---|---|
| 银行卡/信用卡消费（含微信/支付宝绑卡、云闪付、Apple Pay） | 招行每笔邮件提醒（待开通验证；一卡通若不支持，备选：办招行信用卡 / 仅月度流水对账） | 邮件 → Cloudflare Email Worker 解析 → 本机 API 入库 → Web Push → 自动入账，退款自动补回 | 0 |
| 微信零钱 / 余额宝 / 花呗 | 微信、支付宝月度账单导出到邮箱 | 账单导入（本地解密）→ 自动去重、花呗还款拆解防重复、修正误差 | 约 1-2 分钟/月 |
| 余额类实时补充（可选） | 付款成功页 | iOS 快捷指令：Action 按钮 → 截屏 → 本地 OCR → API → 入账 | 1 次按键/笔 |
| 兜底对账 | 招行月度流水 | 导入比对，抓出邮件漏笔 | 约 1 分钟/月 |

隐私说明：数据存自建 MySQL，仅在局域网/自有服务器内流转；未来 Cloudflare Worker 只做密文中转与邮件解析（取走即删，不落库）；账单文件与密码在客户端本地解密处理。

**M1 范围**：MySQL + Node API + 前端 PWA 全部记账功能（登录、预算引擎、记账、规划、统计、搜索、固定支出、备份、账单 CSV 导入）+ 文档 + 局域网预览。
**M2 范围**：Cloudflare Worker（HTTP 收单 + Email 解析 + Web Push）、快捷指令 OCR、招行邮件提醒开通向导。
**M3 范围**：花呗还款拆解、商家自动分类学习、Web Push 提醒。
**M4 范围**：云服务器部署 HTTPS、多用户/家庭共享、App 锁（PIN/Passkey）。

## 4. 预算引擎规则（核心）

### 4.1 术语

- **期间（Period）**：月模式 = 从周期起始日到下一个起始日前一天；周模式 = 周起始日（默认周一）起 7 天。
- **基础日额 B**：当期每天"发放"的额度。
- **结转池 pool**：截至昨日，已发放额度 − 已花金额（可负）。
- **今日可花**：`B(今日) + pool(昨日) − 今日已花`（随当天账单实时变化；为负时界面显示"今日超支 ¥n"）。
- **已花**：支出为正、退款为负（仅统计已确认交易）。

### 4.2 计算规则

1. 正常日：`B = 当期生效预算 ÷ 当期总天数`。
2. 当日可花实时变化：每录一笔当天消费，今日可花立即扣减、日历中今天及之后每天的可花额同步下移；为负即"今日超支"，负池从之后每天扣回。
2. 预算额中途调整（事件日 t）：从 t 起 `B' = (新预算 − 已发放额度) ÷ 剩余天数（含 t）`，历史不回溯；保证"当期剩余可花总额 = 新预算 − 已花"。
3. 模式切换 / 周期起始日变更（事件日 t）：从 t 起开新期间（新期间起点 = t），结转池带入新期间；新预算取该模式配置值（周模式 = 手改值，否则月预算×7÷当月天数）。
4. 期间结束：`carryoverAcrossPeriod = false`（默认）时结转池清零；`true` 时正负池均带入下一期间。
5. 投影视图（规划页）：未来每天显示"假设不再消费"的累计可花额：`available_d = B_d + pool_{d-1}`，`pool_d = pool_{d-1} + B_d`。
6. 固定支出预留（展示层）：`自由可花 = 今日可花 − Σ(本期内未支付且即将到期的固定支出)`；不修改引擎数值。
7. **单独某天预算**：可对期间内任意一天单独设定金额并随时修改或取消（取消即恢复自动计算）。设定当天显示该金额（− 当日已花），**不受之前超支结转池拖累**；其他天自动重算 `B =（当期预算 − 已发放 − 本日及以后所有单独预算）÷（本日及以后无单独预算的天数）`，全期发放总额仍对齐预算。若重算后其他天被压成负数（`overridesFeasible=false`），界面提示"当前总预算不足"，但修改/取消始终可用；日历用 ★ 标记单独预算日。

### 4.3 事件时间线

所有设置变更写入 `budget_events`（事件日志，含时间、模式、月预算、周覆盖、起始日、备注），引擎以事件为唯一事实来源，保证任意一天可复算。首次使用通过引导页写入初始事件。

## 5. 数据模型（MySQL 8，utf8mb4）

所有业务表含 `user_id BIGINT UNSIGNED NOT NULL` + `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`，索引均含 `user_id` 前缀。

```sql
users            (id PK, username UNIQUE, password_hash, display_name, created_at)
categories       (id PK, user_id FK, name, icon, color, sort, type, UNIQUE(user_id, name))
transactions     (id PK, user_id FK, type ENUM('expense','refund'), amount DECIMAL(12,2),
                  category_id FK, merchant, note, occurred_at DATETIME, source ENUM('manual','ocr','import','bank-email'),
                  refund_of_id NULL, status ENUM('pending','confirmed'), created_at,
                  INDEX(user_id, occurred_at), INDEX(user_id, category_id))
budget_events    (id PK, user_id FK, at DATETIME, mode ENUM('month','week'),
                  month_budget DECIMAL(12,2), week_budget_override DECIMAL(12,2) NULL,
                  cycle_start_day TINYINT, week_starts_on TINYINT, note, created_at,
                  INDEX(user_id, at))
bills            (id PK, user_id FK, name, amount DECIMAL(12,2), category_id FK,
                  due_day TINYINT, remind_days_before TINYINT, active BOOL)
bill_payments    (id PK, user_id FK, bill_id FK, period_key VARCHAR(32), paid_at DATETIME,
                  transaction_id FK NULL, UNIQUE(user_id, bill_id, period_key))
settings         (user_id FK, `key` VARCHAR(64), value JSON, PRIMARY KEY(user_id, `key`))
```

金额一律 DECIMAL(12,2)（避免浮点误差）；日期时间存服务器本地时区 DATETIME，前端以 `YYYY-MM-DD` 展示与计算。

## 6. 技术栈（全开源）

| 层 | 选型 | 许可证 |
|---|---|---|
| 前端 | React 19 + TypeScript + Vite 8 | MIT |
| UI | Tailwind CSS v4、Recharts | MIT |
| 路由/数据 | React Router (HashRouter)、TanStack Query | MIT |
| 后端 | Node 24 + Fastify + Zod 校验 | MIT |
| ORM/驱动 | Drizzle ORM + mysql2 | Apache-2.0 / MIT |
| 鉴权 | bcryptjs + jose(JWT) | MIT |
| 数据库 | MySQL 8（Docker 官方镜像） | GPLv2 |
| 容器 | Docker Compose | Apache-2.0 |
| 测试 | Vitest（引擎/工具/API） | MIT |

## 7. 页面设计

1. **今天**：今日可花（大字）、自由可花（扣除预留）、进度环（本期已花/预算）、本期剩余、最近交易、快速记账（FAB）。
2. **账本**：搜索/筛选（关键词、分类、类型、日期、来源）、按日分组、点击编辑、标记退款/删除。
3. **规划**：月/周切换；月历每天显示可花额与消费标记；点击某天查看明细；改预算（弹窗，写事件）；调整历史列表。
4. **统计**：月份选择；分类饼图；每日支出柱状图；周/月对比；支出 Top 商家。
5. **设置**：预算配置、分类管理、固定支出、数据导出/导入（明文或口令加密）、账号信息、关于/文档。

## 8. 安全与隐私

- 全站登录：首次启动引导创建账号；bcryptjs 哈希密码；JWT（HttpOnly 不适用 SPA，存 localStorage + 短过期 + 刷新）；所有 API 按 `user_id` 过滤，越权返回 404。
- 局域网形态：MySQL 只监听本机/Docker 内网，不对局域网开放；API 对局域网开放（未来 HTTPS）。
- 备份：客户端 AES-GCM 口令加密（PBKDF2 派生）。
- 未来云：HTTPS + 反向代理、定期备份、限流；Cloudflare Worker 仅密文中转。

## 9. 验收标准（M1）

- `npm test` 全部通过（引擎边界：结转、超支负池、预算调整、模式切换、退款、周清零、自定义起始日、跨月结转开关；API 鉴权隔离；账单导入解析）。
- `npm run build` 通过；`npm run dev`（Vite + API）与 `npm run preview`（生产构建 + API）均可在局域网手机访问。
- 手机浏览器可完成：注册登录 → 记账 → 今天页数字与结转正确 → 改预算有调整记录 → 标记退款金额回补 → 导出/导入备份 → 账单 CSV 导入。
- 文档齐全：README、ARCHITECTURE、MAINTENANCE、ROADMAP、SECURITY、指南（局域网预览/账单导出/招行邮件开通草案）。

## 10. 风险

| 风险 | 应对 |
|---|---|
| 招行一卡通不支持分笔邮件提醒 | M2 验证；备选：办招行信用卡 / 仅月度流水对账（已告知用户） |
| Docker Desktop 未随开机启动 | 启动脚本 + 文档说明；或未来迁移到自有服务器 |
| 微信/支付宝账单为加密 zip | M1 支持解压后的 CSV 导入；zip 本地解密列入 M3 |
| 服务器离线时手机无法记账 | 接受（局域网/自建服务器形态）；未来可选本地缓存增强（IndexedDB 队列）列入路线图 |
