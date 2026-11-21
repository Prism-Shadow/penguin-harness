# 各读端认识 `session_update` 记录

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `amsp`, `core`, `server`, `web`, `cli`
- **PR:** [#1652](https://github.com/Prism-Shadow/penguin-harness/pull/1652)
- **Breaking:** yes — `@prismshadow/amsp/records` 不再导出 `lastNonTaskRecord`

[English](2026-11-19-session-update-record.md)

Trace 的各个读端现在都认识 `session_update`：一种新的 `event_msg`，记下 Session 级设置变更后的取值，目前只有 Session 下一个上下文所用的模型（`provider`、`model_id`）。本次改动还没有任何写入方；会话内切换模型写入它的改动另行提交（[PRFC-0035](https://github.com/Prism-Shadow/penguin-harness-design/pull/498)）。

## 记录

- `@prismshadow/amsp/records` 新增 `SessionUpdatePayload` 类型、`sessionUpdate` 构造函数与三个函数：`closingCompaction`（关闭文件上下文的那个 `completed` 的 `compaction_end`，其后没有 `request_begin` 时）、`updatedModel`（一条记录所记的模型）、`pendingModel`（最后一条 `session_update` 所记的模型，其后没有 `request_begin` 时）。只计主会话的记录。

## 恢复

- 文件的上下文按规范重放规则第 1 条判定为已关闭：最后一个 `compaction_end` 为 `completed`，其后没有 `request_begin`。此前要求最后一条非 Task 记录就是该 `compaction_end`，于是排在其后的 stop 钩子记录（goal 钩子、continual-learning），或中止于 MCP 连接的首次运行的输入，会让重启把已关闭的上下文整个重放、丢失摘要。这类输入现在排在摘要之后带过去，不带工具输出。该规则同样作用于磁盘上已有的 Trace。
- 文件中最后一条带模型的 `session_update` 之后没有 `request_begin` 时，文件的上下文同样已关闭，恢复出的 Session 在该模型上开启下一个上下文（多条时取最后一条）。有压缩时开头由压缩决定；没有压缩时，已有完成的轮则为由本文件重新生成的 `[model_switch_from]` 交接说明，否则为该上下文开启时所带的文本；记录之前未得到回应的输入只带文本。目标已不在配置中的，与任何缺失的模型一样拒绝恢复。

## 读端

- 服务端：上下文构成按同一规则报 `contextClosed`；Session 行与模型监听方随流上主会话的 `session_update` 跟随；起点落在它之后的历史窗口以它所记的模型为 `contextModel`；轮的结束时间与分叉的截取都不计入它，切换前的最后一条回复因此可以分叉；切换的 Trace 交接说明在新文件开出之前为历史接口暂存。窗口扫描把它当作 `session_meta` 处理（`CACHE_VERSION` 升为 5，旧版本缓存的分片汇总重建一次）。
- Web：「A → B」标记由该记录绘出，其后确认的 `session_meta` 不再画第二个，记录也不计入 Task 用时；没有该记录的 Trace 照旧由前后两条 `session_meta` 画出标记。Trace 查看器与 API 试用日志以带标签的一行显示它。
- CLI：渲染器不打印它，也不因它开始计时。
- Landing 与文档：AMSP 页面列出十五种事件载荷。

## 兼容性

- `@prismshadow/amsp/records` 移除了 `lastNonTaskRecord`。原先用它判断文件是否被压缩收尾的调用方改用 `closingCompaction(records) !== undefined`；判断有无待生效的切换用 `pendingModel(records) !== undefined`。
