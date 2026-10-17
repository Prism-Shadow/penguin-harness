# 目录的未来时间戳不再卡住派生缓存门闩

- **Date:** 2026-10-17
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1181](https://github.com/Prism-Shadow/penguin-harness/pull/1181)
- **Issue:** [#301](https://github.com/Prism-Shadow/penguin-harness/issues/301)

[English](2026-10-17-mtime-gate-future.md)

Trace 索引、定时任务扫描和项目配置读取共用的 mtime 门闩，现在把位于未来的时间戳当作已稳定。从备份恢复、`rsync -t` 自时钟更快的主机、或 NTP 回拨，不再会在挂钟追上之前让每一次请求都走完整目录扫描。

## 细节

- `cacheable()` 把未来的 mtime 原样记下。只有不足两秒的 mtime——路径可能仍在写入——才继续使用永不匹配的哨兵值。
- 同一时钟刻度的新鲜窗口不变：刚写入的路径仍会重读，直到它安静下来。
