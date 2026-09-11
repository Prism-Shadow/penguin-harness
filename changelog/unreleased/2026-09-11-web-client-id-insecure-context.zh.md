# 在 `crypto.randomUUID` 不存在处生成客户端 id

- **Date:** 2026-09-11
- **Type:** fix
- **Scope:** `web`

[English](2026-09-11-web-client-id-insecure-context.md)

Web 应用不再调用 `crypto.randomUUID`——浏览器只在安全上下文中定义它。通过明文 HTTP 访问的 harness（局域网中常见的 `http://<host>:7364`）上，「新建对话」与「保存快捷指令」两个按钮会以 `TypeError: crypto.randomUUID is not a function` 直接失败，任何请求都还没发出。

## 细节

- `randomUuid()`（`packages/web/src/lib/random-uuid.ts`）用 `crypto.getRandomValues` 拼出 v4 UUID——后者没有安全上下文的限制——只有在 Web Crypto 完全缺失时才退回 `Math.random`。它是随机而非保密：这些 id 是服务端保存并回传的句柄，没有任何东西以它们做认证。
- 两个调用方——暂存草稿 id（`features/chat/draft-sessions.ts`）与已保存快捷指令 id（`features/chat/user-shortcuts.ts`）——改为从这里取 id，切片方式与原先完全一致，因此 `draft-` 与 `sc-` 前缀及其长度均未改变。
- `test/random-uuid.test.ts` 固定住 v4 形状与两种上下文：在移除 `Crypto.prototype.randomUUID` 后能生成 id，在全局完全没有 Web Crypto 时也能生成 id。
