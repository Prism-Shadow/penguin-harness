# 运行参数标签页可编辑压缩的工具轮数、每轮提醒与交接说明

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `server`, `web`, `docs`, `ui-gallery`
- **PR:** [#1591](https://github.com/Prism-Shadow/penguin-harness/pull/1591)

[English](2026-11-17-compaction-settings-ui.md)

`compaction.max_rounds`、`compaction.reminder` 与 `compaction.handoff_note` 可以在 Web App 里编辑了：Agent 设置的**运行参数**标签页在压缩一节新增**最多工具轮数**、**每轮提醒**与**交接说明**，随该页的表单一起保存。

## 细节

- Agent 配置 API 的 `compaction` 新增 `maxRounds`、`reminder` 与 `handoffNote`，报告生效值：在这几个键出现之前写下的 `system_config.yaml` 读作内置默认值，与 core 的运行口径一致。PUT 写入收到的每一项；`maxRounds` 须为不小于 0 的整数，空白的文字按空白保存。
- 标签页上，**最多工具轮数**与压缩方式并列，不是不小于 0 的整数时显示它自己的行内错误。两段文字排在摘要提示词之后，各占一节；提示列出各自可用的占位符，并写明留空的含义：不发提醒，或交接说明只留引述的内容。
- 服务端没有报告这三项时（例如机器上较旧的服务端），三项都不显示。
- 配置文档写明：在运行参数标签页保存其中一项，即把它写进文件。
