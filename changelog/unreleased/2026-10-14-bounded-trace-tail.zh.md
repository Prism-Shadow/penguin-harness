# 打开长对话只读尾部，Trace 分片有大小上限

- **Date:** 2026-10-14
- **Type:** fix
- **Scope:** `core`, `server`, `web`

[English](2026-10-14-bounded-trace-tail.md)

两项随对话变长而增长的开销：打开一段对话会把它所在的整个 Trace 分片解析一遍；而分片本身没有上限——一个跑了几周的会话可以把单个 `.jsonl` 文件写到没有边界，之后每次读取都要为整个文件买单。

## 读取

- **历史对话从分片尾部读起**（`server/internal/trace-tail.ts`）：以有界的窗口从文件末尾向前读，直到覆盖所需的历史，而不是从字节 0 解析每一条记录。窗口读取绝不能丢的东西正是同系列那个修复所钉住的：调用方续读所用的翻页游标与 `tracePosition`，以及"被切出来的窗口是转录的**后缀**、而不是重排或部分序列化后的副本"。
- **`before` 翻页走行索引**，不再每翻一页都从分片头部重扫。
- **Web App 的 fork 定位**改用同一套窗口读取，不再为找到分支点而拉取整段对话。

## 分片

`core` 的 Trace 写入器给分片设了字节上限：将要超过时，写入器在记录边界轮转到下一个分片（`<sessionId>_<NNN>.jsonl`），于是一个会话的 Trace 始终是一组有界的文件，而不是一个无界的文件。轮转对读取方不可见——各分片按序读取，而上面的尾部读取只需要最后一个。

## 细节

- 新增：`packages/server/src/internal/trace-tail.ts`；`trace-service.ts` 经由它读取。
- 测试：`server/test/trace-tail.test.ts` 与 `trace-tail-page.test.ts`（窗口边界、游标与 `tracePosition` 的保留、分页结果与全量读取的一致性），`core/test/trace.test.ts`（写入器的轮转）。
