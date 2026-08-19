# data-analysis skill v2 与更精简的多 Run 评估流程

- **Date:** 2026-08-04
- **Type:** feature
- **Scope:** `skills`, `docs`
- **PR:** [#194](https://github.com/Prism-Shadow/penguin-harness/pull/194)

[English](2026-08-04-data-analysis-skill-v2.md)

`data-analysis` 库 Skill 升到 v2，收紧了它在数据粒度与语义、原生产物处理、完整交付，以及与风险成比例的验证这几方面的约束。基准测试流程不再重跑它已经测过的东西：设计阶段把每个 Case 固定为一次运行，并逐字复用选定的 Pilot 结果作为 Formal Baseline；优化阶段接受用户指定的逐候选 `runs` 次数，按 Case × Runs 并行派发，并直接比较所记录的平均值；而 Evaluator 把 `run` 视作上游指派的标签，不再拒绝超出配置总数的运行。文档（中英）、前端示例提示词与契约测试同步更新。
