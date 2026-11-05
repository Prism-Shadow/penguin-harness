# 本批次的向后兼容

- **Date:** 2026-11-04
- **Type:** process
- **Scope:** `server`, `web`, `cli`
- **PR:** [#594](https://github.com/Prism-Shadow/penguin-harness/pull/594)

[English](2026-11-04-backward-compatibility.md)

本批次的每项兼容决定都只在此记录一次；各功能条目引用本文件，不再重复叙述。

## zip 导出之前写出的 `.tar.gz` Agent State 包

[Agent 现在导出为 zip](2026-11-04-agent-zip-export-import.zh.md)。在本批次之前，设置页把 Agent State 导出为 `<agentId>-v<N>.tar.gz`（不含密钥保险柜的 `agent_state/`），用户磁盘上存有这样的文件。

选定方案（所有者决定）：**旧包在 1.0 之前继续可以导入。**

- 兼容的内容：旧的 `.tar.gz` 包按 gzip 文件头识别，经 zip 导入流程导入，适用于 Web App 的导入对话框、设置页的从文件替换以及 `penguin agent import`。id 未被占用时，用包新建 Agent；带 `overwrite=1` 时替换现有 Agent 的 State。因为包中没有 Agent 名称，必须提供 `agentId`。包按快照导入的规则解压（不含密钥保险柜、不含 `.git` 路径、链接只能指向 `agent_state/` 之内），其内容不受 zip 的 Skill 和钩子检查约束。文件选择器继续接受 `.tar.gz`、`.tgz` 和 `.gz`。
- 生效范围：所有安装。
- 用户无需操作。
- 移除：随 1.0 版本移除。准备 1.0 的人删除 `packages/server/src/agent-archive/tar-compat.ts`、它在 `agent-archive/import.ts` 中的两处 `tar.gz` 分支、Web App 与 CLI 文件选择器中的 `.tar.gz` 项，以及 `packages/server/test/agent-archive-compat.test.ts`。

内部的版本快照（`snapshots/v<N>.tar.gz`，由优化器和 RSI Skill 读写）和导入备份（`snapshots/import-backup-*.tar.gz`）与此格式无关，不做改动。

## 移除的路由

按所有者决定不做兼容：`GET /api/projects/:p/agents/:a/export`、`POST /api/projects/:p/agents/:a/import` 和 `POST /api/projects/:p/agents` 的 `dataBase64` 初始化在本批次中直接移除，不保留别名。调用它们的 API 客户端会得到 404（创建路由会忽略该字段）。`penguin` CLI 从未调用它们，Web App 在同一版本中一并更新。
