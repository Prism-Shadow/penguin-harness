# 回填窗口之外的后台子会话不再冒出多余的顶层标签

- **Date:** 2026-11-25
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1851](https://github.com/Prism-Shadow/penguin-harness/pull/1851)

[English](2026-11-25-fix-subagent-session-leak.md)

修复了跨 20 轮回填窗口的后台子会话在持续输出实时消息或通过 `input_subagent` 唤醒恢复时，在当前对话流中间意外冒出独立顶层「子会话 `<id>`」标签及抢占新 `run_subagent` 卡片的问题。
