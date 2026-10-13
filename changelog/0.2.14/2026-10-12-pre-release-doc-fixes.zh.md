# 文档与 Skill：Agent API 的并发上限、审批示例、整页退出快捷键和工具包插件名

- **Date:** 2026-10-12
- **Type:** process
- **Scope:** `docs`, `skills`, `landing`
- **PR:** [#1080](https://github.com/Prism-Shadow/penguin-harness/pull/1080)

[English](2026-10-12-pre-release-doc-fixes.md)

在 0.2.14 发布前，改正了四处与产品不符的说法。

## 细节

- Agent API 页面写的是一个 Agent 最多同时进行四个「API 运行」。实际上限按该 Agent 所有正在运行的对话计算，Web App 里发起的也算在内；四个都在运行时，在新对话或空闲对话上发起的运行会被拒绝。`penguin-sdk` Skill 的 API 参考写法相同，一并改正。
- 该页面和 `penguin-sdk` Skill 的审批示例读取 `args?.command`，但 `exec_command` 的参数叫 `cmd`，示例因此会拒绝所有调用。现改为 `args?.cmd`。
- `penguin-plugin` Skill 说退出整页 workflow 要按 Ctrl+P 或 Ctrl+Shift+P。命令面板的快捷键实际是 Ctrl+Alt+P（macOS 上为 ⌥⌘P），并且可以改绑；Skill 已据此改写，并要求页面永远不要对这个组合键调用 `preventDefault`。两个 Skill 的版本都升到 2026.10.12.2。
- 教程《自由创建、评估、进化任意多个 Agent》仍让读者去装 `agent-tuning` 插件。现改为 `agent-evaluation`（提供 `benchmark-design` 和 `agent-evaluation`）与 `default-rsi-toolkit`（提供 `agent-optimization`）。
