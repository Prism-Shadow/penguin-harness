# 本批次的向后兼容

- **Date:** 2026-11-09
- **Type:** process
- **Scope:** `server`, `cli`, `web`
- **PR:** [#594](https://github.com/Prism-Shadow/penguin-harness/pull/594)

[English](2026-11-09-backward-compatibility.md)

本批次的每项兼容决定都只在这里记录一次；各功能条目引用本文件，不再复述。

## zip 之前导出的 Agent 快照包

[Agent 以其目录的 zip 往来](2026-11-09-agent-zip-export-import.zh.md)。本批次之前，导出的是以 `agent_state/` 为根的 `.tar.gz`。`POST …/agents/import`、`penguin agent import` 与 Web App 的**导入 Agent** 仍然接受它：服务端按 gzip 魔数把它与 zip 区分开，只有解包一步不同。这种包不带 Agent id，因此须在查询参数中给出 `agentId`（`--agent-id`）。它不含 Trace。

### 生效范围

此前各版本导出的每个 `.tar.gz` 快照包，在任何服务器上导入。

### 用户需要做什么

无需任何操作。

### 保留期限

服务端维护者保留 `packages/server/src/services/snapshot-service.ts` 中解包的 tar.gz 分支，直到下一个大版本（1.0），并在该版本的发布准备中移除，同时去掉 `penguin agent import` 帮助与文档中关于 `.tar.gz` 的说明，以及 Web App 导入文件选择框的 `.tar.gz` 条目（`packages/web/src/features/agents/archive-file.ts` 的 `ARCHIVE_ACCEPT`）及其提示。覆盖前的备份仍是 `.tar.gz`，它们不是导入包。
