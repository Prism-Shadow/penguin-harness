# 原生活动创作基础

- **Date:** 2026-09-19
- **Type:** feature
- **Scope:** `server`

[English](2026-09-19-native-activity-authoring.md)

Penguin Harness 增加了原生 WAF 活动创作基础：集合清单、`(productCode, refNum)` 活动、文件草稿、规范验证、乐观草稿冲突检测，以及通过 Harness 会话执行生成的接口。

## 细节

- 活动状态索引保存在 SQLite，草稿内容仍以可移植文件保存。
- 生成流程在草稿工作区启动普通 Harness 会话，保留 Harness 的追踪和审批能力。
- 活动规范验证遵循 Loom 的最小契约，并拒绝不完整的输出。
