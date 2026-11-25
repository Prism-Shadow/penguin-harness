# Project 移入数据根的 projects/ 目录，Benchmark 移入评估中心的数据目录

- **Date:** 2026-11-20
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `skills`, `desktop`
- **PR:** [#1669](https://github.com/Prism-Shadow/penguin-harness/pull/1669)
- **Breaking:** yes — Project 的目录为 `<root>/projects/<project_id>/`，Benchmark 的目录为评估中心的数据目录；名为 `projects` 的 Project 使服务端无法启动

[English](2026-11-20-data-root-projects.md)

数据根顶层从此只放服务端自己的文件与目录（`web.db`、`server.lock`、`bin/`、`logs/`、`plugins/`、`machines/`、`app/`、`run/` 等），每个 Project 都是 `projects/` 下的一个目录：`~/.penguin/data/projects/<project_id>/agents/<agent_id>/`。Project 的 Benchmark 从 `<project>/benchmarks/` 移入评估中心的数据目录，即系统 Agent 的 agent 级应用数据 `agents/system_agent/app/data/benchmark/<benchmark_id>/`。已有的数据根由启动时的一次性迁移接入（设计：[PRFC-0034](https://github.com/Prism-Shadow/penguin-harness-design/pull/494)）。

## 细节

- **路径。** core 的 `projectDir(root, id)` 为 `<root>/projects/<id>`，建在新增的 `projectsDir(root)` 之上，其余路径函数都随之变化。`benchmarksDir(root, projectId)` 为系统 Agent 的 `app/data/benchmark/`，建在 agent 级的 `workbenchDataDir` 之上。`listProjectDirs(root)` 列出 `projects/` 下含 `.project_config.toml` 的真实目录，跳过链接；插件 loader、已存配置的迁移、Agent 删除的续删与 Trace 的收编扫描都经它列出 Project。机器同样按 `projects/` 下的 Project 计数：机器的配置同步交出每个使用它的 Project，只要仍有 Project 在用它，保存的密码就保留。
- **Project id。** 已占用的 id 只看 `projects/` 下的目录与 web.db 的行，数据根顶层的名字不再占用 id。新建的 Project 重新可以叫 `app` 或 `run`，但不得叫 `projects`（400 `invalid_project_id`）。名为 `app` 或 `run` 的旧 Project 在原位置留有链接时，Workbench 在 `<root>/app` 与 `<root>/run` 下的共享目录会被拒绝，并说明是哪个 Project。
- **迁移**（core 的 `state/layout-migration/`）：服务端每次启动，以及 SDK 的 `createAgent` 与 CLI 的 `penguin config model` / `penguin config vault` 在没有服务端持有数据根时，都先检查数据根。
  - 顶层每个真实的 Project 目录改名移入 `projects/`，原位置留一个链接：POSIX 为相对符号链接，Windows 为目录联接。
  - Project 自己的文件中位于旧目录下的绝对路径按前缀改写：`.project_config.toml` 的 `[default_chat]`、组织的 `org_config.toml`、`desks.toml`、`org_chart.yaml` 与日历文件，以及各 Agent 的定时任务文件，注释保留。
  - 服务端在一个事务内改写 web.db 中存的路径：Session 的 Workspace 与沙盒屏蔽路径、Agent API 的 Workspace、Trace 缓存的 Workspace、沙盒设置的屏蔽路径与草稿的 Workspace。没有服务端的运行（SDK）把它们记在日志里，由服务端下次启动时改写。
  - 重指 Windows 上的 `workbenches` 目录联接，Workspace 的记忆移到新路径的记忆键下。
  - Trace 不改写：其中记录的路径经链接到达同一批文件。
  - 随后各 Project 的 `benchmarks/` 移入评估中心的数据目录，原位置留一个相对链接；Project 还没有系统 Agent 时先供给它。新目录已有同 id 的 Benchmark 时，该 Benchmark 留在旧目录并记一条警告。
  - `<root>/.layout-migration.json` 记下一次运行未完成的部分，下次启动时补完。
  - 服务端在持有 `server.lock`、平台启动之前执行；平台在其插件 loader 之前再执行一次，因此推送到旧程序上的平台同样会迁移数据根。
  - 迁移停止即启动失败，原因以一行 `Error:` 打印；桌面端的启动失败对话框现在显示这行，机器把它作为启动失败上报。
- **提示词。** 评估中心的提示词（用 AI 创建、导入、评估、优化、工具包的运行以及两处「问 AI」）以 `BENCHMARK_DIR` 写明 Benchmark 的绝对目录，由服务端交给页面：`BenchmarksResponse.dir` 与 `BenchmarkSummary.dir`。Benchmark 页的复制按钮复制这个目录。
- **Skill。** `agent-evaluation`（含其 Harbor 参考）、`benchmark-design`、`agent-optimization` 与各 RSI 工具包使用请求给出的 `BENCHMARK_DIR`，没有给出时用 `<app_data_dir>/agents/system_agent/app/data/benchmark/<id>`，并在每个评测请求中以 `benchmark_dir` 传下去。它们不再把 `PENGUIN_HOME` 设为 App Data Dir 的上级目录；Harbor 辅助脚本与适配器的 `host_penguin_home` 为容纳该 Project 的目录，因此仍读到它的配置。`penguin-config` 与模型、保险柜的「用 AI 添加」提示词把数据根取为 App Data Dir 往上两级的目录。
- **文档。** 数据目录、配置、评估中心与自我进化各页写明新的位置。

## 兼容性

已有的数据根无需任何操作，含名为 `projects` 的 Project 的除外：见[向后兼容](2026-11-20-backward-compatibility.zh.md)。
