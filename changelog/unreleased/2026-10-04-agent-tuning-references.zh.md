# 拆分 Agent Tuning 通用规约与专用方案

- **Date:** 2026-10-04
- **Type:** refactor
- **Scope:** `skills`

[English](2026-10-04-agent-tuning-references.md)

将初始化和评估的通用规则与 Penguin 默认做法、算法或 benchmark 专用方案分开。

## 细节

- 将 Penguin 配置、hook 和启动说明移入 references；新增 GDPevo 评估 reference，说明环境和评分要求。
- 将 ACE、AWM 的基线产物和固定 reader 移入初始化 references，优化方法通过链接复用。
- 将 Penguin 的 Pilot 校准与发布策略移入 benchmark-design reference，格式与并行评估调度保留在 Skill 中。
- 明确适用的 reference 优先于通用 Skill；专用方案在其范围内优先于 Penguin 默认做法。
