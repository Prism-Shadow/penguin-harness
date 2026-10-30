# 删除 Session 文件前等待子代理清理完成

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `core`, `server`
- **PR:** [#1360](https://github.com/Prism-Shadow/penguin-harness/pull/1360)

[English](2026-10-26-subagent-deletion-cleanup.md)

Session 删除流程将后台子代理的取消收尾纳入了原有的运行任务等待范围，避免在等待期限内结束的子代理用取消记录重新创建已删除的 Trace。Agent、Project 删除以及服务器关闭也等待了子代理清理。

仅停止主 Task 时，后台子代理仍按原有设计继续运行。

取消后的子任务即使在后台注册前从列表或查找结果中隐藏，也会保留清理归属，直到清理完成。

清理也会等待恢复的子任务所拥有的后代任务，即使直接子任务已经完成当前轮次。
