# 指南：自有云服务器部署

仓库已有 `Dockerfile`、`compose.prod.yaml` 与 `Caddyfile`。以下 Docker／Caddy 通用流程需在自己的目标环境验收；已有线上专项修复与接口验证见 [实施记录](../PROGRESS.md)。

## 准备与配置

自有 Linux 服务器具备 Docker 与 Compose、域名指向服务器公网 IP、允许 HTTPS 80/443 的访问。上传代码或从自己的仓库拉取；首次复制 `.env.prod.example` 为 `.env`，填写实际值：

- `DOMAIN`：实际域名；
- MySQL 用户、数据库与强密码，勿保留示例 `change-me`；
- `JWT_SECRET`：随机长密钥；
- `DEFAULT_USERNAME` / `DEFAULT_PASSWORD`：固定个人账号；
- `INGEST_TOKEN`：独立随机收单令牌；如需指定归属，增加数字 `INGEST_USER`；
- IMAP 可按 [QQ IMAP](qq-imap.md) 单独填写，校准前不要启用自动入账。

`.env` 不入库。更新已有部署时保留原配置与数据库卷，先备份。

## 启动与验证

```bash
docker compose -f compose.prod.yaml up -d --build
docker compose -f compose.prod.yaml logs -f app
```

应用容器先迁移再启动；Caddy 按域名提供 HTTPS。数据库只在容器网络，应用只给内部代理暴露 8787，外部经 Caddy 80/443 访问。证书能否签发取决于域名解析、端口与部署网络，需查看日志确认。

应用与数据库均显式使用 `Asia/Shanghai`，镜像包含时区数据；保持该设置以免凌晨缺省日期落到前一天。构建上下文通过 `.dockerignore` 排除真实 `.env`、本机备份和日志。生产镜像构建与部署仍需在目标服务器验证。

1. 浏览器访问自己的 HTTPS 域名并登录，核对使用的数据库与账号。
2. iPhone Safari 登录并添加到主屏幕，检查五页与记账/退款。
3. 快捷指令收单 URL 改为 `https://自己的域名/api/ingest/ocr` 或 `/api/ingest/transaction`；用真实金额样本和稳定事件 ID 验证一次入账及重复。
4. 在手机蜂窝网络重复访问，确认服务公网可达。
5. 做备份与恢复演练，检查中文与时间；查看 [SECURITY](../SECURITY.md) 的部署边界。

HTTPS 可满足 Service Worker 的安全上下文要求，已有静态壳缓存配置；当前没有离线记账队列、Web Push 或 Cloudflare Worker。电脑关机不影响独立云服务器，但云服务也需要持续运行和网络。

## 已有服务与子目录代理

已有服务器运行其他项目时，可让自己的现有代理转发到记账服务的独立回环端口；上面的 Docker／Caddy 示例不是必须覆盖现有代理的操作。保留其他服务、现有私密配置和数据库，只更新这个项目。

网页与 API 默认使用同一部署目录。例如页面为 `https://example.com/budget/#/login`，登录请求为 `/budget/api/auth/login`，快捷指令地址为 `https://example.com/budget/api/ingest/ocr`。Vite 的相对资源路径和 API 运行时路径推导让同一通用构建支持根目录及子目录，无需把真实入口写入公开仓库。

- 代理将 `/budget` 重定向到 `/budget/`，确保相对脚本、图标、Service Worker 和 API 都从正确目录解析。
- `/budget/...` 转发时去掉 `/budget`，后端仍接收原有 `/api/...`；HTTP 入口转到 HTTPS。
- API 与页面目录不同才显式配置 `VITE_API_BASE`。它是**构建变量**，在宿主机 `npm run build` 前设置或放入自己的私密构建环境文件；运行期仅修改后端 `.env` 不会改变已生成的 JS。空值自动推导，`/` 显式使用根 API。现有 Dockerfile 没有传入这个构建参数，同目录部署无需增加参数。
- 构建变量可被浏览器读取，不要放密码、JWT 密钥或收单令牌；难猜的入口也不能代替登录与收单鉴权。

每次静态发布先保留项目的旧 `dist` 和不可变 assets，再完整更新构建。通过实际公网入口确认 HTML 引用了新主包、主包可以读取、同目录的 `/api/health` 返回 JSON，以及一次正常登录后 `/api/auth/me` 能读取会话。单设备模式下成功登录会使旧会话失效；不要反复执行生产登录诊断，不输出密码或响应令牌。仅静态更新不需要重启后端。已有标签页和桌面 PWA 刷新／重新打开后再登录，账号密码无需因此修改。

## 备份与更新

数据库备份在服务器私密目录保存，包含交易与邮件原文：

```bash
docker compose -f compose.prod.yaml exec -T mysql sh -c \
  'MYSQL_PWD="$MYSQL_PASSWORD" exec mysqldump --no-tablespaces --single-transaction --user="$MYSQL_USER" --databases "$MYSQL_DATABASE"' > backup.sql
```

确认备份可读后更新代码并重新构建容器，不删除数据卷。数据库恢复前先核对目标和当前备份，具体流程参考 [维护手册](../MAINTENANCE.md)；生产恢复需要自己明确确认数据影响。
