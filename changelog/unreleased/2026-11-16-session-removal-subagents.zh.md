# 移除 Session 时立即停止其子代理，并等待其最后的写入

- **Date:** 2026-11-16
- **Type:** fix
- **Scope:** `core`, `server`
- **PR:** [#1360](https://github.com/Prism-Shadow/penguin-harness/pull/1360)

[English](2026-11-16-session-removal-subagents.md)

删除 Session、Agent 或 Project 以及关闭服务器时，运行时的子代理在移除开始时即被停止，而不再等到主 Task 的中断收尾结束之后。删除原有的等待（至多五秒）随之覆盖了子代理的取消写入，仍在写中止记录的子代理不再重新创建已删除的 Trace。已被父级停止取消的子代理同样会被等待。仅停止主 Task 时，后台子代理仍继续运行。

## 细节

- `Session.dispose()` 与 Environment 的 `dispose()` 返回一个 promise，在每个子代理都写完后才完成；子代理句柄的 `dispose()` 也可以返回 promise。
- 发给子代理的消息在加载其父 Session 时与 Task 使用同一把 Session 锁，两者同时到达时不再构建出两个运行时，其中一个逃过 Session 的删除。
- 运行时加载期间被删除的 Session 不再被重新加载回来。
- Project 删除之后、超过删除等待时限才报告的用量不再被记录。
