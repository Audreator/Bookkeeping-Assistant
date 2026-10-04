# 当前架构

## 总览

```text
iPhone Safari / 主屏幕 PWA
        │ HTTP(S) /api（登录 JWT）
        ▼
Fastify 服务器（server/，端口 8787）
        │ Drizzle ORM / mysql2
        ▼
MySQL 8（本地 Docker，127.0.0.1:3306）
        ▲
        │ 收单路由 / 可选 IMAP 轮询
个人快捷指令（独立 INGEST_TOKEN）/ 银行邮件
```

- 生产模式 `npm run start` 提供 `dist/` 与 API；开发模式 `npm run dev:all` 启动 Vite 5173 和 API 8787，Vite 代理 `/api`。
- React SPA 用 HashRouter；数据通过 API 存入 MySQL，当前没有 Dexie 数据库与离线交易队列。
- 统计页按需加载；应用错误边界对渲染或页面资源加载失败给出中文刷新提示，不自动反复刷新，也不清除登录和账本数据。旧入口需先刷新到新构建才获得这项保护。
- 固定单用户登录，生产注册关闭；业务表仍按 `user_id` 隔离。新增设备登录会使原会话失效。
- 公开源码不预填个人账号；固定账号来自本机 `.env`，示例用户名为 `owner`。真实密码、JWT/收单令牌和数据库连接不进入前端构建，运行期配置与发布源码分别保存。

## 目录职责

| 路径 | 职责 |
|---|---|
| `src/engine/` | 预算引擎纯函数与 TDD 测试 |
| `src/lib/` | 日期、统计、备份、CSV 解析与纯逻辑测试 |
| `src/api/` | fetch 封装、类型、TanStack Query hooks |
| `src/state/` | 登录态与引擎输入组装 |
| `src/pages/` | 今天、账本、规划、统计、设置与登录 |
| `src/components/` | 交易、记账弹窗、日历、导航、备份导入等 |
| `server/src/routes/` | JWT 业务 API 与独立令牌收单 API |
| `server/src/ingest/` | 支付文本解析及测试 |
| `server/src/email/` | 邮件解析、收据审计、可选 IMAP 轮询 |
| `server/src/db/` | Drizzle schema、连接与迁移辅助 |
| `server/drizzle/` | SQL 迁移及 schema 快照 |
| `workers/relay/` | 中转设计占位，尚无部署代码 |
| `docs/superpowers/` | 原始 spec/计划历史，不是当前完成清单 |

前端通过 `src/api/hooks.ts` / `client.ts` 访问数据。当前服务器路由直接使用 Drizzle；尚未抽出 server repo。不要依赖历史文档中不存在的 `src/db/repo.ts` 或 Dexie 表。

## 预算数据流

1. `useBudgetState` 从 API 拉取交易、预算事件、设置、固定支出与单日预算配置。
2. `computeBudgetState` 按日模拟发放、支出/退款与结转，今日可花 = 昨日结转池 + 今日基础日额 − 今日已花。
3. 调整预算按剩余预算重新分配；模式切换从当日新开期间，结转池按实际规则传递。
4. 单独设预算的当天用设定额减当日已花，其他天重新均摊；可修改/取消，无法均摊时提示总预算不足。
5. `computeReserve` 将当前期间未付固定支出作为展示层预留，不直接修改引擎。
6. 秒级交易时间用于记录展示与收单去重，预算按 `occurredAt` 日期汇总。

## 交易与收单数据流

- 普通交易 API：JWT 鉴权 → 用户过滤/归属校验 → 数据库 → 序列化返回。
- 文本收单：独立令牌 → 参数校验 → 最终状态/金额解析 → 显式或文本日期/时间 → 唯一键去重 → 入账。
- 结构化收单：独立令牌 → 类型、正金额、日期/时间校验 → 唯一键去重 → 入账。调用方负责先确认支付或退款成功。
- 固定支出支付：`POST /api/bills/:id/pay` 在服务端事务中同时创建支出与本期支付标记，按账单/期间防重；前端不再分两次请求完成付款。
- IMAP：邮件扫描 → 完整邮箱/域名边界过滤 → 复用严格支付解析 → 数据库事务中的 Message-ID 收据与交易。此通道需真实样本校准，地址过滤并非签名验证，不能等同于跨来源自动对账。

## 关键约定

- 金额：DB `DECIMAL(12,2)`，JS 展示/输出经 `round2()`。收单金额最多两位小数。
- `transactions.occurredAt` / `occurred_at` 是本地 `YYYY-MM-DD` 日期；`occurredTime` / `occurred_time` 为可空 `HH:mm:ss`。OCR/实时通知按用户规则优先消息时间、缺省接收时间；接收时间不进入去重指纹。旧记录、邮件、CSV 等未知来源时间保持空。
- `ingestKey` / `ingest_key` 为收单唯一键；稳定 `eventId` 支持并发重试。缺少来源交易号或真实时间时不能区分所有同额交易。
- `createdAt` 是录入时间。当前部署使用 Asia/Shanghai，业务日期与时间不含 UTC 偏移。
- 预算事件是设置变化的事实来源；交易类型仅 `expense` 和 `refund`，普通收入不是当前预算产品的交易类型。
- 通知、短信、Wallet 等输入由快捷指令提供；PWA 自己不能直接监听其他 App 的交易通知。
