# 工作目录消失时命令会直说，而不再归咎于 Shell

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `core`
- **PR:** [#484](https://github.com/Prism-Shadow/penguin-harness/pull/484)

[English](2026-08-27-missing-workspace-error.md)

当会话的 Workspace 目录已经消失时，`exec_command` 回答的是 `[spawn error: spawn bash ENOENT]`。现在会在 spawn 之前检查工作目录，失败信息直接点名该目录。

## 细节

- Node 把无法使用的 `cwd` 报告为 `spawn <command> ENOENT`——错误里带的是命令名而非目录名，因此被删除或移动的 Workspace 与缺失的 Shell 无从区分。
- `CommandSessionManager.spawn` 现在会在启动子进程前拒绝不存在或不是目录的工作目录。信息会点名该路径以及应当如何处理，`exec_command` 的 `workdir` 参数解析不到时同样适用。
- 该目录不会被自动创建，与 `Agent.createSession` 和服务端的 Workspace 校验保持一致：Workspace 从不凭空生成，一个笔误因此不会悄悄地在错误的位置开始工作。
