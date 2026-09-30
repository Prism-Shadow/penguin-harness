# 闲置会话真正释放内存，保存模型或 hooks 不再丢下在跑的开发服务器

- **Date:** 2026-09-30
- **Type:** fix
- **Scope:** `server`
- **PR:** [Myriad-Dreamin/penguin-harness#116](https://github.com/Myriad-Dreamin/penguin-harness/pull/116)

[English](2026-09-30-idle-sessions-release-memory.md)

服务器在两种情况下把一个 Session 的运行时移出内存：闲置满 30 分钟；或它建于其 Agent 的配置、hooks、插件或 Project 的模型最近一次改动之前、又被访问到。两条路现在都会 dispose 被移出的运行时。此前运行时的后台 registry 一直留在 core 的进程级列表里，整段会话历史经由它们仍然可达，被驱逐的 Session 从未真正释放。

两条路都不移出仍有后台工作的 Session：在跑的后台命令、仍在工作的后台子代理、或尚未送达的完成通知。闲置清扫原本就跳过这类 Session，过期配置那条路没有；而那条路在每次保存 Agent 的配置、hooks、插件或 Project 的模型之后都会走到。过去一次保存会让在跑的开发服务器脱离管理：进程还在跑，停止控件却不再列出它。现在这类 Session 保留旧值的运行时，直到后台工作结束，之后的下一次访问再重建。
