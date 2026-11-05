# 组织的工具调用当场被拒，不再挂着等人

- **Date:** 2026-09-17
- **Type:** fix
- **Scope:** `server`, `skills`
- **PR:** [#785](https://github.com/Prism-Shadow/penguin-harness/pull/785)

[English](2026-09-17-org-approval-deny.md)

公司模式下，审批模式判给人的工具调用现在在发起的那一刻即被拒绝，不再挂起整个运行等人答复。工位会话、工单会话以及它们派生的子会话都没有人在看，`read-only` 下一次读写调用足以让一轮工作永远停在那里。员工协议把这条拒绝当作向董事会请示的信号。

## 细节

- 服务端交给 `Session.run` 的审批回调（`makeApprove`，由 `SessionManager.entryApprove` 按 Session 构造）新增 `unattended` 读取，与审批模式一样逐次决策重读。它取会话行上持久的 `client = "org"` 标记——组织运行时开出的每个会话，以及继承该标记的子会话。标记成立时，唯一会等人的那条路径当场答 `deny`，也不再推 `approval_request`；自动判定（`allow-all`、`deny-all`、`read-only` 的只读工具）与命令策略的否决一律不变。开发模式的会话在同样的审批模式下照旧挂起等用户。
- 模型读到的仍是既有的固定 `aborted` 工具结果 `Tool call denied by user.`；没有新增消息类型、字段或决策值。
- `company-employee`（插件 `agent-company` `2026.09.17.2`）在「What you may not decide alone」与无人值守那条提醒里写明：工位会话或工单会话里的一次拒绝意味着根本没人被问到，因而是向董事会请示的信号——在频道里 @ 创建者、`penguin org ticket block --by user:<id>`、结束本轮——而不是换个写法重试。同时点明 `read-only` 组织顺带拒掉的东西：`penguin org` 命令本身走的就是读写工具。
- 组织运行时里仍以旧工单标题命名的注释（`Parent`、`Blocked`、「the header」）改写为 frontmatter 字段，`company-finance` 同此；`OrgStore.listTickets` 的说明改为它实际列出的文件——它从未按工单 id 的格式过滤文件名。
