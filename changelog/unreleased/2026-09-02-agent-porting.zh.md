# Agent 以可移植包在安装之间、工具之间搬运

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `server`, `cli`, `web`, `skills`, `docs`
- **PR:** [#594](https://github.com/Prism-Shadow/penguin-harness/pull/594)

[English](2026-09-02-agent-porting.md)

Agent 现在可以导出为可移植包，也可以从这样的包——或从为另一种编码智能体写的设置——导入。包携带 Agent 的定义、已安装的技能与钩子包，以及一份写给编码智能体的接入文档；绝不携带 Vault 值、记忆、Trace、定时任务与快照。这是 Agent State 快照之外的第二条路径：快照备份并还原某个既有 Agent 的状态，可移植包搬运 Agent 的身份与能力。

## 细节

- `GET /api/projects/:p/agents/:a/bundle`（任意成员）下载 `<agentId>-export.zip`：`penguin-agent.json`（`format: "penguin-agent/1"`——id、名称、描述、作为 `prompt` 的 AGENTS.md 指令、系统提示词模板、技能与钩子引用、启用的内置工具名、`env` / `headers` 中形似凭据的值已置空的 MCP Server 条目、模型偏好、Vault 键名、导出时间与来源）、已安装的 `skills/<name>/` 与 `hooks/<name>/` 目录、`README.md`（该 Agent 是什么、运行它的四步服务端 API 调用——Project 与 Agent id 已填入——CLI 命令、技能与工具、限制）、`api/ENDPOINTS.md`，以及 `examples/curl.sh` / `client.py` / `client.ts`——创建 Session、发送任务并打印最终回答的可运行客户端。
- `POST /api/projects/:p/agents/import`（任意成员）从这样的包或单独的 `penguin-agent.json` 创建 Agent（`{dataBase64, agentId?}`；服务端按内容区分二者）：应用名称、描述、指令、模板、模型偏好与 MCP 条目，安装包内的技能与钩子包，并从默认工具集中选出点名的内置工具。id 已占用为 409 `agent_exists`，包格式不对为 400，中途失败会移除半成品 Agent。响应列出已安装的内容、定义点名但未能应用的项，以及需要设置的 Vault 键名。
- `penguin agent export <agent-id> [--out <file|dir>]` 写出包并打印路径；`penguin agent import <file.zip|penguin-agent.json> [--agent-id <id>]` 创建 Agent 并报告结果。二者都接受 `--project-id`、`--json` 与 `--server`。
- Agents 页页头新增**导入智能体**——弹窗含**从文件导入**（包或单独的定义文件，id 按文件名预填；id 已占用时就地提示以便重试）与**让 AI 导入**（「让 AI 创建」面板，示例覆盖本机 Claude Code、Codex、Pi 的设置与导出包，固定尾注点名 `agent-porting` 技能与目标 Project）。每张卡片新增**导出智能体**，设置页概览在快照的一对操作旁显示同一导出，命名区分。
- `agent-development` 插件（版本 `2026-09-02.2`）新增 `agent-porting` 技能：到哪里读 Claude Code（`~/.claude`、仓库的 `.claude/`、`CLAUDE.md`、`.mcp.json`）、Codex（`~/.codex/config.toml`、`AGENTS.md`、`~/.agents/skills`）或 Pi（`~/.pi/agent/`）的设置，各部分如何映射到定义（指令到 `prompt`、命令与提示模板到技能、MCP Server、简单的脚本钩子到钩子包、权限清单如实报告为不支持），如何写出定义并执行导入，以及如何把导出包交给编码智能体或把 Agent 作为 HTTP API 发布。
- CLI、Web App、服务端 API 与技能文档以双语描述了命令、弹窗、路由与技能。
