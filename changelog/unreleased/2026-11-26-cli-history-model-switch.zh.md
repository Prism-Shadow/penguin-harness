# CLI 历史回放与 Session 日志的模型切换交接渲染

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `cli`
- **PR:** [#1890](https://github.com/Prism-Shadow/penguin-harness/pull/1890)

[English](2026-11-26-cli-history-model-switch.md)

更新了 CLI 历史回放和 `penguin session log -f`，将原地切换模型产生的 Trace 交接记录渲染为单行切换提示，不再显示原始的 `[model_switch_from]` 提示块。

## 细节

- 在 `penguin chat --resume` 和 `penguin session log` 回放历史记录时，将原地 `[model_switch_from]` 交接消息渲染为与实时切换一致的单行切换提示。
- 向历史回放和 `penguin session log -f` 传入当前 Session 标识，使 `--tail` 截断早期 `session_meta` 或实时流尚未收到 `session_meta` 时仍能识别原地切换。
- 跨 Session 的 `[model_switch_from]` 消息以及子 Agent 的嵌套消息仍按普通用户输入渲染。
