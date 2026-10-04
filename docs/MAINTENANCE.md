# 维护手册

## 启动与更新

```powershell
npm run db:up
npm run db:migrate
npm run build
npm run start
```

Docker Desktop 需运行。服务器监听 `0.0.0.0:8787`，手机同局域网访问 `http://电脑的局域网IP:8787`；执行 `ipconfig` 查询实际 IPv4，地址可能变化。防火墙仅放行自己需要的网络。

开发用 `npm run dev:all`；前端局域网测试可执行 `npm run dev -- --host` 并另启 `npm run dev:server`。普通 `npm run preview` 只有静态服务，不能代替 API。

每次 schema 更新先备份生产库，再迁移。代码变更后确认 8787 原进程已停止，重新构建并启动；关闭一个终端不代表其他后台 Node 服务已停止。可用 `Get-NetTCPConnection -LocalPort 8787 -State Listen` 查进程，然后核对启动命令。

前端更新后，已经打开的页面可能仍引用旧构建资源。刷新或重新打开入口以加载新版本；新构建在页面资源/渲染失败时显示「刷新页面」恢复提示，不自动循环刷新或清空 localStorage。旧缓存中的代码本身不含新保护，出现空白时先手动刷新。恢复后核对登录和账本，无需删除服务器数据或清除整个站点存储。

## 开发约定与检查

```powershell
npm run typecheck
npm run test:run
npm run lint
npm run build
```

- 服务端集成测试必须使用库名以 `_test` 结尾的独立库。不能把 `TEST_DATABASE_URL` 指向真实账本，也不能回退到 `DATABASE_URL`；测试会清理测试数据。
- 改 `server/src/db/schema.ts` 后，运行 `npm run db:generate` 并检查生成 SQL，再 `npm run db:migrate`。不可删除数据卷代替迁移。
- 引擎、纯工具与支付解析规则先写失败测试；收单变更覆盖真实模板、失败/处理中状态、金额冲突、秒级时间、事件重试与并发。
- 前端数据经 `src/api/hooks.ts` / `client.ts`，不在页面直接调用数据库。金额展示用 `Money` 或 `round2()`。
- 修改影响指南、API 字段或已知边界时同步文档；验证证据写入 [PROGRESS](PROGRESS.md)，不要写固定的测试数量以免过期。
- 固定支出支付使用 `POST /api/bills/:id/pay`，服务器事务同时写交易与期间支付标记；不要恢复旧的两次请求流程，以免中断后重试重复消费。

## 秒级时间迁移

新增 `transactions.occurred_time`（可空）及收单唯一键 `ingest_key`。原 `occurred_at` 日期保持，旧记录时间和收单键保持空值。旧记录不自动获得真实交易秒数，也不自动参与新收单幂等键。

`occurredAt` 是交易日期，`occurredTime` 是交易时间，`createdAt` 是录入时间。只提供分钟的输入补 `:00`；退款时间来自本次退款，不沿用原支付时间。修改解析器前在 [收单合约](guides/ingest-api.md) 检查参数兼容性。

## 自动化配置

- `INGEST_TOKEN`：个人收单令牌；修改后重启服务，同时更新自己的快捷指令。
- `INGEST_USER`：可选入账用户 ID；缺省第一个用户，未来多人使用前必须显式配置。
- IMAP：`IMAP_USER`、`IMAP_PASS`、`AUTO_EMAIL_USER` 等，先 `npm run email:dry` 校准真实样本，再开启正常轮询。注意 dry 命令会打印发件人、商户与正文摘要，输出不适合公开分享。
- 没有离线发送队列；自动化失败时保留原 `eventId` 并在网络恢复后重试。

## 备份与恢复

主屏幕图标源为 `public/logo.svg`（纯色 2D）。修改后执行 `node scripts/generate-icons.cjs`，使用现有图标工具依赖链的 `sharp` 同步 Apple/PWA/favicon PNG 与 ICO，再 `npm run build`。Apple 图标地址含版本参数；替换图标时更新 `index.html` 中参数。已添加主屏幕的 iPhone 可能缓存旧图标，可移除原快捷入口后从 Safari 分享 → 添加到主屏幕重新添加；这不会删除服务器账目。

App：设置 → 数据 → 导出备份或加密导出。加密导出/恢复依赖浏览器安全上下文，在手机局域网 HTTP 下不可用；使用 HTTPS 或普通 JSON 备份。普通备份包含个人账目，保存到自己的私密位置。恢复是追加式 ID 映射，不是清空替换；重复恢复前先确认账本已有数据。全量交易通过分页读取，避免超过接口默认页大小时漏备份。

数据库备份示例使用容器配置，不在命令里写真实密码：

```powershell
docker exec jizhang-mysql sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysqldump --no-tablespaces --single-transaction --user="$MYSQL_USER" --databases "$MYSQL_DATABASE"' | Set-Content -Encoding utf8 backup.sql
```

恢复会修改目标数据库，先保存当前备份并核对目标库。PowerShell 7 使用 UTF-8 读取：

```powershell
Get-Content -LiteralPath backup.sql -Raw -Encoding utf8 | docker exec -i jizhang-mysql sh -c 'exec mysql --user="$MYSQL_USER" --password="$MYSQL_PASSWORD"'
```

旧 Windows PowerShell 默认重定向编码可能不是 UTF-8，不能未经检查把旧输出导回数据库。`backup.sql` 可能包含完整交易与邮件原文，只保留在自己的私密存储。恢复成功应抽查中文、金额、记录数和秒级时间。

## 常见排障

| 现象 | 处理 |
|---|---|
| Docker 无法连接 | 启动 Docker Desktop，检查容器健康；拉镜像问题检查网络/镜像配置 |
| 页面打不开 | 电脑服务、同局域网、IPv4 与防火墙 8787 |
| 未登录/其他设备登录提示 | 固定账号重新登录；单设备会话会让旧设备失效 |
| 登录冷却 | 连续错误后等待 5 分钟；不要用反复尝试替代核对密码 |
| 忘记密码 | 更新 `.env` 的 `DEFAULT_PASSWORD`，停止旧服务再启动 |
| 新字段不存在 | 新进程是否应用正确迁移、是否连到预期数据库 |
| OCR 422 | 原文缺成功状态或金额不明确；保留匿名样本添加测试，再手工补录 |
| 同金额漏记 | 提供真实交易时间/稳定来源交易号 `eventId`；核对 duplicate 返回 |
| 手机快捷指令显示成功但账本未刷新 | 确认实际 HTTP 返回与归属用户；刷新账本，外部写入可能等待轮询 |
| IMAP 无交易 | 检查授权码、分笔邮件是否实际收到、dry 解析与发件过滤 |
