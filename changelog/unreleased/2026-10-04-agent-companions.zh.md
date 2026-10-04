# 为 Agent Tuning 添加伴生监管

- **Date:** 2026-10-04
- **Type:** feature
- **Scope:** `skills`, `docs`, `landing`

[English](2026-10-04-agent-companions.md)

新增 `agent-supervision`，由 Agent Tuning 的任务 Skill 引用，为每次委派的执行配置独立 Supervisor 伴生者。

## 细节

- 规定伴生对就绪、轨迹观察、立即通知父 Agent、停止确认、双方报告与任务状态记录。
- 规定确认作弊后的三次重跑，只追加 user instruction，不改系统配置；耗尽后返回附原因的策略零分，原始结果单独保留。
- 添加 Penguin 工具子会话与明确登记的 server Session 委派方案，遵守工具深度限制与任务预算。
- 对齐角色文档、插件版本和中英文 Skill 清单。
