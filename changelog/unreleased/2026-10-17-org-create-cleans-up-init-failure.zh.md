# 组织创建在初始化派发失败时一并清理

- **Date:** 2026-10-17
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1179](https://github.com/Prism-Shadow/penguin-harness/pull/1179)
- **Issue:** [#734](https://github.com/Prism-Shadow/penguin-harness/issues/734)

[English](2026-10-17-org-create-cleans-up-init-failure.md)

CEO 初始化派发失败时，组织创建不再留下半成品：派发现在与其余写入同处一个带清理的锁内窗口，失败时目录与 CEO Agent 一并移除，组织 id 立刻可以复用。派发被跳过（desk 打不开、或任务无法启动）时组织仍然建成，但创建响应现在带 `ceoInitSkipped` 供调用方辨别；原因照旧记录在错误日志的 `org_desk_unavailable` / `org_dispatch_failed` 之下。

## 细节

- agents 网关新增 `remove` 操作，由 `AgentService.deleteAgent` 支撑，清理路径调用它；清理自身的失败以 `org_cleanup_failed` 记录，不掩盖引发清理的原始错误。
