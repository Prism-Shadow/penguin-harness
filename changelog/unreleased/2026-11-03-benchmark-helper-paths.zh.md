# Agent Evaluation 的 Benchmark 工具路径

- **Date:** 2026-11-03
- **Type:** fix
- **Scope:** `skills`
- **PR:** [#1436](https://github.com/Prism-Shadow/penguin-harness/pull/1436)

[English](2026-11-03-benchmark-helper-paths.md)

更新了 Harbor 参考文档：工具路径以固定 commit 的 Benchmark README 为准，网络配置路径沿用 Case 的启动命令；安装包和模型地址工具的示例改为 `agents/` 下的路径。移除了已删除的镜像清单工具调用，改为直接拉取各任务 `task.toml` 中列出的镜像。
