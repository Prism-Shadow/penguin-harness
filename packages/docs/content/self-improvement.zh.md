---
title: 自我进化
description: 由 Skill 编排的 Benchmark 评测、优化与晋升闭环：评分、改进、held-out 验证、Snapshot 与回滚。
---

PenguinHarness 中的自我进化由 Skill 编排普通的 Agent 机制完成：评测是普通的 Session，优化是普通的文件编辑，晋升验证是另一个独立的顶层 Session。创建评测、优化和晋升验证分阶段运行，单次评测通过内置的 `run_subagent` 工具委托。顶层 Prompt 提供 Agent、Benchmark、能力目标、分数和轮数等本次设定；调用关系、校准、Freeze、协议、重试、回滚和报告格式由 Skill 或本页的晋升工作流约定负责。

## 角色与调用关系

| 角色 | 职责 |
| --- | --- |
| Builder | 顶层 Agent，依次直接执行 `agent-creation` 和 `benchmark-design` |
| Target Agent | 被改进的 Agent，只在自己的 Workspace 里执行评测任务 |
| Evaluator | `run_subagent` 创建的叶子 Worker，执行并评分一次 Benchmark Case 运行 |
| Optimizer | 新顶层 Agent，直接执行 `agent-optimization` |
| Promotion Validator | 优化结束后的新顶层 Agent，只评测最终 Candidate 是否通过 held-out 晋升门槛，并保留或恢复 Agent State |

Builder 和 Optimizer 在各自的顶层 Session 中直接遵循对应 Skill。Promotion Validator 运行在第三个顶层 Session 中；当前先按本页约定编排 `agent-evaluation`，不把 held-out 结果交回 Optimizer，成熟后可以抽成独立的 `agent-promotion` Skill。Evaluator 通过 `run_subagent` 创建，遵循 `agent-evaluation`，并通过 Penguin CLI 在绝对路径的隔离 Workspace 中启动指定的 Target Agent。Penguin CLI 在每次请求中启动 Target Agent 完成对应的 Case Run。

## 三个独立阶段

PenguinHarness 当前没有线上流量、真实用户反馈或其他持续生产信号充当适应度函数，Benchmark 是自我进化的完整测量边界。因此生产版本只能按批次晋升：Optimizer 可以在一个批次内连续提出和评测 Candidate，但只有批次最终提名的一个版本可以进入独立晋升门槛。所谓“持续在线爬坡”在这个前提下只是把批次缩小到一次改动并删除晋升门槛，不能提供另一种更连续的能力证据。

只使用前两个阶段时，Optimizer 一边读取开发 Benchmark 的分数和 Trace 提出 Candidate，一边又用同一个 Benchmark 决定是否保留 Candidate。Freeze 可以阻止题目和评分标准在优化期间漂移，却不能证明多轮适应后的提升会迁移到未参与诊断的任务；开发分数严格提高只表示“对这个开发 Benchmark 更好”，不等于可以晋升为生产版本。

第三阶段把这两个决定分开：开发 Benchmark 决定 Candidate 是否值得继续保留，held-out Promotion Benchmark 决定优化结束后的最终 Candidate 是否可以替代优化前的生产 Reference。Promotion Benchmark 的 Case、Rubric、分数和 Trace 永远不进入原 Optimizer Session；一次晋升失败后也不得把 held-out 失分反馈给同一个 Optimizer 继续调参，否则 held-out 会退化成另一个开发集。

### 第一阶段：建立开发与晋升 Benchmark

在优化开始前，由一个或多个 Builder 顶层 Session 为同一 Target Agent 分别建立两个普通 Benchmark：用于诊断和选择 Candidate 的 Development Benchmark，以及仅用于最终晋升的 held-out Promotion Benchmark。两者都使用 `benchmark-design` 正常校准、Freeze 并记录各自的 Formal Baseline，而且都绑定同一个优化前 Agent State 版本和评测 Runtime。只有 Development Benchmark 的 id 可以出现在 Optimizer 请求和上下文中；Promotion Benchmark 的 id、Cases、Rubrics、分数和 Traces 都不得提供给 Optimizer。

