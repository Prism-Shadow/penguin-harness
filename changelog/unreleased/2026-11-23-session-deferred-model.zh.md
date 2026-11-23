# 在当前任务结束后切换 Session 模型

- **Date:** 2026-11-23
- **Type:** feat
- **Scope:** `server`, `core`
- **PR:** [#1723](https://github.com/Prism-Shadow/penguin-harness/pull/1723)

[English](2026-11-23-session-deferred-model.md)

调用方在切换模型时发送 `whenIdle: true`，即可在 Session 忙碌时确认选择。Session 详情同时显示当前模型与待切换目标。交接与后续输入依提交顺序执行；重新选择会更新目标，进行中的请求继续执行。
