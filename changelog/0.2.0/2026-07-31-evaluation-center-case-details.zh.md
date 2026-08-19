# 评估中心的 Case 详情与分数图表

- **Date:** 2026-07-31
- **Type:** feature
- **Scope:** `web`, `server`, `skills`
- **PR:** [#146](https://github.com/Prism-Shadow/penguin-harness/pull/146)

[English](2026-07-31-evaluation-center-case-details.md)

Case 详情现在把「对目标 Agent 可见的任务材料」与「对项目成员可见的评分 Rubric」分开呈现，同时把两个文件根都限制在各自路径之内。分数图表采用带留白的动态坐标轴，且不丢弃权威的已存取值；Benchmark 相关 Skill 则用 YAML 折叠标量来写 Scoreboard 摘要。

## 细节

- Case 详情把任务材料与评分 Rubric 作为两个独立的文件组展示。Rubric 对目标 Agent 保持隐藏。
- 分数图表对观测到的、位于量程内的取值加留白，把显示的坐标轴钳制在 0–100，并保留已存的有限取值用于绘图与提示气泡。
- Benchmark 设计与优化 Skill 把摘要字段写为 YAML 折叠标量，并在追加一次 Evaluation 之后解析完整的 Scoreboard。
