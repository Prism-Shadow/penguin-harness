# 工作台可以用 deny-all 审批模式打开只做对话的 Session

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `server`, `plugins`, `docs`
- **PR:** [#1588](https://github.com/Prism-Shadow/penguin-harness/pull/1588)

[English](2026-11-17-workbench-session-approval.md)

工作台现在可以为只做对话的 Session 选用已有的审批模式 `deny-all`。`host.createSession({ approvalMode: "deny-all" })` 打开的 Session 中，每一次工具调用都被拒绝。不传该选项时，工作台 Session 与以前一样是 `allow-all`。

## 细节

- `WorkbenchHost.createSession` 新增可选项 `approvalMode`：`"allow-all"`（缺省）或 `"deny-all"`，二者都是 Session 已有的审批模式。其他取值一律拒绝，错误信息写明该取值：需要人确认的模式在这里没有人作答。
- 在 `deny-all` 的 Session 中，模型对每一次工具调用读到的都是既有的拒绝行，并改用文字作答。Session 的索引行记录该模式，用户在 Web App 中打开该 Session 后可以修改它。
- 写进每个工作台 `.harness/` 的 harness README、`penguin-plugin` Skill（`2026.11.17.2`）与 Skills 文档的工作台一节都说明了这一选项。
