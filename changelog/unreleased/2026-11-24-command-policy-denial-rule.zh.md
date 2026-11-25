# 命令策略拒批点出规则名

- **Date:** 2026-11-24
- **Type:** fix
- **Scope:** `core`, `server`
- **PR:** [#1835](https://github.com/Prism-Shadow/penguin-harness/pull/1835)

[English](2026-11-24-command-policy-denial-rule.md)

当命令策略规则拒绝一次工具调用时，模型读到的是「Tool call denied by user.」——一个人的取消——而实际上没有人被问到：`deny` 规则直接以 `"forbidden"` 作答，无人值守的会话（工位与工单这类没有前端可问的会话）对 `ask` 命中当场拒批。现在拒批会点出导致它的那条规则，模型读到的是一次规则拒批，会据此改变做法，而不是把它当成某个人的取消。

## 细节

- `deny` 规则的 `"forbidden"` 与无人值守对策略原因的拒批会把命中的规则名带给引擎，由引擎渲染为 ``Tool call denied by rule `<rule>`.``。
- 本人的拒绝仍是「Tool call denied by user.」，裸的 `"forbidden"` 仍是「Tool call denied by policy.」，`pre_tool_use` 钩子的拒绝仍点出钩子名与其原因。
- `approval_decision` 事件不变：仍携带纯字符串的决策值，规则名写在模型读得到的地方——被拒调用的输出里。