Builder 先使用 `agent-creation`，再使用 `benchmark-design` 构建多 Case Benchmark。初版 Cases 可以一次建好并形成完整 Pilot 1；后续每轮可以同时调整多个 Case 或难度维度。评测契约和私有标准必须明确、固定，公开 Statement 则不必唯一决定 Gold。Benchmark 可以通过公开信息不足、冲突信号和固定的私有决策标准形成信息差，只要该标准表达可复用的策略、优先级或推断边界，而且不会根据本次答案改写。

每个新增或修改后的 Case 在首次派发前都要检查 Statement 自洽、Rubric 与当前 Statement 和固定私有标准一致，并确认评分项只依赖已定义、已提供或明确属于私有标准的前提；这不要求公开材料足以复现私有标准。Freeze 前再对所有 Case 完整检查一次。大部分分数应落在目标行为与合理捷径会产生不同结果的决定或简洁产物上，避免格式、证据罗列和分析完整度形成过高的保底分。

每轮校准都要在派发前预测：当前 Trace 中的策略会产生什么结果、期望行为会产生什么不同结果，以及会影响多少分。增加一条模型可以直接执行的公开规则、例外、来源或检查项并不会自动增加难度；如果两种策略仍会得到相同的计分结果，就应选择其他改法。

每个 Pilot iteration 对每个 Case 固定只运行一次。Pilot 分数是期望目标：达到后可以提前 Freeze；未达到时完成设定数量的有效 Pilot iteration，并选择其中分数最低的有效版本 Freeze。Builder 在临时目录只保留当前最低有效版本及其完整结果。最终一致性检查通过后，直接把被选中 Pilot 的单次运行结果记录为 Formal Baseline，不再重新运行或补齐更多 Runs；记录后清理临时副本和校准脚手架。Formal 分数没有达到期望也不会使 Benchmark 作废。

### 第二阶段：在 Development Benchmark 上优化

用户确认第一步完成后，在新对话中启动第二个顶层 Session，并指定每个 Candidate、每个 Case 的 `runs`。Optimizer 先检查 Benchmark 和第一条完整 Formal Baseline，再使用 `agent-optimization`：

1. 通过 `run_subagent` 并行编排 Evaluator，覆盖 Case × 用户指定 `runs` 的矩阵；
2. 根据得分和关联 Trace 提出一个有界 Candidate；
3. 编辑 Target Agent 的可编辑状态——`AGENTS.md`、Skills、配置——产出版本 N+1；
4. Evaluation 分数严格提升才保留 Candidate，否则回滚；
5. 达到期望分数时提前结束，否则完成本次设定数量的有效 Candidate round，并保留最高分 Reference。

无效评测和修复重跑不计入轮数。出现执行失败时，Optimizer 保持同一个 Candidate，只补齐失败单元；只要还能根据新诊断提出不同的安全修复，就继续尝试。Builder 和 Optimizer 都先验证 Evaluator 的完整响应是否为纯协议 YAML，再读取状态或分数；格式不合规时，由同一个 Evaluator 基于已有结果重发，不重新运行 Target Agent。

每个 Accepted Candidate 立即写入并校验 Scoreboard。Evaluation 分数严格提高决定是否接受；第一次比较允许直接用 Candidate 的多 Run 平均分比较 Formal Baseline 的单 Run 分数，不为 Baseline 补跑。假设是否在预期 Case 上得到支持单独报告，避免把单次运行中的无关波动解释为改动因果。Agent 优化要求 Scoreboard 中已有完整 Formal Baseline——没有基线，就没有可比较的提升。

一个 **Optimization Batch** 恰好对应一个独立的顶层 Optimizer Session：它从一个已晋升的 `production_reference_version` 出发，只使用 Development 证据，执行设定的 Candidate rounds，并在结束时提名一个最终版本。换一个 Candidate、另开 Promotion Session，或在同一 Session 保存的中间 Reference 之间切换，都不会形成新批次。用顶层 Optimizer Session id 作为 `optimization_session_id`，供第三阶段绑定和审计。

Optimizer 结束时保留的最高分 Reference 只是 **Development-accepted Candidate**。它已经是当前活动 Agent State，但在通过第三阶段前仍不能被报告为已完成生产晋升。Optimizer 的最终报告必须给出 `optimization_session_id`、优化前生产版本 `production_reference_version`、最终 `candidate_version`、Development Benchmark id、评测 Runtime，以及用于失败恢复的 `snapshots/v<production_reference_version>.tar.gz`；缺少可验证的生产 Reference Snapshot 时，不得开始晋升验证。

### 第三阶段：使用 held-out Benchmark 决定晋升

