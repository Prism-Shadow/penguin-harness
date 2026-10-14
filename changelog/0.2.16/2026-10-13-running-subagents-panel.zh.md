# 跨轮次保留运行中的子智能体

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1110](https://github.com/Prism-Shadow/penguin-harness/pull/1110)

[English](2026-10-13-running-subagents-panel.md)

后续轮次派生其他子智能体时，智能体面板保留了先前仍在运行的子智能体。其节点仍可打开对应会话，并显示原有任务描述。

## 细节

- 仍在运行的子智能体与后续轮次的子智能体一起保留在默认调用图中。
- 点击历史子智能体快捷行时，仍显示该轮次的调用图。
