# 异常结束的已计量请求只统计一次

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1356](https://github.com/Prism-Shadow/penguin-harness/pull/1356)

[English](2026-10-26-metered-request-count.md)

修复了模型已报告 token 用量、随后以异常原因结束时，成本中心额外增加一次请求的问题。后续重试和并发子会话仍分别计数。标题生成单独计量：标题在对话请求进行中生成完毕，也不会导致该请求随后的失败被漏记。
