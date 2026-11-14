# 数据兼容性

- **Date:** 2026-10-23
- **Type:** feature
- **Scope:** `core`, `server`, `web`
- **PR:** [#1299](https://github.com/Prism-Shadow/penguin-harness/pull/1299)

[English](2026-10-23-backward-compatibility.md)

## 不带 Task 记录的 Trace

在 [Task 记录](2026-10-23-trace-task-pair.zh.md)出现之前写下的 Trace 不带 `task_begin` / `task_end`。读端照旧从用户的 Prompt 推导这些 Trace 的 Task 边界：Task 始于主会话的一条用户 Prompt（含只带来源块的 Prompt 与 goal 续轮重发的输入），止于下一条；它如何结束，由其中的记录读出。

两种读法按位置切换。读端在一个 Session 的记录序列中遇到首个 Task 记录之前推导边界，此后以 Task 记录为准，因此升级后续写的同一文件前后两段各按其规则读取。单独读取一个文件的读端，以该文件内首个 Task 记录为界。

### 范围

回答「Task 从哪里开始」的读端：core 的恢复重放（据此判定文件是否已被压缩收尾）、服务端的消息窗口与 Trace 分析、Web App 的对话流模型与大纲。本版本中它们仍全部按推导读取，对新记录只做忽略或归位，不把它们当作边界。日后改为以 Task 记录为准的读端，在首个 Task 记录之前的部分保留推导。

### 用户需要做什么

无需操作。Trace 不迁移、不回写，旧 Trace 照旧可读。

### 保留期限

这项回退不随某个版本到期：Trace 是磁盘上的真相，且可以从其他安装导入。它一直保留，直到用户决定不再需要读取不带 Task 记录的 Trace，例如设定最低可读的 Trace 版本，或对旧 Trace 做一次性改写之后。届时由「范围」中各读端的维护者在同一次改动里一并移除推导。
