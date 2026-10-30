# 支持 Roadmap 的 Benchmark 包格式

- **Date:** 2026-10-30
- **Type:** feature
- **Scope:** `core`, `web`, `landing`, `docs`, `tooling`
- **PR:** [#1401](https://github.com/Prism-Shadow/penguin-harness/pull/1401)

[English](2026-10-30-roadmap-benchmark-packages.md)

新增了对 `x.y.z` Benchmark 包版本的支持，同时兼容原有日期版本。导入和保存时保留了包的作者、更新时间与中文标题。构建时将每个 Case 的 `task_config.toml` 与 Statement、Rubric 一起打包，未带入任务数据和环境。

更新了导入示例、README 和评估中心文档中的 GDPEVO Essential 命名与连续训练说明。删除了官网重复维护的包 ID 清单，保留了按包的上游来源核对展示内容的检查。
