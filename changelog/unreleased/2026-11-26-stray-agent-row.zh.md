# stop hook 派生的会话不再在对话里留下一条智能体行

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1869](https://github.com/Prism-Shadow/penguin-harness/pull/1869)

[English](2026-11-26-stray-agent-row.md)

stop hook 以 `subagent` 作答时（`continual-learning` 插件在长 Task 结束后就会这样做），最后一条回复下方会多出一条智能体行，点开后智能体面板却是空的。这条行已去掉：hook 派生的会话是游离运行的，不属于这个对话的子智能体。

## 细节

- 对话的流模型记下 `stop` hook 事件在 `output.session_id` 里点名的会话 id，并丢弃该会话发到父会话流上的记录，因此它在对话里不再有行，也不再有嵌套对话。
