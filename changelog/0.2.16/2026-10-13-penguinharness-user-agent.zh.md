# 出网请求在 User-Agent 中自报 PenguinHarness

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `core`, `server`, `cli`
- **PR:** [#1100](https://github.com/Prism-Shadow/penguin-harness/pull/1100)

[English](2026-10-13-penguinharness-user-agent.md)

harness 自己构建的 HTTP 请求现在发送 `User-Agent: penguinharness/<版本>`，例如 `penguinharness/0.2.15`。这个字符串由 core 的 `userAgent()` 根据发布时盖章的 `VERSION` 生成。

## 细节

- 模型请求把它作为默认请求头交给 MMSP。它替换各家 SDK 自带的 User-Agent（`OpenAI/JS …`、Anthropic 与 Gemini SDK 的标识），而不是追加在后面；MMSP 自己的客户端原先不设 User-Agent，现在也带上它。列出端点模型的请求同样如此。
- 更新检查（`penguin update` 与服务端的检查，原先分别是 `penguin-cli` 和 `penguin-server`）、CLI 的发布清单与安装脚本下载、机器管理的发布包缓存、插件索引、Penguin Go 与 ModelScope 的账号调用、服务商 OAuth 换码、余额查询、协议探测和代理连通性测速都发送它。
- 经 HTTP 或 SSE 连接的 MCP 服务器在每个请求里都会收到它，条目自己配置了 `User-Agent` 时以配置为准。
- QQ、微信和 Telegram 的传输层发送它。微信请求体里的 `base_info.bot_agent` 字段不变。
- 发往 Google 官方 Gemini 端点（`google-official`）的请求仍带 Gemini SDK 自己的 User-Agent。经飞书 SDK 发出的请求、`read_file` 按 URL 下载的图片和桌面壳的更新请求没有变化。