在新的顶层 Session 中启动 Promotion Validator，只向它提供 Target Agent、`optimization_session_id`、最终 `candidate_version`、优化前 `production_reference_version`、Promotion Benchmark id 和该 Benchmark Formal Baseline 的评测 Runtime。它不得读取 Development Benchmark、原 Optimizer 的诊断或私有 Trace，也不得修改 Candidate。

首次派发 held-out 单元前，Promotion Validator 必须确保 `snapshots/v<candidate_version>.tar.gz` 存在、归档版本与当前 Candidate 一致且没有覆盖已有同版本 Snapshot。这个 Snapshot 只用于保留失败 Candidate 的精确状态，供后续批次诊断和重建；它不能让旧 Candidate 绕过新批次的 Development 评测而被直接重新提名。Snapshot 创建或验证失败时，停止在任何 held-out 评测之前。

Promotion Validator 对 held-out Promotion Benchmark 完成一次与其 Formal Baseline 对称的 one-Run-per-Case 矩阵。每个单元仍委托 `agent-evaluation`，并要求 Agent State 版本、`provider`、`model_id` 与 `thinking_level` 全部匹配。错误答案是有效低分；协议、启动、版本、Benchmark 或 Trace 绑定失败不是零分，必须先修复或报告验证失败。

当且仅当矩阵完整有效、Candidate 在评测期间未变化，并且 held-out 顶层平均分不低于 Promotion Scoreboard 中 `production_reference_version` 的最新有效 Evaluation 时，Candidate 才通过晋升。首次晋升时该比较对象就是 Formal Baseline；此后当前生产版本的 held-out 记录，来自它自己当年通过晋升时写入的那条 Evaluation。对称的单 Run 矩阵控制成本但保留逐 Run 噪声，这是已知取舍；门槛因此取不低于而非严格更高。无论通过还是未通过，都先把这次完整 held-out Evaluation 和 Session ids 追加到 Promotion Benchmark 自己的 Scoreboard 并完成校验，再执行保留或恢复；在 `summary_title` 与 `summary` 中记录 `optimization_session_id`、来源版本、Candidate 版本和晋升决定，不改变现有 Scoreboard schema。

- **通过**：保留当前 Candidate Agent State，并报告它已从 `production_reference_version` 晋升为 `candidate_version`。
- **未通过**：使用优化前 Snapshot 恢复并验证 `production_reference_version`。Development Benchmark 中已经产生的分数和 Trace，以及 gate 前保存的 Candidate Snapshot，都保留为实验记录和后续批次的诊断证据。
- **验证无法完成**：不把缺失或无效单元当成零分，也不声称晋升成功；在能够安全验证或恢复前报告具体阻塞。

晋升决定在第三阶段终止。每个 `optimization_session_id` 最多只能绑定一个 `candidate_version` 和一次晋升矩阵；对同一 Candidate 的协议更正、未启动单元修复和未完成矩阵续跑仍属于同一次晋升。完整有效矩阵一旦作出通过或未通过决定，就不得改提同批次的其他 Candidate 重新验证——连续改提等于让 held-out 在多个版本之间做选择，最终通过者的分数会系统性偏高。下一次晋升必须来自新的顶层 Optimizer Session。不得把 held-out 的 Case 级失分、Trace、Rubric 或晋升结果发送回原 Optimizer 继续生成 Candidate。若团队开始根据这些证据调整 Agent，当前 Promotion Benchmark 就已成为开发证据，应另建并冻结新的 held-out Benchmark 承担下一次独立晋升。固定 held-out 的长期轮换属于后续 successor Benchmark 外循环，不在当前工作流中规定具体使用次数。

## Benchmark 存储

Benchmark 按 Agent 存放在 `benchmarks/<id>/` 下：

```text
benchmarks/<id>/
├── benchmark_config.toml       # Benchmark 配置（Builder 的 runs 固定为 1）
├── <case-id>/
│   ├── statement/              # 交给 Target Agent 的任务描述
│   └── rubric/                 # 私有评分标准，对 Target Agent 隔离
└── scoreboard.yaml             # 当前格式的评测记录
```

`rubric/` 与 `statement/` 的隔离是刻意设计：评测协议只把题面交给 Target Agent；若 Target 根 Trace 或其直接引用的子 Trace 显示直接或间接访问了 Benchmark 或 Rubric 数据，Evaluator 必须把该 Run 判为无效。仅有目录分离不能证明 Target 从未接触评分标准。

