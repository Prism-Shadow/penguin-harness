# QQ and WeChat scan-to-connect share one ScanFlow seam and one route registrar

- **Date:** 2026-11-26
- **Type:** refactor
- **Scope:** `messaging`, `server`
- **PR:** [#1922](https://github.com/Prism-Shadow/penguin-harness/pull/1922)

[中文版](2026-11-26-messaging-scan-flow.zh.md)

The two scan-to-connect flows stopped being written twice. Each channel's scan service implements one `ScanFlow` interface, contributes it through a `MessagingModule.scanFlows` slot the way its connector contributes to `connectors`, and gets its routes from one registrar. Every path, request, response, error code and stored config document is what it was.

## Details

- `scan-flow.ts` declares `ScanFlow` — `start`, `poll`, an optional `submitVerifyCode`, `cancel`, `cancelSession` — and the poll result it returns: a status word, and on `completed` the credential to store as `{ accountId, config }`.
- `scan-routes.ts` registers `/<channel>/scan`, `/scan/poll`, `/scan/cancel`, and `/scan/verify` only for a flow that takes a pairing code, over a host the session router supplies (the owner check, the disable-first rule, storing the result). A completed poll answers the account id under the key the slot names — `appId` for QQ, `botId` for WeChat — beside the binding's masked view.
- `QQScanService` and `WeChatScanService` implement `ScanFlow`; their completed polls return the credential to store instead of a `bot` object. `QqScanFlow` and `WechatScanFlow` contribute them, and `MessagingModule` collects the slot instead of building both services itself.
- The `QQScan` interface left `bridge.ts`, and `MessagingHubModule` no longer exports it; nothing outside the test helpers read it.
- A new suite drives the registrar over HTTP with toy flows on Telegram and Feishu, which have no scan of their own.
