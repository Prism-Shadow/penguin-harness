# 三条 Benchmark 流程都用上 agent-evaluation，创建示例改回纯文本

- **Date:** 2026-09-15
- **Type:** fix
- **Scope:** `web`
- **PR:** [#728](https://github.com/Prism-Shadow/penguin-harness/pull/728)

[English](2026-09-15-benchmark-flows-skills.md)

## 变更内容

- 评估中心开出的出题、评估、优化对话现在都预选了它们依赖的技能——出题预选 `benchmark-design` 与 `agent-evaluation`，评估预选 `agent-evaluation`，优化预选 `agent-optimization` 与 `agent-evaluation`——发送时随 `[use_skills]` 块送达，模型动手前先读技能；所选 Agent 没装的技能不会被预选，使用弹窗本来就有缺技能提示。三段固定尾部也都明说：每一次评测都必须经 `run_subagent` 派发子会话、在子会话里使用 `agent-evaluation`，不得自行打分、不得绕过——此前模型时不时正是这么干的。
- 「用 AI 创建」的四个示例改回一两句话的纯文本场景描述（材料怎么矛盾、什么被藏起来、输入哪里模糊）。结构化要求挪进固定尾部：题量约 3 道、少而难；出题手法（隐藏的先验条件、模糊或不完整的输入、互相冲突的材料、严格的交付格式，不靠堆行数堆规则加难度）；期望基线分 50 以下；Pilot 上限 4——上文另有要求时仍以上文为准。
- `benchmark-design` 不再把「没达到 desired_baseline_score」当作校准失败。发布门槛固定为 `0..100` 里的 85：冻结的 Formal Baseline 低于 85 就发布，离期望分数多远都无妨；只有做不出任何有效的 Pilot 版本、或迭代上限内最低分的有效版本仍不低于 85 时才写 `status = "failed"`（插件 `agent-tuning` 2026.09.15.1）。
- 内置示例 Benchmark 改为只要 `benchmarks/example-benchmark/` 本身不存在就预置，而不再要求整个 `benchmarks/` 目录不存在。示例出现之前就自己创建过 Benchmark（创建即建目录）、或者还留着旧的按 Agent 存放的 `agents/default_agent/benchmarks/` 副本的 Project，下次装载 `default_agent` 时都会得到 Project 层级的示例。已存在的示例一概不动，旁边用户自己的 Benchmark 也一概不动；删掉的示例会在下次装载时回来。
- 按 Workspace 分组时，评估为每个 Case × Run 建的独立 Test Workspace 不再各自成组：凡直接位于 Agent 自己的 `workspaces/` 之下的目录——这些 Test Workspace 与 core 的 `tmp-` 目录一样——都并入**临时工作区**分组，服务端的分组分页与侧栏的分组用同一条规则。用户自选的目录仍各自成组。
- 「用 AI 创建」的第一个示例改为首页同款的通用决策场景——足球投注、售后处置、投资动作，各是在互相冲突或不完整的规则、历史案例与当前事实下做有限选择。示例仍是四个：数据分析那条让位。
