# Outbound requests name PenguinHarness in the User-Agent

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `core`, `server`, `cli`
- **PR:** [#1100](https://github.com/Prism-Shadow/penguin-harness/pull/1100)

[中文版](2026-10-13-penguinharness-user-agent.zh.md)

HTTP requests the harness builds itself now send `User-Agent: penguinharness/<version>`, for example `penguinharness/0.2.15`. Core's `userAgent()` builds the string from the release-stamped `VERSION`.

## Details

- Model requests hand the value to MMSP as a default header. It replaces the User-Agent each provider SDK sets (`OpenAI/JS …`, the Anthropic and Gemini SDK strings) instead of being appended to it, and MMSP's own client, which set none, sends it too. The endpoint model listing sends it as well.
- The update checks (`penguin update` and the server's, previously `penguin-cli` and `penguin-server`), the CLI's release manifest and installer downloads, the machines' release cache, the plugin index, the Penguin Go and ModelScope account calls, the provider OAuth exchange, balance lookups, protocol detection and the proxy reachability probe send it.
- MCP servers over HTTP or SSE receive it on every request, unless the server's entry configures its own `User-Agent`.
- The QQ, WeChat and Telegram transports send it. WeChat's `base_info.bot_agent` body field is unchanged.
- Requests to Google's official Gemini endpoint (`google-official`) still carry the Gemini SDK's own User-Agent. Requests made through the Feishu SDK, images `read_file` downloads from a URL, and the desktop shell's update requests are unchanged.
