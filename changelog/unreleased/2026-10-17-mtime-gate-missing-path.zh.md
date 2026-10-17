# 瞬时文件系统错误不再被当成路径已删除

- **Date:** 2026-10-17
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1183](https://github.com/Prism-Shadow/penguin-harness/pull/1183)
- **Issue:** [#301](https://github.com/Prism-Shadow/penguin-harness/issues/301)

[English](2026-10-17-mtime-gate-missing-path.md)

Trace 索引、定时任务扫描和 Agent 目录列举不再把每一种文件系统错误都当成「路径已不存在」。瞬时的 `EACCES` / `EMFILE` / `EIO` 过去会删掉索引行（或把定时任务列表清空），再把这一轮记成干净，损失会一直持续到进程重启。这些错误现在会让本轮失败，上一份完好的缓存保留。

## 细节

- `statMtime()` 只对 ENOENT 返回 null，与它自己的注释一致，其余错误原样抛出。
- Trace 索引的目录列举与分片 stat、定时任务文件读取、调度器的 Agent 列举同样：不存在就是不存在；其他 errno 在清扫行之前中止。
