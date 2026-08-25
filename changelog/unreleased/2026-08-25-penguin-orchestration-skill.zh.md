# 新增内置技能：penguin-orchestration

- **Date:** 2026-08-25
- **Type:** feature
- **Scope:** `skills`, `docs`
- **PR:** [#463](https://github.com/Prism-Shadow/penguin-harness/pull/463)

[English](2026-08-25-penguin-orchestration-skill.md)

技能库 AI App Development 组新增 `penguin-orchestration`（v1），排在 `penguin-cli` 之后。它教运行在 PenguinHarness 内的 Agent 经 `penguin` CLI 驱动承载自己的那台本地服务：列出与创建 Agent、发起会话并中途改向、读取会话记录、查询成本与定时任务。技能文档记载的是 `feat/cli-on-server` 分支引入的服务端化 CLI 命令面——Agent 会话内注入的 `PENGUIN_API_URL` / `PENGUIN_API_TOKEN` 及项目、Agent、会话 id 环境变量，会话外经锁文件附着或自动拉起——因此与该改造同行，须在其落地后合并。

## 细节

- 配方：总结昨天的对话（会话 id 内嵌创建时间戳 `session-YYYY-MM-DD-HH-mm-ss-<8hex>`）、查询近 7 天成本（`penguin cost --days 7 --by agent` 及各变体）、创建 Agent 并与之对话（`penguin agent create` 后接 `penguin run --agent-id`）、查看定时任务（`penguin schedule ls`）并用文件工具写 schedule TOML 新建，以及在后台跑一场 CLI 驱动的对话——`exec_command` 带 `run_in_background` 可收到完成回报，`penguin run --background` 则由服务端持续执行、不随发起者结束——中途用 `penguin input <session_id> -m ... --no-wait` 改向。
- 注意事项覆盖每会话单活跃任务规则、无人值守会话的审批模式（`allow-all` / `read-only`；`always-ask` 会挂起等待）、自我发消息的失控循环、成本记入同一 Project，以及一贯的禁止手改 `.project_config.toml` / `.vault.toml`。
- 已登记进 `SKILL_GROUPS`、包 README 表格与双语文档技能表；手绘 `icon.svg`（指挥节点扇出到两个节点）。未设 `preinstall` 标记，新建 `default_agent` 与库内其余技能一样预装它。
