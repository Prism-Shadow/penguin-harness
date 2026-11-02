# 重载后跟进消息的 e2e 改为观察 API socket

- **Date:** 2026-11-03
- **Type:** process
- **Scope:** `web`
- **PR:** [#1422](https://github.com/Prism-Shadow/penguin-harness/pull/1422)

[English](2026-11-03-reloaded-followup-e2e-on-the-socket.md)

`reloaded-followup.spec.mjs` 恢复通过。API 调用改走页面的 socket 之后，这条用例在第一步就超时：它用 `page.waitForResponse` 等 `POST /tasks` 的 HTTP 响应，又用 `page.route` 布置插话的竞态，而这两者都看不到 socket 帧。它不在 CI 的 e2e 清单里，所以一直没有被发现。

## 细节

- `project-switch.spec.mjs` 原有的 socket 观察器移到 `e2e/api-socket.mjs`，由两条用例共用，并新增 `answer(method, path, { status, body })`，可以代替服务端应答一次调用。
- 用例经这个观察器布置插话的 `409 not_running`，并检查回退发出的调用帧（`queueIfBusy`、完整草稿）及其应答（`202`、`queued: true`）。
- 删去思考等级一段。它断言排队的跟进消息会携带运行中选定的等级，而思考等级改为钉在 Session 上（[#539](https://github.com/Prism-Shadow/penguin-harness/pull/539)）之后，跟进消息不再携带等级。切换确认框由 `test/thinking-level.test.ts` 覆盖。
