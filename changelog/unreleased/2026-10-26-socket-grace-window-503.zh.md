# 被替换壳的宽限期 socket 调用改答 503 unavailable

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `server`

[English](2026-10-26-socket-grace-window-503.md)

热推送之后，旧壳还会继续服务它名下开着的 API socket 一小段宽限时间（`RECONNECT_GRACE_MS`），然后才以 1012 关闭、让客户端重连。此前在这段窗口内从这些 socket 发出的调用会以 500 `internal` 失败：推送已经 dispose 了旧 App，其模块表里已没有 HTTP 入口，而壳在查这个入口时抛了错——「正在替换」分支接的是 `undefined`，接不到抛错。现在壳把抛错的查表同样读进这个分支，窗口内的一次性调用与流调用都改答 503 `unavailable`（"The App is being replaced."），web 客户端本就把它当可重试处理：流会带着自己的 `last-event-id` 按自身退避重发，在 1012 重连后落到新壳续播；一次性调用则把这短暂的拒绝呈给调用方，而不是一次无来由的内部错误。
