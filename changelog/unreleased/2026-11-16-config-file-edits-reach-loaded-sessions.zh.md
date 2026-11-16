# 服务端：写入 Project 配置文件的模型修改对已载入的 Session 生效

- **Date:** 2026-11-16
- **Type:** fix
- **Scope:** `server`
- **Issue:** [#1558](https://github.com/Prism-Shadow/penguin-harness/issues/1558)

[English](2026-11-16-config-file-edits-reach-loaded-sessions.md)

不经服务端写入 `.project_config.toml` 的模型修改——`penguin config model …`（含 Agent 在对话中自行执行）、手工编辑、同一数据根上的另一个进程——现在对服务端已载入的 Session 生效；此前它们沿用旧的模型与连接，直到服务端重启或运行时空闲 30 分钟。服务端在新建或复用 Session 运行时之前，经 mtime 门控读取该文件的模型相关键（`models`、`[providers]`、`default_model`、`vision_model`），与上次所见不同即失效该 Project 的缓存运行时，与 Models 页保存的效果相同：下一个 Task 按新配置恢复，进行中的 Task 不受影响。其余键（显示名、命令策略、新对话默认值、`[plugins]`）的修改不触发重建。
