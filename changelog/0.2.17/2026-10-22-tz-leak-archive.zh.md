# Benchmark 导出不再受时区影响，服务端测试文件之间不再泄漏时区

- **Date:** 2026-10-22
- **Type:** fix
- **Scope:** `server`, `ci`
- **PR:** [#1298](https://github.com/Prism-Shadow/penguin-harness/pull/1298)

[English](2026-10-22-tz-leak-archive.md)

Benchmark 的导出不再依赖服务端进程启动时所在的时区；服务端测试中的夏令时场景也不再把 Windows 上的测试 worker 留在另一个时区。

## 细节

- 每个导出条目携带的固定时间（1980-01-01 00:00，即 zip 记录的本地时间）改为在写 zip 时构造，不再于模块加载时构造一次。加载时构造的时间，在进程时区移到其构造时所在时区以西之后会读作 1979-12-31，导出随之以 500 和 `date not in range 1980-2099` 失败。导出的字节不变。导出「字节相同」的场景还会在 UTC-11 与 UTC+14 下各导出一次。
- 服务端测试改为通过 `test/helpers/time-zone.ts` 切换进程时区：恢复时先把 `TZ` 设为原来的时区，再把 `TZ` 还原为原值。在 Windows 上，Node 只在 `TZ` 被设置时才切换进程时区，因此删除 `TZ` 会让 `usage.test.ts` 设下的 `America/New_York` 一直留给同一 worker 中之后的每个文件。`benchmarks-archive.test.ts` 只要在同一 worker 中排在它之后，就有三个导出场景失败，Windows 的服务端分片随之整体重跑。
