# 隔离的 Agent 调优流水线

- **Date:** 2026-07-25
- **Type:** feature
- **Scope:** `web`, `skills`
- **PR:** [#129](https://github.com/Prism-Shadow/penguin-harness/pull/129)

[English](2026-07-25-agent-tuning-pipeline.md)

Web App 现在包含一个可运行的示例，它协调 Agent 创建、Benchmark 构建与依分数驱动的 Agent 优化，且各阶段之间不共享私有的评估上下文。

## Web App

新的草稿页示例会为每个阶段启动一个独立的 Penguin CLI Session，其环境派生自当前活动的 Project。它的 Benchmark 使用隐藏的「上下文到动作」映射，使优化器能够展示由分数反馈带来的可度量改进。

Benchmark 构建现在使用临时的 Pilot 评估，一次只调整一个难度维度，然后再冻结并记录 Formal Baseline。

## Skills

Agent 创建、Benchmark 设计、评估与优化这几个 Skill 现在定义了更清晰的归属与访问边界。Benchmark 构建者与优化器通过一套显式的 Evaluator 请求协议来委派每个 Case 的运行，而私有的 Rubric 与 Gold 答案则始终限定在评估 worker 之内。

Benchmark 设计现在把可变的 Pilot 校准与冻结的 Formal Baseline 分开，并防止围绕已观察到的答案做仅改 Rubric 的降分。
