# 在导航后保留 Benchmark 选择

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `web`
- **Issue:** [#181](https://github.com/Prism-Shadow/penguin-harness/issues/181)

[English](2026-08-27-benchmark-selection-persistence.md)

Benchmark 页面现在会将选中的 Agent 和 Benchmark 保存在 URL 中，因此从 Session trace 返回时可以恢复当前项目之前的视图。

## 细节

- 选择 Benchmark 时更新 `agentId` 和 `benchmarkId` 查询参数。
- 页面重新挂载后恢复匹配的选择。