Development 与 Promotion 在当前工作流中仍是同一 Agent 下的两个普通 `benchmark_id`，角色由调用约定决定，不新增配置字段。这个隔离是 **契约级 soft seal**：Skill 禁止 Target Agent 和 Optimizer 读取私有或未指定的 Benchmark 表面，但当前本地工具并没有把绝对路径访问硬限制在预期目录内。普通产品工作流依靠独立顶层 Session、最小输入，以及对 Target、Evaluator、Optimizer Trace 的审计维持该边界；需要正式泄漏声明时，应额外审计这些根 Trace 与所引用子 Trace 中的直接和间接文件访问，或把私有数据和 Promotion 数据放进这些 Session 技术上不可访问的独立边界。

`scoreboard.yaml` 中的每条评测记录带时间戳，并记录：

- 本轮 Runtime：用户显式指定的 `(provider, model_id)` 成对值优先，否则继承 Builder Session；`thinking_level` 从 Target Agent 配置读取，不依赖 Trace 元数据；
- `summary_title` 与 `summary`（本轮结论与下一轮假设）；
- 由模型写入的 Score、成本与耗时平均值——Case 级对 Runs 求平均，Evaluation 级对 Cases 求平均；单次 Run 成本保留记录中的原始精度，成本平均值忽略 `null`，全部未知时才为 `null`；Score 保留两位小数，成本平均值保留六位小数，`duration_ms` 取整；
- 每个 Case 的逐次运行明细，每次运行含 `score`、`cost`、`duration_ms` 与 `session_id`。

每个 Run 和每个 Case 都固定满分 100，因此 Scoreboard 不再记录 `max_score`。服务端与 Web UI 直接信任已写入的聚合值，不重算、不交叉校验；旧 Scoreboard 不迁移、不回填。

内置的 `default_agent` 预置了一个示例 Benchmark（`packages/core/src/state/example-benchmark.ts`），评测页面开箱即有数据；整个目录可随时删除或替换。

## Snapshot 与版本

每轮优化前，Agent State 被打包为 `snapshots/v<version>.tar.gz`（Vault 除外——密钥永不进入快照）。`system_config.yaml` 的 `version` 在优化成功后自增。Web UI 支持导出与导入快照，导入版本不高于当前版本时需要显式确认。第三阶段失败时恢复的是整个 Optimization Session 开始前的 `production_reference_version`，而不是最后一轮 Candidate 之前的中间 Reference；恢复后必须重新读取并验证 Agent State 版本与文件内容。恢复不回收版本号：任何已写入某个 Scoreboard 或 `snapshots/` 的版本号都视为已消耗。失败晋升后的下一个 Optimization Session 必须从所有已记录版本的最大值加一开始编号，即使恢复后的生产版本更低——否则新旧两条支线会在 Scoreboard 中共用同一个版本号，还会错误复用失败支线的同名快照。`agent-optimization` 的候选编号规则据此约定。

## 全程可审计

- 每次 Evaluator 运行都是一个普通的 Session，留有完整 Trace；
- scoreboard 记录通过 `session_id` 链接回这些 Session，见 [Session 与 Trace](/sessions-and-traces)；
- Web 的评测页面是这些文件的只读视图；折线图只展示 Score，明细表将模型 ID 与推理强度分列显示。见 [Web App 指南](/web-app)。

分数不是黑盒输出：任何一个数字都可以回溯到产生它的那次运行。

## 相关 Skill

| Skill | 用途 |
| --- | --- |
| `agent-creation` | 把需求变成可用的 Agent：撰写其 `AGENTS.md`、安装所需 Skill |
| `benchmark-design` | 设计并校准多 Case 的能力 Benchmark |
| `agent-evaluation` | 隔离执行并评分一次 Benchmark Case 运行 |
| `agent-optimization` | 根据 Benchmark 结果改进 Agent |

当前的 Promotion Validator 暂不对应新的内置 Skill；它按照本页第三阶段约定编排现有 `agent-evaluation`、写入 held-out Scoreboard，并在失败时通过既有 Snapshot 恢复生产 Reference。工作流稳定后再考虑抽取 `agent-promotion`，无需为本阶段增加核心运行时机制。

Skill 的组织与安装方式见[技能系统](/skills)。
