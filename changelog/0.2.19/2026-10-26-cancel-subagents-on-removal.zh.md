# 开始移除 Session 时取消子代理请求

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `core`, `server`
- **PR:** [#1361](https://github.com/Prism-Shadow/penguin-harness/pull/1361)

[English](2026-10-26-cancel-subagents-on-removal.md)

创建或恢复子 Agent 期间取消调用，会先释放返回的句柄再结束工具调用。在首次启动期间移除父会话，也会阻止子 Agent 发出第一条模型请求。

更新凭据并重载 Session 后，旧运行时已启动的后台任务仍归原 Session 管理。删除 Session、Agent 或 Project、关闭服务器时，都会取消这些任务并等待清理。停止普通 Task 时，已转入后台的子 Agent 仍继续运行。
