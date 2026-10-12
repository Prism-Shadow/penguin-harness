# 阻塞工单时按组织架构校验 `by` 主体

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `server`
- **PR:** [#851](https://github.com/Prism-Shadow/penguin-harness/pull/851)

[English](2026-10-10-block-by-principal-check.md)

阻塞工单——`block` 接口、`penguin org ticket block --by` 与员工工具——现在对 `agent:<id>` / `user:<id>` 形式的 `by` 施加组织接受的其他主体早已遵循的规则：agent 必须是架构图上的员工，user 必须是 Project 成员，否则以 `400 invalid_principal` 拒绝写入。此前任何形状合法的 id 都会写进 `blocked_by`，并在摘要与看板上显示为「(by …)」。工单 id 形式仍只做存在性检查；省略 `by` 仍清除 `blockedBy`；已存储的值不会被改写。
