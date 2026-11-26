# 本批次的向后兼容

- **Date:** 2026-11-26
- **Type:** process
- **Scope:** `server`, `core`, `web`
- **PR:** [#1899](https://github.com/Prism-Shadow/penguin-harness/pull/1899)

[English](2026-11-26-backward-compatibility.md)

[改用 `@penguinharness/rsi-workbench`](2026-11-26-rsi-workbench-builtin.zh.md) 的各项兼容处理集中记录在这里。全部保留到下一个大版本（1.0），由准备 1.0 的人删除。

## 0.2.19 与 0.2.20 Project 中的仓内版工作台与 Benchmark

本版本的第一次启动对每个 Project 迁移一次（`packages/server/src/services/rsi-workbench-migration.ts`，由平台启动在数据根的 layout 迁移之后、任何工作台加载之前调用）。每个 Project 在 web.db 新表 `project_data_migrations` 中记一行：第一处改动之前记「开始」，最后一处之后记「完成」；中途停下的，下一次启动按磁盘上的实际状态续做。本版本新建的 Project 在创建时即记为完成，不再迁移。处理的旧形态：

- **Agent 上由 `agent-evaluation` 装入的 `agent_state/workbenches/benchmark/`**：`index.ts`、`package.json`（应用中心开关除外）与 `ui/icon.svg` 与 `agent-evaluation` 发布的版本（2026.11.24.1 或 2026.11.25.1）逐字相同的，经插件安装器换成锁定包的工作台：回执改为 `rsi-workbench`，`.disabled`、`.hidden-from-sidebar` 标记、应用中心开关、`state.json` 与历史均保留，首次加载时在 Agent State 历史中记下新文件。改动过的保持原样，其回执按 `rsi-workbench` 读取（core 的 `state/workbench-owner-renames.ts`），插件卡片因此提示「可更新」，更新时写入新的回执；更新之前它不显示内容，因为其 `builtin` 渲染器已删除。
- **`projects/<p>/agents/system_agent/app/data/benchmark/` 中的 Benchmark**（Project 的 `system_agent` 是用户自己的 Agent 时为 `projects/<p>/benchmarks/`）：以改名移到 `projects/<p>/agents/default_agent/app/data/benchmark/`，写下 `.seeded` 使工作台不再写入种子，`.harbor/` 移到 `…/default_agent/app/cache/benchmark/harbor/`。原位置留一个链接（Windows 上为目录 junction），未更新的 Skill 与工具包副本、对话中的 `BENCHMARK_DIR` 与仍在写 `.jobs/` 的评估都能继续读写同一批文件；有未出结果的 trial 时照常移动，并记一行日志。目标中已有同名 id 的 Benchmark 留在原处并记日志，原目录暂不换成链接，下次启动再移其余的。0.2.19 留在 `projects/<p>/benchmarks` 的链接经系统 Agent 目录处的新链接到达新位置。
- **没有 `default_agent` 的 Project**：先按新建 Project 的方式供给；供给失败时不移动、不记台账，记一行日志说明原因，下次启动再试。
- **默认 Agent 上没有 `benchmark` 工作台**（0.2.19 之前建的 Project，或用户已移除）：经 Agent 插件页面同样的安装（含两个 Skill）为它装一次 `rsi-workbench` 并记入台账；此后再移除不会补装（决定 E1）。
- **机器**：每台机器在它自己第一次以本版本启动时迁移自己的数据根，中心不替机器做。机器升级之前，工作台页面读该机器的旧接口 `/api/projects/:p/benchmarks`（包内兼容，保留到机器升级、最迟 1.0）。

## 旧链接 `/benchmark`

`/benchmark`、`/benchmark/<id>` 及其查询串在自进化工作台的窗口中打开同一位置（`/apps?app=<agent>/benchmark&at=…`，替换历史当前项）：先找默认 Agent 的工作台，其次是其他 Agent 的，都没有时应用中心给出「安装到默认 Agent」（`packages/web/src/features/app-center/legacy-benchmark-redirect.tsx`）。

## 升级前从插件市场装入的副本

0.2.19 已能加载本包。管理员若在升级前从插件市场把 `@penguinharness/rsi-workbench` 装进 `<root>/plugins`，该副本会遮蔽内置包：新 Project 不再预装它，从市场卸载时以 `plugin_shipped` 拒绝。产品负责人 2026-11-26 接受这一风险。手工删除：停止服务，删除 `<root>/plugins/node_modules/@penguinharness/rsi-workbench` 以及 `<root>/plugins/package.json` 中对应的一行，再启动服务。

## 范围

本版本以服务端打开的每个数据根：服务端的、桌面端的、开发用的，以及每台机器以本版本下一次启动时的。不经服务端的 SDK 程序或 CLI 不执行迁移，由下一次服务端启动执行。

## 需要用户做什么

无需操作；仅在有市场副本时按上文删除，并按日志提示手工处理同名 Benchmark。

## 保留期限

保留到 1.0。准备 1.0 的人删除 `services/rsi-workbench-migration.ts` 及其在 `hmr/platform.ts` 与 `ProjectService` 中的调用、`project_data_migrations` 表及其 repo（另写一个删除该表的迁移）、core 的 `state/benchmark-dirs.ts`、`state/workbench-owner-renames.ts` 与为迁移导出的 layout 工具函数、`/benchmark` 重定向、包内对旧机器接口的回退，以及留在旧位置的链接。此后系统 Agent 目录下的旧路径不再可达，改动过的仓内版工作台副本不属于任何插件。
