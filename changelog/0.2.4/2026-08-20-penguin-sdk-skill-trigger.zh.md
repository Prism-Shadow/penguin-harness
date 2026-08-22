# penguin-sdk skill：明确触发条件与 CLI 优先的工具接入

- **Date:** 2026-08-20
- **Type:** process
- **Scope:** `skills`, `docs`
- **PR:** [#365](https://github.com/Prism-Shadow/penguin-harness/pull/365)

[English](2026-08-20-penguin-sdk-skill-trigger.md)

明确了 `penguin-sdk` skill 的触发时机，以及接入用户已有工具的推荐方式。

## 细节

- skill 的 `description` 现以触发条件开头：只要用户想构建智能体应用（自己交付的、内嵌
  agent 的程序，例如 AI 应用、Agent 形态应用或 RAG 应用），就使用本 skill；并写明边界：
  这是在 SDK 上写应用代码，而不是在 PenguinHarness 内配置 Agent State。
- 新增「Wiring in the user's tools」一节：把用户已有工具包装成 CLI 命令，由内嵌
  agent 通过内置 `exec_command` 工具调用；仅当 CLI 包装无法表达集成时才使用 MCP
  Server（`system_config.yaml` 中的 `tools.mcpServers`）。
- `short_description` / `short_description_zh` 与 docs 双语技能表同步改为「智能体应用」
  并写明同一条边界，skill 版本号升至 21。
