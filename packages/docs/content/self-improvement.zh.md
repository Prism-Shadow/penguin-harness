---
title: 自我进化
description: 由 Skill 编排的 Benchmark 评测与优化闭环：评分、改进、Snapshot 与回滚。
---

PenguinHarness 中的自我进化不依赖专用引擎代码，而是由 Skill 编排普通的 Agent 机制完成：评测是普通的 Session，优化是普通的文件编辑，编排靠内置的 `run_subagent` 工具。这样做的直接收益是——整个过程与日常运行共用同一套可观测性与恢复机制。

## 三个角色

| 角色 | 职责 |
| --- | --- |
| Target Agent | 被改进的 Agent，只在自己的 Workspace 里执行评测任务 |
| Evaluator | 执行并评分一次 Benchmark Case 运行 |
| Optimizer | 驱动整个优化循环 |

角色由 Skill 定义而非硬编码：Evaluator 遵循 `agent-evaluation` Skill，Optimizer 遵循 `agent-optimization` Skill。这正是[配置参考](/configuration)所述设计原则的应用——Agent 的行为是磁盘上的可编辑文件，所以 Agent 可以被 Agent 改进。

## 优化循环

1. `benchmark-design` 构建多 Case 的能力 Benchmark：重复独立运行，先校准出可追溯的基线；
2. Optimizer 通过 `run_subagent` 工具并行编排 Evaluator，覆盖 Case × 运行次数矩阵；
3. 得分与其关联的 Trace 共同指出失分位置；
4. Optimizer 编辑 Target Agent 的可编辑状态——`AGENTS.md`、Skills、配置——产出版本 N+1；
5. 每轮开始前先打 Snapshot；总分严格提升才保留候选版本，否则回滚。

Benchmark 优化模式要求 scoreboard 中已有完整的基线序列——没有校准过的基线，就没有可比较的提升。除此之外 `agent-optimization` 还支持一次性反馈模式：把一条具体的纠正意见直接落实为对 Target Agent 状态的编辑，不经过评测循环。

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

- 本轮使用的模型成对引用 `(provider, model_id)`；
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
| `agent-optimization` | 根据反馈或 Benchmark 结果改进 Agent |

Skill 的组织与安装方式见[技能系统](/skills)。
