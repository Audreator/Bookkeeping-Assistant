# 指南：自有云服务器部署

仓库已有 `Dockerfile`、`compose.prod.yaml` 与 `Caddyfile`。本轮本机测试不代表云部署已经验收；以下为部署操作与验证清单。

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

## 备份与更新

数据库备份在服务器私密目录保存，包含交易与邮件原文：

```bash
docker compose -f compose.prod.yaml exec -T mysql sh -c \
  'MYSQL_PWD="$MYSQL_PASSWORD" exec mysqldump --no-tablespaces --single-transaction --user="$MYSQL_USER" --databases "$MYSQL_DATABASE"' > backup.sql
```

确认备份可读后更新代码并重新构建容器，不删除数据卷。数据库恢复前先核对目标和当前备份，具体流程参考 [维护手册](../MAINTENANCE.md)；生产恢复需要自己明确确认数据影响。
