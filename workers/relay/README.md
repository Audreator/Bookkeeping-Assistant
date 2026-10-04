# workers/relay（尚未实现）

此目录仅保留未来中转方案的说明，没有 Worker 收单、KV、Email Routing 或 Web Push 的可部署代码。当前快捷指令直接 POST Fastify 收单 API；银行邮件由服务器 IMAP 轮询处理，不依赖 Cloudflare。

后续若需要中转，先确定鉴权、HTTPS、密钥管理、暂存与保留策略、请求重试和跨来源事件 ID，再实现与验证。Cloudflare 免费额度和具体成本取决于实际配置，当前不承诺零成本。

实现状态与后续工作见 [ROADMAP](../../docs/ROADMAP.md)；当前收单参数见 [ingest-api](../../docs/guides/ingest-api.md)。
