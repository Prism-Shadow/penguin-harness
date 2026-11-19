# 本批次的向后兼容

- **Date:** 2026-11-19
- **Type:** process
- **Scope:** `core`, `server`, `web`
- **PR:** [#1654](https://github.com/Prism-Shadow/penguin-harness/pull/1654)

[English](2026-11-19-backward-compatibility.md)

本批次的每项兼容决定只在这里记录一次，功能条目引用本文件，不再重复叙述。

## 已有名为 `system_agent` 的 Agent

[每个 Project 都有系统 Agent](2026-11-19-system-agent.zh.md)，id 为 `system_agent`。Agent id 由用户自选，所以 Project 里可能已有这个 id 的 Agent。它的 `system_config.yaml` 没有 `system: true`，因此仍是普通 Agent：照旧对话、删除与导出，供给从不覆盖它。它占着这个 id 时，该 Project 没有系统 Agent；Agents 页给 Project 的 owner 一行提示，点出这个 Agent。

### 范围

升级前已有 `agents/system_agent/` 的任何服务端、桌面端或机器上的 Project。

### 需要做什么

要让该 Project 有系统 Agent：导出这个 Agent，以另一个 id 导入，再删除原来的。系统 Agent 在该 Project 的 Agent 列表下次被读取时补齐。

### 保留期限

core `state/system-agent.ts` 的维护者把其中写明的「必须带键」作为此情形的处理，连同 Agents 页的提示（`packages/web/src/lib/builtin-agents.ts` 的 `holdsSystemAgentId` 与 `systemIdHeld` 文案）保留到下一个主版本（1.0），在该版本的发布准备中删除这条提示。
