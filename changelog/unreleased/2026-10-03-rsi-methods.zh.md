# 分开优化通用约定与方法 reference

- **Date:** 2026-10-03
- **Type:** process
- **Scope:** `skills`, `docs`

[English](2026-10-03-rsi-methods.md)

将 `agent-optimization` 改为通用输入、评估、版本与输出约定，把 Penguin 默认优化策略
移入 reference，并加入 ACE、AWM 方法 reference，各自定义反馈权限与接受规则。

## 细节

- 未指定方法时仍使用 Penguin，保留严格提分门槛和原有基线采样策略。
- 保留 ACE 增量规则更新、AWM 从成功经历归纳流程的机制，按冻结的 Student 批次执行并独立测试。
- 复用 Agent Tuning 插件与文件加载能力，不增加方法包、包依赖或 core/CLI 实现改动。
