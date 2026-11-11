# 本批次的向后兼容

- **Date:** 2026-11-04
- **Type:** process
- **Scope:** `server`, `web`
- **PR:** [#1487](https://github.com/Prism-Shadow/penguin-harness/pull/1487)

[English](2026-11-04-backward-compatibility.md)

本批次的每一项兼容决定都只在这里记录一次；各功能条目引用本文件，不再重复叙述。

## 记忆能附带脚本之前导出的记忆文件

[记忆可以附带 Agent 反复使用的脚本](2026-11-04-memory-scripts.zh.md)把记忆导出文档升为 `version: 2`，其中一个主题可以携带其文件夹里的文件。此前导出的文件带 `version: 1`，只含主题文件。用户会把这类文件留作备份，也会在服务端之间搬运它们。

若不处理，新服务端会把每一份这样的文件当作未知版本拒绝。

采用的方案（所有者的决定，penguin-harness-design [#423](https://github.com/Prism-Shadow/penguin-harness-design/pull/423)）：**两个版本都读。** 导入路由与记忆标签页的文件选择都接受 `version: 1` 文档；它与 version 2 一样以 `name` 指明每个主题文件，只是不带文件。磁盘上的文件一律不改写，导出始终写 version 2。反方向不做桥接：此次改动之前的服务端会拒绝 version 2 文件。

### 生效范围

所有服务端（包括 Machine）上的记忆导入路由（`POST …/memory/scopes/:key/import`）与记忆标签页的**导入**。

### 需要做什么

什么都不用做。此前导出的文件照常导入。要把记忆搬到较旧的服务端，先升级那台服务端。

### 保留期限

version 1 读取逻辑由记忆功能的维护者保留到下一个大版本（1.0），并在该版本的发布准备中移除：`SCOPE_FORMAT_VERSION_TOPICS_ONLY` 及其在 `parseTransferDocument` 中的分支（`packages/server/src/services/memory-transfer-document.ts`）、`packages/server/src/api/types.ts` 中的 `MemoryScopeExportV1`、`parseMemoryScopeDocument` 的 version 1 分支（`packages/web/src/features/agents/memory-transfer.ts`），以及读取 version 1 文档的测试。此后 version 1 文件会以未知版本被拒绝。
