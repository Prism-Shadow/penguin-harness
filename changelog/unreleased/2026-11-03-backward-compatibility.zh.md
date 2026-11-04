# 本批次的向后兼容

- **Date:** 2026-11-03
- **Type:** process
- **Scope:** `server`
- **PR:** [#1445](https://github.com/Prism-Shadow/penguin-harness/pull/1445)

[English](2026-11-03-backward-compatibility.md)

本批次的每项兼容决定都只在这里记录一次；各功能条目引用本文件，不再复述。

## Agent State 之前位置上的 Workbench 及其版本

[Workbench 移入 Agent State](2026-11-03-workbenches-live-in-agent-state.zh.md)，[其版本改为 git 提交](2026-11-03-workbench-versions-are-git-commits.zh.md)。本批次之前，Agent 把 Workbench 放在 `<agentDir>/workbenches/<id>/`，每次成功加载的版本在 `<agentDir>/workbenches-history/<id>/<revision>/` 留一份完整副本（最多 20 份），由 `versions.json` 自新至旧列出。指向旧位置的存量数据有两类：

- 这些目录本身，每个安装都有，内置的 Support 应用及其工单也在其中；
- 每个 Agent 已安装的 `penguin-plugin` Skill 副本。本批次之前安装的副本在用户接受插件更新之前，仍会让 Agent 把 Workbench 写到 `<agentDir>/workbenches/`，因此升级后 Agent 仍会在旧位置新建目录。

若不处理，升级后的安装列不出任何 Workbench，插件页会把 `penguin-support` 显示为未安装，Agent 按旧 Skill 文字做出的 Workbench 也永远不会出现。

选定方案（所有者决定）：**服务端持续收编旧位置。** 服务端每次触及某个 Agent 的 Workbench 时（其 Workbenches 标签页、Workbench 页面、Agent 列表、该 Agent 的插件列表、插件安装、公司模式下的插件更新、Agent 快照导出或导入），都会检查 `<agentDir>/workbenches/`：

- 其中每个在 `agent_state/workbenches/` 下尚未被占用的 `<id>/` 以重命名移入，`state.json`、`.harness/` 与 `.plugin.json` 原样到达。Agent State 里还没有 `workbenches/` 目录时，整个目录一次重命名移入。
- 移动之前，该 id 的 `versions.json` 列出的每个版本自旧至新写成 Agent State 仓库（`<agentDir>/agent_state.git`）中的一个提交，提交时间取原 `savedAt`；随后，目录本身与最新版本不同时作为最新版本提交。历史与恢复显示的版本和时间与升级前一致。
- 随后该 id 的 `<agentDir>/workbenches-history/<id>/` 移到 `<agentDir>/.workbench-migration/backup/workbenches-history/<id>/` 并留在那里：没有代码会删除它。
- `agent_state/workbenches/` 下已被占用的 id 留在原处，每个服务端进程以 `[workbenches]` 前缀记录一次日志。不覆盖、不合并任何内容，该 Agent 其他 Workbench 的列出与加载照常进行。

旧位置没有内容时，这项检查只是一次失败的目录读取。Workflow 时代的 Agent 在同一次访问中先经过已有的 Workflow 转换，再完成这次移动。无法读取或提交的版本以 `[workbenches]` 前缀记入日志、不进入历史，副本保留；目录本身照常移动。中断的运行由下一次访问完成，不会重复提交任何版本。与之共用 `.workbench-migration/` 的 Workflow 转换重新开始时，现在只清理它自己的暂存，因此这份备份不受影响。

### 生效范围

所有在 `agent_state/` 旁有 `workbenches/` 的 Agent 目录，涵盖所有服务端，包括机器；现在如此，以后再出现这样的目录时也如此。只有移入的 id 才读取其 `workbenches-history/` 副本。

### 用户需要做什么

无需操作。因 id 被占用而留在旧位置的目录会在服务端日志中点名；将其改名或移开后，下一次访问会相应地收编或不再理会它。在 Agent 页面接受 `agent-development` 插件更新，可让该 Agent 的 `penguin-plugin` Skill 指向新位置，此后它不再写入旧位置。

### 保留期限

Workbench 维护者保留这段兼容直到下一个大版本（1.0），并在该版本的发布准备中移除：`packages/server/src/workbenches/migrate-state.ts`、它在 `migrateWorkbenches`（`migrate.ts`）中的调用与 `test/workbench-state-migration.test.ts`；Workflow 转换已于 0.3 移除，因此 `migrateWorkbenches` 本身及其所有等待点（`workbenches/service.ts`、`services/agent-service.ts`、`http/routes/plugins.ts`、`http/routes/agent-transfer.ts`）也一并移除。它不随 0.3 的 Workflow 转换一起删除。备份永远不会被代码删除。

## 兼容性

升级时无需操作。移动之后降级，旧版本在原位置找不到 Workbench：在手动把 `agent_state/workbenches/` 移回 `<agentDir>/workbenches/` 之前，它列不出任何 Workbench；旧副本在备份中。
