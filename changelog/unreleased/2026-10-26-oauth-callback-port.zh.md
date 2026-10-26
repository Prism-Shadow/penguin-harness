# TokenDance 授权后跳回 Web App 所在的端口

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `server`
- **PR:** [#PR](https://github.com/Prism-Shadow/penguin-harness/pull/PR)

[English](2026-10-26-oauth-callback-port.md)

在模型页连接 TokenDance，授权完成后浏览器被带到 `http://localhost/api/projects/<project>/model-oauth/callback?…`，地址里没有端口，跳转到不了 App，浏览器与桌面端都是如此。发起授权的请求走 Web App 的 API socket，而这条 socket 上的每个调用都以固定的 `http://localhost` 为地址，而不是页面实际打开的地址，服务端正是据此拼出回调地址。

现在 API socket 上的调用与 HTTP 请求一样，以页面建立 socket 时的源为地址：主机与端口，协议取受信任的代理（`PENGUIN_TRUST_PROXY=1`）报告的那一个。授权后跳回 App 自己的端口。以局域网地址的明文 HTTP 打开 Web App 时，也重新直接进入填写一次性授权码这一步；同一个问题曾让它变回跳转到 `localhost`。
