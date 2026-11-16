# 本批次的向后兼容

- **Date:** 2026-11-04
- **Type:** process
- **Scope:** `server`, `web`
- **PR:** [#1487](https://github.com/Prism-Shadow/penguin-harness/pull/1487)

[English](2026-11-04-backward-compatibility.md)

本批次的每一项兼容决定都只在这里记录一次；各功能条目引用本文件，不再重复叙述。

## 改为 zip 之前导出的记忆文件

[记忆可以附带 Agent 反复使用的脚本](2026-11-04-memory-scripts.zh.md)把记忆导出改为作用域文件夹的 zip。在此之前（自 0.2.4 起），导出的是一份 JSON 文档（`format: "penguin-memory-scope"`，`version: 1`），含主题文件与 `MEMORY.md`。用户会把这类文件留作备份，也会在服务端之间搬运它们。

若不处理，新服务端会拒绝每一份这样的文件。

采用的方案（所有者的决定，penguin-harness-design [#423](https://github.com/Prism-Shadow/penguin-harness-design/pull/423)，导出改为 zip 后沿用）：**两种都读。** 导入路由以 `dataBase64` 接收 zip，仍以 `payload` 接收 JSON 文档，检查一如既往；记忆标签页的文件选择两种都能发送。这类文档只带入主题文件。磁盘上的文件一律不改写，导出始终写 zip。反方向不做桥接：此次改动之前的服务端会拒绝 zip。

### 生效范围

所有服务端（包括 Machine）上的记忆导入路由（`POST …/memory/scopes/:key/import`）与记忆标签页的**导入**。

### 需要做什么

什么都不用做。此前导出的文件照常导入。要把记忆搬到较旧的服务端，先升级那台服务端。

### 保留期限

JSON 读取逻辑由记忆功能的维护者保留到下一个大版本（1.0），并在该版本的发布准备中移除：`packages/server/src/services/memory-transfer-document.ts`、导入路由的 `payload` 分支（`packages/server/src/http/routes/memory.ts`）、`packages/server/src/api/types.ts` 中的 `MemoryScopeExport` 与 `MemoryTransferFile`、`memoryUploadOf` 的 JSON 分支（`packages/web/src/features/agents/memory-transfer.ts`），以及读取 version 1 文档的测试。此后 JSON 文件与其他非 zip 上传一样被拒绝。
