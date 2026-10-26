# 向后兼容

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1336](https://github.com/Prism-Shadow/penguin-harness/pull/1336)

[English](2026-10-26-backward-compatibility.md)

## Penguin Remote 的一跳改写为 `http://` 的 `Origin`

[公共源](2026-10-26-oauth-callback-port.zh.md)之前发布的桌面端不信任任何代理，拿写请求的 `Origin` 与请求自身的来源比对，即连接的协议（明文 HTTP）加 `Host`。为了让这些桌面端经 Penguin Remote 也能接受写请求，中继的一跳（目前是用户机器上的 Penguin Remote 客户端）在浏览器的 `Origin` 指向隧道自己的主机时，把 `https://u<N>.go.penguin.ooo` 改写为 `http://u<N>.go.penguin.ooo`。有了公共源的服务端期待的是 `https://`，所以同时接受请求自身的来源，在这条改写之后照常工作。

### 范围

写请求（`/api/*` 与 `/server/*`）、API socket 与终端 WebSocket 握手、Workbench 处理器上的来源检查。没有受信任的代理时两个来源相同，行为不变。

### 你需要做什么

桌面端无需操作。只要还有本次改动之前的桌面端经中继连入，Penguin Remote 客户端就保留这条改写。

### 期限

0.3.0 之前，Penguin Remote 客户端不再改写 `Origin`，改为设置 `X-Forwarded-Proto: https` 与 `X-Forwarded-Host: <公网主机名>`，覆盖已有的值。服务端维护者在 0.3.0 删除对请求自身来源的接受（`packages/server/src/http/public-origin.ts` 中的 `acceptsOrigin`），来源检查只认公共源。
