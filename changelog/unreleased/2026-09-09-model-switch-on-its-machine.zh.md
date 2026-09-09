# 切换模型时对话留在它自己的机器上

- **Date:** 2026-09-09
- **Type:** fix
- **Scope:** `web`
- **PR:** [#650](https://github.com/Prism-Shadow/penguin-harness/pull/650)

[English](2026-09-09-model-switch-on-its-machine.md)

在运行于某台机器上的对话里切换模型，会报 `Workspace does not exist or is inaccessible`。切换模型的做法是：为同一个 Agent 以新模型开一个**新 Session**，并特意沿用原 Session 的 Workspace，好让对话引用的文件仍然可达——但这个创建请求发给了**本机**。它带过去的路径是那台机器上的目录，而服务器会拒绝自己没有的 Workspace，于是切换失败，报的却是一个在对话真正所在之处完好可达的目录。

现在创建请求发往原 Session 所在的那台机器。机器与路径同行，这里与别处一致：新 Session 落在旧的旁边，它的第一个任务（`[model_switch_from]` 源信息块加用户的文字）发往同一台机器，模型为取上下文而读的轨迹文件也就在它被服务的那块磁盘上。
