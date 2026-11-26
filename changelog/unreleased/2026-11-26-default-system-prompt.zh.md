# 优化默认系统提示词的交付物校验与工具执行规范

- **Date:** 2026-11-26
- **Type:** feat
- **Scope:** `core`
- **PR:** https://github.com/Prism-Shadow/penguin-harness/pull/1880

[English](2026-11-26-default-system-prompt.md)

默认系统提示词的 `# Success criteria`、`# Stop rules` 与 `# Tool use` 小节包含六处规则优化：逐项核对显式交付要求（含完整内容比对与转换/过滤的正反例核验）、复用项目文档化检查并补齐边界单测、同错复现时先做低成本归因再重跑测试套件、结构完整的候选产物先行落盘并在精调期间保持文件合法、Debian 非交互式静默安装（`DEBIAN_FRONTEND=noninteractive`），以及跨会话常驻服务独立启动与后台长命令完成通知机制。

内核版本推进至 `2026-11-26`（`prompt` 标签页）。提示词仍为内置默认值的既有 Agent 可通过内核更新采纳上述规则。
