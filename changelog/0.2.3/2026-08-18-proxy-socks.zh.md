# 代理选项：SOCKS 代理地址

- **Date:** 2026-08-18
- **Type:** feature
- **Scope:** `server`
- **PR:** [#315](https://github.com/Prism-Shadow/penguin-harness/pull/315)

[English](2026-08-18-proxy-socks.md)

管理员代理地址（「代理选项」对话框，`PUT /api/admin/settings`）现在接受 undici 的 dispatcher 所能接受的任意代理 URL——`http://`、`https://`，以及（在 undici 7.29 中尚属实验性的）`socks5://` / `socks://` 方案，允许带凭证——与之并存的还有未变的裸 `host[:port]` 简写（仍规范化为 `http://…`）。

- 写入时的校验是试造一个 ProxyAgent，而不是比对一份方案白名单：凡 undici 拒绝的（`socks4://`、`ftp://` 等）都会得到 `400 invalid_proxy_url`，而不是被存下来、然后让此后每一次启动都崩溃——dispatcher 在每次启动时都会依已存地址重建，而 undici 对它讲不了的方案会在构造时抛错。
- 规范的存储形式从 `url.origin` 改为去掉解析器补出的那个裸 `/` 之后的 `url.href`：origin 会丢掉凭证，并且对 socks 这类非特殊方案会读出 `"null"`。
- Agent 环境开关会把 `socks5://` 地址逐字注入 `HTTP_PROXY` / `HTTPS_PROXY`；各类工具对在那里接受 SOCKS URL 的支持程度不一。桌面端的操作系统代理解析仍然跳过 PAC 的 SOCKS 结果，理由相同——操作系统级的 SOCKS 改为通过该对话框显式选用。
- 新增一个端到端测试，把一次 fetch 经由一个伪 SOCKS5 服务器隧道发出；环回地址的 NO_PROXY 豁免对 SOCKS 地址与此前完全一样适用。
