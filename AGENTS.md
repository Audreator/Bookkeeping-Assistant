# AGENTS.md

记账本 PWA：个人自托管预算记账应用（中文 UI），当前架构为 React + Fastify + MySQL，尚无离线写入队列。

## 常用命令

| 命令 | 说明 |
|---|---|
| `npm run db:up` / `db:down` | 启动/停止 MySQL 8 容器（Docker Desktop 需运行） |
| `npm run db:generate` / `db:migrate` | 生成/应用数据库迁移（改 schema 后） |
| `npm run dev:all` | 同时启动 Vite(5173) 与 API(8787)（开发） |
| `npm run start` | 生产模式：Fastify 托管 `dist/` + API，监听 0.0.0.0:8787 |
| `npm run dev -- --host` | 仅前端开发服务器（局域网手机预览） |
| `npm run build` | 类型检查 + 生产构建（输出 `dist/`） |
| `npm test` | Vitest watch 模式 |
| `npm run test:run` | Vitest 单次运行（CI/提交前） |
| `npm run typecheck` | TypeScript 全量类型检查 |
| `npm run lint` | oxlint |

## 目录

- `src/engine/` 预算引擎（纯函数，改动必须先写测试）
- `src/api/` fetch client、API 类型与 TanStack Query hooks（当前无 Dexie / `src/db/`）
- `server/src/db/` Drizzle schema、MySQL 连接；`server/drizzle/` 版本化迁移
- `server/src/routes/` 登录业务 API 与独立令牌收单 API
- `server/src/ingest/` 支付/退款文本解析（纯函数，TDD）
- `server/src/email/` 银行邮件解析、IMAP 轮询与收据审计
- `src/pages/` 五个页面：今天/账本/规划/统计/设置
- `src/components/` 通用组件
- `src/lib/` 日期、备份、账单导入、锁等工具
- `docs/` 设计文档、维护文档、用户指南
- `workers/` Cloudflare Worker 设计预留，尚无可部署实现

## 约定

- 金额以元存储，输出一律经 `round2()`；日期一律 `YYYY-MM-DD` 本地时区字符串。交易时间单独为可空 `occurredTime`（`HH:mm:ss`），不得用创建时间伪造历史交易时间。
- UI 全中文；新增文案不得使用占位符。
- 预算引擎（`src/engine/`）、纯逻辑工具（`src/lib/`）、支付/邮件解析必须 TDD：先写失败测试。
- 提交前必须通过：`npm run typecheck`、`npm run test:run`、`npm run lint`。
- 前端数据访问统一通过 `src/api/hooks.ts` / `client.ts`，页面不直接操作数据库；当前服务端路由使用 Drizzle，尚无 repo 层。
- 服务端集成测试必须使用名称以 `_test` 结尾的独立测试库，不回退生产 `DATABASE_URL`；测试会清理数据。
- 收单调用使用稳定 `eventId`，未知文本不猜支付/退款结果；真实令牌、邮件原文与备份不得提交到 Git。
- 固定用途用 `bill_allocations` 分摊原流水，不拆成假付款；金额按分汇总，实际统计保留原额，仅当期分摊抵扣日常。关联写入/交易修改统一先锁用户行，退款按发生日期校验覆盖。旧支付标记不猜金额，备份用 `markerOnly` 恢复。
- 每轮迭代同步更新 `docs/PROGRESS.md`、当前架构和受影响指南，分别记录自动检查、服务重启和真机验证；原始 spec/计划仅作历史背景。

## 文档索引

- 设计：`docs/superpowers/specs/2026-10-04-jizhang-pwa-design.md`
- 架构：`docs/ARCHITECTURE.md`
- 维护：`docs/MAINTENANCE.md`
- 路线图/自动化方案：`docs/ROADMAP.md`
- 安全模型：`docs/SECURITY.md`
- 实施与验证记录：`docs/PROGRESS.md`
- 收单合约：`docs/guides/ingest-api.md`
- 固定支出分摊：`docs/guides/fixed-expenses.md`
- 指南：`docs/guides/`
