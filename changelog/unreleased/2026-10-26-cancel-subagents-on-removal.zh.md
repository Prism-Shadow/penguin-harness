# 开始移除 Session 时取消子代理请求

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `core`, `server`
- **PR:** [#1361](https://github.com/Prism-Shadow/penguin-harness/pull/1361)

[English](2026-10-26-cancel-subagents-on-removal.md)

Session、Agent、Project 删除以及服务器关闭，在等待主 Task 中断收尾前就取消了运行中的子代理。主 Task 收尾缓慢时，这些子代理不再继续完成工具调用并发起下一次模型请求。

环境资源仍在主 Task 结束后按原有顺序释放。普通的 Task 停止操作仍允许后台子代理继续运行。

子代理创建期间或首次发送元数据时收到取消，现在会阻止子代理启动。凭据更新后，旧运行时的后台任务仍归属于原会话，后续删除 Session、Agent、Project 或关闭服务器时，会继续取消这些任务并等待清理。重新加载失败时，也仍能清理原运行时。

主机或模型恢复已释放的子任务时，若取消或删除发生在恢复期间，会先释放返回的句柄再响应，不会启动新的运行。
