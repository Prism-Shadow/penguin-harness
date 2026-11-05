# 等待审批的 Session 在所有列表中实时标记

- **Date:** 2026-10-07
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#1002](https://github.com/Prism-Shadow/penguin-harness/pull/1002)

[English](2026-10-07-session-approvals-event.md)

侧栏行上的审批标记只来自最近一次列表拉取，所以当用户打开着另一个对话时，开始等待工具审批的 Session 不会显示任何标记，直到列表重新加载。用户通道新增 `session_approvals` 事件，携带该 Session 等待审批的调用数，Web App 收到后立即更新对应的行。任何通过 `GET /api/events` 关注某个 Project 下各 Session 的客户端，都能知道哪个 Session 在等人处理，而无需订阅每个 Session 的流。

## 细节

- `session_approvals` 携带 `sessionId` 和 `count`，即变化后该行的 `pendingApprovalCount`，归零时同样发送。以下情况会发布该事件：调用升级给人审批；某个调用得到回答；中断或 Task 边界拒绝了等待中的调用。一次中断拒绝多个调用时只发布一个事件。受众与 `session_state` 相同。
- 由审批模式自行回答的调用（`allow-all`、`deny-all`、`read-only` 下的只读工具），以及无人值守 Session 当场拒绝的调用，都不发布事件。
- 调用本身仍以 `approval_request` 出现在该 Session 自己的流上，订阅时会重放。
- Server API 页面中英两版都列出了这个事件及其触发时机。
