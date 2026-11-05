# 导入示例与基于文件的 Benchmark 导入

- **Date:** 2026-10-14
- **Type:** refactor
- **Scope:** `web`, `cli`, `server`, `docs`, `skills`, `ui-gallery`
- **PR:** [#1117](https://github.com/Prism-Shadow/penguin-harness/pull/1117)
- **Breaking:** yes — 移除了 `penguin benchmark import` 命令及其服务端上传辅助模块导出。

[English](2026-10-14-import-examples.md)

Agent 导入 Benchmark 时改为直接将清单和题目文件夹复制到 Project 的 `benchmarks/<id>/`，记录来源并创建空记分板。

## 导入窗口

- 增加四个评估集示例（Sec A、B、C、E）和四个插件示例（浏览器自动化、数据分析、Humanizer、Bento Slides）。点击示例即可填入来源并继续编辑。
- 完整提示词默认折叠，补充说明放到带圈问号中，并精简了中英文文案。
- 插件仍通过 `penguin plugin install` 安装，导入窗口仍支持上传 zip。

## 兼容性

将 `penguin benchmark import` 调用改为：复制 `benchmark_config.toml` 和 `CASE-*` 文件夹到目标 Project 的 `benchmarks/<id>/`，再创建内容为 `evaluations: []` 的 `scoreboard.yaml`。替换已有目录前需确认，且须等待正在运行的评估结束。更新后的 `benchmark-design` 技能说明了文件布局和来源字段。

移除了仅供 CLI 使用的 `@prismshadow/penguin-server/benchmark-package` 导出。已有 Benchmark 文件无需转换。
