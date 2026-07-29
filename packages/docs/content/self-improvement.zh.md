---
title: 自我进化
description: 由 Skill 编排的 Benchmark 评测与优化闭环：评分、改进、Snapshot 与回滚。
---

PenguinHarness 中的自我进化不依赖专用引擎代码，而是由 Skill 编排普通的 Agent 机制完成：评测是普通的 Session，优化是普通的文件编辑。创建评测与优化分别运行在两个独立的顶层 Session 中，只有单次评测通过内置的 `run_subagent` 工具委托。顶层 Prompt 只提供 Agent、Benchmark、能力目标、分数和轮数等本次设定；调用关系、校准、Freeze、协议、重试、回滚和报告格式由 Skill 负责。

## 角色与调用关系

| 角色 | 职责 |
| --- | --- |
| Builder | 顶层 Agent，依次直接执行 `agent-creation` 和 `benchmark-design` |
| Target Agent | 被改进的 Agent，只在自己的 Workspace 里执行评测任务 |
| Evaluator | `run_subagent` 创建的叶子 Worker，执行并评分一次 Benchmark Case 运行 |
| Optimizer | 新顶层 Agent，直接执行 `agent-optimization` |

Builder 和 Optimizer 亲自遵循各自的 Skill，不把工作流再委托给子 Agent。只有 Evaluator 由它们通过 `run_subagent` 创建；Evaluator 遵循 `agent-evaluation`，并通过 Penguin CLI 在绝对路径的隔离 Workspace 中启动指定的 Target Agent。CLI 不用于创建额外的 Builder、Optimizer 或 Evaluator。

## 两个独立步骤

第一个顶层 Session 创建 Agent 和能力评测。Builder 先使用 `agent-creation`，再使用 `benchmark-design` 构建多 Case Benchmark。初版 Cases 可以一次建好并形成完整 Pilot 1；后续每轮可以同时调整多个 Case 或难度维度。评测契约和私有标准必须明确、固定，公开 Statement 则不必唯一决定 Gold。Benchmark 可以通过公开信息不足、冲突信号和固定的私有决策标准形成信息差，只要该标准表达可复用的策略、优先级或推断边界，而且不会根据本次答案改写。

每个新增或修改后的 Case 在首次派发前都要检查 Statement 自洽、Rubric 与当前 Statement 和固定私有标准一致，并确认评分项只依赖已定义、已提供或明确属于私有标准的前提；这不要求公开材料足以复现私有标准。Freeze 前再对所有 Case 完整检查一次。大部分分数应落在目标行为与合理捷径会产生不同结果的决定或简洁产物上，避免格式、证据罗列和分析完整度形成过高的保底分。

每轮校准都要在派发前预测：当前 Trace 中的策略会产生什么结果、期望行为会产生什么不同结果，以及会影响多少分。增加一条模型可以直接执行的公开规则、例外、来源或检查项并不会自动增加难度；如果两种策略仍会得到相同的计分结果，就应选择其他改法。

Pilot 分数是期望目标：达到后可以提前 Freeze；未达到时完成设定数量的有效 Pilot iteration，并选择其中分数最低的有效版本 Freeze。Builder 在临时目录只保留当前最低有效版本，Formal Baseline 记录后清理该副本和校准脚手架。Freeze 后必须运行全新完整的 Formal matrix；只要 Formal 有效就记录 Baseline，分数没有达到期望也不会使 Benchmark 作废。

用户确认第一步完成后，在新对话中启动第二个顶层 Session。Optimizer 先检查 Benchmark 和第一条完整 Formal Baseline，再使用 `agent-optimization`：

1. 通过 `run_subagent` 并行编排 Evaluator，覆盖 Case × 运行次数矩阵；
2. 根据得分和关联 Trace 提出一个有界 Candidate；
3. 编辑 Target Agent 的可编辑状态——`AGENTS.md`、Skills、配置——产出版本 N+1；
4. 总分严格提升才保留 Candidate，否则回滚；
5. 达到期望分数时提前结束，否则完成本次设定数量的有效 Candidate round，并保留最高分 Reference。

无效评测和修复重跑不计入轮数。出现执行失败时，Optimizer 保持同一个 Candidate，只补齐失败单元；只要还能根据新诊断提出不同的安全修复，就继续尝试。Builder 和 Optimizer 都先验证 Evaluator 的完整响应是否为纯协议 YAML，再读取状态或分数；格式不合规时，由同一个 Evaluator 基于已有结果重发，不重新运行 Target Agent。

每个 Accepted Candidate 立即写入并校验 Scoreboard。总分严格提高决定是否接受；假设是否在预期 Case 上得到支持单独报告，避免把单次运行中的无关波动解释为改动因果。Agent 优化要求 Scoreboard 中已有完整 Formal Baseline——没有基线，就没有可比较的提升。

## Benchmark 存储

Benchmark 按 Agent 存放在 `benchmarks/<id>/` 下：

```text
benchmarks/<id>/
├── benchmark_config.toml       # Benchmark 配置（如每个 Case 的运行次数 runs）
├── <case-id>/
│   ├── statement/              # 交给 Target Agent 的任务描述
│   └── rubric/                 # 私有评分标准，对 Target Agent 隔离
└── scoreboard.yaml             # 评测记录（v2 格式）
```

`rubric/` 与 `statement/` 的隔离是刻意设计：Target Agent 只能看到题面，永远接触不到评分标准。

`scoreboard.yaml`（v2 格式）中的每条评测记录带时间戳，并记录：

- 本轮实际使用的 Runtime：模型成对引用 `(provider, model_id)` 与 `thinking_level`；省略顶层 Prompt 中的模型参数时，首次 Pilot 使用 Project 默认模型，后续评测复用已解析的模型；
- `summary_title` 与 `summary`（本轮结论与下一轮假设）；
- 总分、成本与耗时——Case 级指标是各次运行的平均值，评测级指标是各 Case 的加和；
- 每个 Case 的逐次运行明细，每次运行含 `score`、`cost`、`duration_ms` 与 `session_id`。

内置的 `default_agent` 预置了一个示例 Benchmark（`packages/core/src/state/example-benchmark.ts`），评测页面开箱即有数据；整个目录可随时删除或替换。

## Snapshot 与版本

每轮优化前，Agent State 被打包为 `snapshots/v<version>.tar.gz`（Vault 除外——密钥永不进入快照）。`system_config.yaml` 的 `version` 在优化成功后自增。Web UI 支持导出与导入快照，导入版本不高于当前版本时需要显式确认。

## 全程可审计

- 每次 Evaluator 运行都是一个普通的 Session，留有完整 Trace；
- scoreboard 记录通过 `session_id` 链接回这些 Session，见 [Session 与 Trace](/sessions-and-traces)；
- Web 的评测页面是这些文件的只读视图，见 [Web App 指南](/web-app)。

分数不是黑盒输出：任何一个数字都可以回溯到产生它的那次运行。

## 相关 Skill

| Skill | 用途 |
| --- | --- |
| `agent-creation` | 把需求变成可用的 Agent：撰写其 `AGENTS.md`、安装所需 Skill |
| `benchmark-design` | 设计并校准多 Case 的能力 Benchmark |
| `agent-evaluation` | 隔离执行并评分一次 Benchmark Case 运行 |
| `agent-optimization` | 根据 Benchmark 结果改进 Agent |

Skill 的组织与安装方式见[技能系统](/skills)。
