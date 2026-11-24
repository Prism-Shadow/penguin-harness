# CLI 历史记录不再显示内部压缩摘要与草稿

- **Date:** 2026-11-23
- **Type:** fix
- **Scope:** `cli`
- **PR:** [#1790](https://github.com/Prism-Shadow/penguin-harness/pull/1790)

[English](2026-11-23-cli-history-compaction.md)

长会话自动或手动压缩上下文后，使用 `penguin session log` 或 `penguin chat --resume` 查看历史时，不再把内部上下文压缩摘要当成用户提问打印，也不再把压缩过程中的内部提示词、思考、工具调用和摘要草稿混进对话正文。

## 细节

- 历史回放和实时输入保留用户引用摘要标记的原文，查看末尾几条记录时也会过滤压缩草稿。
- 按主会话与子代理来源分别过滤压缩区间内的内部模型消息，不影响正常对话轮次与并发子代理活动。
