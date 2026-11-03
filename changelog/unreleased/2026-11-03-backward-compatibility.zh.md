# 本批次的向后兼容

- **Date:** 2026-11-03
- **Type:** process
- **Scope:** `server`
- **PR:** [#1445](https://github.com/Prism-Shadow/penguin-harness/pull/1445)

[English](2026-11-03-backward-compatibility.md)

本批次的每项兼容决定都只在这里记录一次；各功能条目引用本文件，不再复述。

## Agent State 之前布局中的 Workbench 及其版本

[Workbench 移入 Agent State](2026-11-03-workbenches-live-in-agent-state.zh.md)，[其版本改为 git 提交](2026-11-03-workbench-versions-are-git-commits.zh.md)。本批次之前，Agent 把 Workbench 放在 `<agentDir>/workbenches/<id>/`，每次成功加载的版本在 `<agentDir>/workbenches-history/<id>/<revision>/` 留一份完整副本（最多 20 份），由 `versions.json` 自新至旧列出。若不处理，升级后的每个安装都列不出任何 Workbench，内置的 Support 应用及其工单也在其中，插件页还会把 `penguin-support` 显示为未安装。

选定方案（所有者决定）：**一次性迁移，保留历史。** 服务端第一次触及某个 Agent 的 Workbench 时（其 Workbenches 标签页、Workbench 页面、Agent 列表、该 Agent 的插件列表、插件安装、公司模式下的插件更新、Agent 快照导入）：

- `<agentDir>/workbenches/` 以一次重命名移入 `agent_state/workbenches/`，每个 Workbench 的 `state.json`、`.harness/` 与 `.plugin.json` 原样到达。
- `versions.json` 列出的每个版本自旧至新写成 `agent_state/.git` 中的一个提交，提交时间取原 `savedAt`；随后，现存目录与最新版本不同时作为最新版本提交。历史与恢复显示的版本和时间与升级前一致。
- `<agentDir>/workbenches-history/` 移到 `<agentDir>/.workbench-migration/backup/workbenches-history/` 并留在那里：没有代码会删除它。

两个旧目录都没有的 Agent 不受任何改动，也不会生成 journal。Workflow 时代的 Agent 在同一次访问中先经过已有的 Workflow 转换，再完成这次移动。无法读取或提交的版本以 `[workbenches]` 前缀记入日志、不进入历史，其副本留在备份中；Workbench 本身照常移动。

### 生效范围

所有在 `agent_state/` 旁有 `workbenches/` 或 `workbenches-history/` 的 Agent 目录，涵盖所有服务端，包括机器。journal 为 `<agentDir>/.workbench-migration/`（`state-started`、`state-complete`），与 Workflow 转换共用；中断的迁移由下一次访问完成。Workflow 转换重新开始时，现在只清理它自己在该目录中的暂存，因此这份备份不受影响。

### 用户需要做什么

无需操作。若某个 Agent 同时有 `<agentDir>/workbenches/` 与 `agent_state/workbenches/`，迁移在移动任何内容之前停下，Workbenches 标签页会指出冲突；把其中一个移开后重新加载即可。不会覆盖任何内容。

### 保留期限

Workbench 维护者保留这段迁移直到下一个大版本（1.0），并在该版本的发布准备中移除：`packages/server/src/workbenches/migrate-state.ts`、它在 `migrateWorkbenches`（`migrate.ts`）中的调用与 `test/workbench-state-migration.test.ts`；Workflow 转换已于 0.3 移除，因此 `migrateWorkbenches` 本身及其所有等待点（`workbenches/service.ts`、`services/agent-service.ts`、`http/routes/plugins.ts`、`http/routes/agent-transfer.ts`）也一并移除。它不随 0.3 的 Workflow 转换一起删除。备份永远不会被代码删除。

## 兼容性

升级时无需操作。迁移之后降级，旧版本在原位置找不到 Workbench：在手动把 `agent_state/workbenches/` 移回 `<agentDir>/workbenches/` 之前，它列不出任何 Workbench；旧副本在备份中。
