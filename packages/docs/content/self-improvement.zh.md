---
title: 自我进化
description: 用 Skill 构建或复现 Benchmark、评估 Target Agent，再按选定的 RSI 方法改进其 harness。
---

默认的 Penguin 优化方法是一个循环：为 Agent 构建 Benchmark，在上面给 Agent 打分，修改 Agent，只有分数严格提升才保留改动。这个循环不额外引入任何运行机制，而是由 Skill 编排普通的 Agent 机制：评估是普通的 Session，优化是普通的文件编辑，每个结果都是 Project 里的文件。

Root Agent 通常由 Default Agent 担任。它每次委派一个执行阶段，都创建 Supervised Agent 和独立的 Supervisor 伴生者。五个任务 Skill 通过文件链接引用 `agent-supervision`；每个子任务由自己的父 Agent 创建伴生对并接收报告。

## 角色

| 角色 | 工作 |
| --- | --- |
| Root Agent | 创建伴生对、维护任务与尝试状态、停止异常执行并汇总报告 |
| Builder | 初始化 Target，设计或复现 Benchmark |
| Optimizer | 分析允许的训练轨迹，更新 Target Harness |
| Evaluator | 执行一次 Target 尝试，私下评估保存的产物 |
| Target Agent | 使用固定 harness 和干净上下文完成分配的题目 |
| Supervisor Agent | 从放行到最终审计，独立观察一个指定执行会话 |

这些是工作流角色。Builder、Optimizer、Evaluator、Target 和 Reporter 都可以是 Supervised Agent；Supervisor 是叶子观察角色。六个 Skill 随 `agent-tuning` 提供。Target/Test Agent 指同一个做题角色，可执行训练或测试；Root 是委派者，与 Supervisor 分工不同。

### 伴生生命周期与恢复

父 Agent 绑定双方 Session，等待 Supervisor 就绪，再放行任务。独立的 case 伴生对可在预算内并行。Penguin 工具子 Agent 目前最多一层；更深的逻辑委派使用明确登记的 server Session。CLI Target 在开始任务前以 source `benchmark` 创建，仍归入评估中心的会话分类。

伴生者核对实际指令与 trace 行为。发现异常后立即通知父 Agent，由父 Agent 停止执行并确认终止。确认作弊后，用新的一对伴生会话重做同一任务，只在 **user instruction** 中追加具体约束，不改 system prompt/config 或持久 State。首次执行加三次重跑为上限；正常低分不因此重跑。第四次仍作弊则记策略零分并附原因，原 grader 输出与全部尝试保留在私有记录中。

Root 的任务表记录任务编号、双方 Session、尝试次数、状态与待处理告警。双方都结束后才关闭伴生对；trace 暂停增长需核对状态，证据缺失不等于合规。Evaluator 的 YAML 结果与审计报告分开传递，由调用方在单独报告中应用有原因的终止惩罚分，不写入普通基线记分板。惩罚分不能证明基线有效、用于算法学习或为受污染 harness 的发布背书；补救后成绩与 harness 学习收益分开报告。

## 信息隔离

被测 Agent 不应看到私有评分信息。下表描述默认 Penguin 方法；其他 RSI 方法在各自 reference 中声明训练反馈权限。测试信息始终不进入 Optimizer 上下文。

| 角色 | 读取 | 不读取 |
| --- | --- | --- |
| Target Agent | 全新 Workspace 里题目 `statement/` 的副本，以及自己的 Agent State | 评分细则：它从不进入这个 Workspace，路径也不会告诉 Target Agent |
| Evaluator | 题干、评分细则、Target Agent 的 State，以及本次运行的 Workspace 和 Trace | 其他 Agent、Project 的密钥、无关的 Workspace 或 Trace |
| Optimizer | 公开的题干、记分板、与分数关联的被测 Trace，以及 Target Agent 的 State | 评分细则、Gold（标准答案）、私有评分条件、Evaluator 的 State、Workspace 或 Trace、其他 Agent，以及 Project 的密钥 |
| Builder | 整个 Benchmark（包括它自己写的评分细则）、Target Agent 的 State，以及被测 Trace | Evaluator 的 State、Workspace 或 Trace、其他 Agent，以及 Project 的密钥 |

Evaluator 返回的结果里不含评分细则的内容、Gold、逐项得分和评分理由。新增或修改的题目下发之前，Builder 先做泄题检查：任何公开文件都不得泄露 Gold、私有评分条件，或能指向预期解法的提示。一旦超出所选方法权限的信息进入 Optimizer 上下文，就恢复由它改动的当前候选版本，并以「污染」为由停止。

> [!WARNING]
> 角色隔离依赖 Skill 指令与轨迹审计；全新工作区本身不等于强制隔离。伴生会话继承父级实际 approval/sandbox 策略。如果该策略允许广泛访问，Target 工作区没有 Rubric 也不能阻止它从其他路径读取。报告需要说明实际隔离和观察边界；Project 成员也能在 Web App 查看 Rubric。

## 构建 Benchmark

受监管的 Builder 阶段负责创建 Agent 和它的能力评估。Builder 先执行 `agent-initialization`，再执行 `benchmark-design`，拿到的输入是 Target Agent、要考察的能力、期望的基线分数和 Pilot 迭代上限。

评估 Runtime 在第一次 Pilot 之前就固定下来。用户指定的 `(provider, model_id)` 模型对优先；没有指定时，沿用 Builder Session 的模型对。思考等级取自 Target Agent 的 `model.thinking_level`，字段缺失时为 `medium`。校准时每道题目总是只运行一次，所以 Builder 的 `runs` 固定为 1。

### 设计题目

评估契约和私有标准必须清楚且固定，公开的题干却不必唯一确定 Gold。Benchmark 可以使用不完整的公开信息、相互冲突的信号和固定的私有决策标准，前提是这个标准表达的是可复用的策略、优先级或推断边界，而且不会在看到本次运行的答案之后再改。

大部分分数应落在这样的决策或简洁产物上：预期行为与看似合理的捷径在这里会得出不同的结果。格式、证据罗列和分析完整度不应构成偏高的保底分。

每道新增或修改过的题目在首次下发之前，Builder 都要检查一遍：

- 题干内部自洽；
- 评分细则与当前题干、固定的私有标准一致；
- 每个评分项所依赖的前提，要么已经定义，要么已经提供，要么明确属于私有标准。

这项检查不要求公开材料足以还原私有标准。Freeze 之前，Builder 还要对所有题目完整检查一遍。

### 校准难度

每一轮 **Pilot**（试测迭代）中，每道题目恰好运行一次。Builder 可以在 Pilot 1 之前就写好完整的初始题目集，之后的某一轮迭代也可以同时打磨多道题目或多个难度维度。

每次下发校准之前，Builder 先预测三件事：Trace 中观察到的策略会得出什么结果，预期行为会得出什么不同的结果，以及会影响多大范围的分数。再加一条模型可以直接照做的公开规则、例外、来源或检查项，并不会自动让题目变难。如果两种策略仍会得到相同的计分结果，Builder 就换一种打磨方式。

### 冻结基线

期望的基线分数是目标，不是门槛：

- 有效的 Pilot 达到期望分数，就可以提前 **Freeze**（冻结）。
- 否则 Builder 跑完设定数量的有效 Pilot 迭代，冻结得分最低的有效版本。期间它只把当前得分最低的有效版本及其完整结果留作临时副本。

最终的一致性检查通过后，Builder 把选中那次 Pilot 的单次运行结果直接记为 **Formal Baseline**（正式基线），不重跑，也不补跑其他运行。随后删掉临时副本和其他校准用的脚手架。

没达到期望分数不会让 Benchmark 作废。发布门槛固定为 85 分：Formal Baseline 低于 85 就发布。只有两种情况 `benchmark-design` 才报告 `calibration_failed`：没有任何可冻结的有效 Pilot 结果，或者到了迭代上限，所有有效版本的得分仍不低于 85。

## 复现已有 benchmark

向 `benchmark-reproduction` 提供 GitHub URL、benchmark 名称或本地源码。
命中 reference 时按对应配方构造；未命中时走通用流程，也可由用户给出自定义 prompt。
原始 training/testing 划分生成 `<name>_train` 与 `<name>_test`。
长程任务保留相同任务定义，通过明确的 trial／时间切点和环境状态交接分开执行。

Skill 生成原生 Statement/Rubric，委派 `agent-evaluation` 跑少量完整冒烟测试，
检查评估中心可见性，再询问是否跑全量。冒烟结果不算全量基线。
复现保持原题难度，低于 85 分的校准门槛只适用于新建题目。
数据和必要的适配器按需生成到 Project 中，不打包进 Penguin，也不设为默认 benchmark。

`agent-optimization` 对 Target Agent 执行选定的 RSI 方法，默认使用 Penguin，
其他方法由 reference 提供。在请求中指定方法名称，读取对应的更新与选择规则。
输入、评估和输出格式写在 Skill 中。下文描述 Penguin 的严格提分策略。

## 优化 Agent

用户确认第一步完成后，在新对话中启动第二个顶层 Session，并设定每个 Candidate（候选版本）每道题目的 `runs`、目标分数和轮数上限。Optimizer 先确认 Benchmark 是 `published`、并且已有这个 Agent 的完整 Formal Baseline，然后按 `agent-optimization` 执行。缺少任何前提，它就停下来说明原因。

**Reference**（参照版本）是当前保留的最佳 Agent State，连同它的完整评估。每一轮都基于它构建一个 **Candidate** 来测试：

1. 根据每道题目的分数和关联的 Trace，诊断能力缺口。
2. 提出一个可证伪的假设，只做一处有边界的改动：`AGENTS.md` 中的行为指引、Agent 自有的一个专项 Skill，或 `system_config.yaml` 中可以安全修改的字段。Candidate 的版本号是 Reference 的版本号 + 1，落选过的版本号永不复用。
3. 由多个 Evaluator 并行评估完整的 Case × runs 矩阵，沿用 Reference 的供应商、模型和思考等级。
4. Candidate 的评估分数严格高于 Reference 才保留，否则回滚。
5. 达到目标分数就提前停止；否则跑完设定数量的有效轮次，保留得分最高的 Reference。

除非用户要求，Optimizer 不修改 `system_prompt`，也从不修改 `model.thinking_level`，因为 Reference 的分数已经确定了评估用的思考等级。Benchmark、被测 Trace 和 Project 配置都不在它的改动范围内。它对 Benchmark 唯一的写入，是把采纳的评估追加到 `scoreboard.yaml`。

### 评分与采纳

每个采纳的 Candidate 都会立即追加进记分板并核验。是否采纳，只看评估分数是否严格更高。第一次比较直接拿 Candidate 的多次运行平均分对比 Formal Baseline 的单次运行分数，不为基线补跑。预测的题目行为是否真的发生了变化，会单独报告，以免把单次运行中无关的波动说成因果证据。

优化要求记分板里已有完整的 Formal Baseline：没有基线，就没有可比较的提升。落选的 Candidate 永远不进记分板，每一轮的报告只留在对话里。

### 失败与停止

无效的评估和纠正性的重跑不计入轮数上限；落选 Candidate 的完整有效评估则计入。执行失败时，Optimizer 保留同一个 Candidate，只补齐缺失的那一格。只要每次尝试都基于新的诊断、采用不同的安全修复，它就会继续尝试。

遇到污染、`version_changed` 或 `benchmark_invalid`，或者再也没有安全的修复办法时，Optimizer 也会停止。

## 从 Web App 发起

Web App 的[评估中心](/evaluation-center)不需要手写 Prompt，就能启动同样的两个顶层 Session。它的对话框把请求预填进一个新对话，并选好对应的 Skill；你发送之前，什么都不会运行。对话框从不选择 Target Agent 的评估 Runtime。具体步骤见[评估中心](/evaluation-center)。

## Benchmark 存储

Benchmark 属于 Project，每个 Benchmark 存放在 `<root>/<project>/benchmarks/<id>/`，与 `agents/` 平级。Benchmark 与 Agent 是平级关系，谁也不隶属于谁：一个 Benchmark 可以评估多个 Agent，一个 Agent 也可以接受多个 Benchmark 的评估。因此 `benchmark_config.toml` 不记录任何 Agent，被测的 Agent 记在每一条评估上。

```text
<project>/benchmarks/<id>/
├── benchmark_config.toml       # Benchmark configuration: title, description, runs (Builder runs is fixed at 1), status
├── <case-id>/
│   ├── statement/              # the task given to the Target Agent
│   └── rubric/                 # private scoring rubric, isolated from the Target Agent
└── scoreboard.yaml             # evaluation records (current format)
```

`rubric/` 与 `statement/` 刻意分开存放：Target Agent 只拿到题干，永远拿不到评分细则。

有 `benchmark_config.toml` 的目录才算 Benchmark：`benchmarks/` 下缺少这个文件的目录不会列出。从未评估过的 Benchmark 照样有配置文件，照常列出。评估还在运行时删除 Benchmark，会留下这样一个没有配置文件的目录，因为运行中的评估还在往原来的路径里写；这种残留目录可以放心手动删除。

### Benchmark 状态

`status` 表示 Benchmark 是否已经完成：

| 状态 | 何时设置 | 在 Web App 中 |
| --- | --- | --- |
| `draft` | `benchmark-design` 还在编写题目、校准难度 | 遮罩显示：不能**使用**，也没有详情页 |
| `published` | Formal Baseline 已经记录 | 可以使用 |
| `failed` | `benchmark-design` 报告了 `calibration_failed` | 遮罩显示为创建失败，并提示删除后重新创建 |

`failed` 的 Benchmark 不能使用。手动创建的 Benchmark 和内置示例一开始就是 `published`。配置里没有这个字段，或者取值既不是 `draft` 也不是 `failed`，都按 `published` 读取。

### 评估记录

`scoreboard.yaml` 里的每条评估记录都带时间戳，并包含：

- `agent_id`：这次评估测试的 Agent。它与 `model_id`、`thinking_level` 一起组成这条记录的**标签**。趋势图以时间为横轴、分数为纵轴，每个标签画一条线，只有同一标签下的分数才可比。Agent State 的 `version` 不属于标签：同一个 Agent 在同一 Runtime 下的历次版本，正是这张图要展示的趋势，所以它们共用一条线，每个点的悬停提示里写着对应的版本。评估记录还不带 Agent 的时期写下的记录，读作未标注，归入图表的灰色系列。
- 评估 Runtime：`provider`、`model_id` 和 `thinking_level`。对于基线，用户指定的 `(provider, model_id)` 模型对优先，否则沿用 Builder Session 的模型对；优化则沿用 Reference 的 Runtime。`thinking_level` 从 Target Agent 的配置读取，不依赖 Trace 元数据。
- `summary_title` 和 `summary`：这一轮的结论和下一轮的假设。
- 由模型写入的分数、成本和耗时平均值。题目级的值是各次运行的平均，评估级的值是各道题目的平均。单次运行的成本保留记录时的精度。成本平均值忽略 `null`，只有所有参与计算的成本都未知时才为 `null`。分数保留两位小数，成本平均值保留六位小数，`duration_ms` 为整数。
- 每道题目的逐次运行明细：每次运行记录 `score`、`cost`、`duration_ms` 和 `session_id`。

每次运行和每道题目都以 100 分为满分，所以记分板条目不带 `max_score`。服务端和 Web App 直接信任已存储的平均值，既不重算，也不交叉核对。旧格式的记分板不迁移，也不回填。

### 示例 Benchmark

初始化 Project 的 `default_agent` 时，会在 Project 层级预置一个示例 Benchmark（`packages/core/src/state/example-benchmark.ts`）。它的三条示例评估都标注为 `agent_id: default_agent`，所以评估页面开箱就有数据。整个目录随时可以删除或替换。

判断只看示例自己的目录 `benchmarks/example-benchmark/`：只要它不存在，初始化或加载 `default_agent` 时就会写入示例，不管 `benchmarks/` 里已经有什么，也不管旧的数据根在已退役的按 Agent 存放位置 `agents/<agent>/benchmarks/` 下还留着什么（没有任何代码读取那里）。已经存在的示例一概不动，删掉的示例会在下次加载时回来。

## 快照与版本

`system_config.yaml` 里的 `version` 字段是 Agent State 的版本号，每采纳一次优化，版本号就会增加。

Optimizer 改动 Reference State 之前，会先确保 Reference 版本对应的 `<agent>/snapshots/v<version>.tar.gz` 存在。已有快照就直接复用；没有就把 `agent_state/` 打包成一个，打包时排除 Vault（`.vault.toml`），密钥永远不会进入快照。它从不覆盖同一版本已有的快照；如果创建不了快照，就在改动任何东西之前停下。落选的 Candidate 在同一轮内回滚：Optimizer 恢复原来的文件和版本号，并删除 Candidate 新建的文件。

在 Web App 中，Agent 的设置页向所有成员提供**导出快照**，向 Project owner 提供**导入快照**。导入会整体替换 Agent State，版本号取包内的 `version`，并保留当前的 Vault；导入之前会先为当前版本打一个快照。导入的版本不比当前版本新时，需要先确认。智能体页面的创建对话框也可以直接用导出的快照包新建 Agent（**从快照初始化**）：新 Agent 以包内的状态和版本起步，无需确认。

## 可审计性

- 每次 Evaluator 运行和每个被测会话，都是带完整 Trace 的普通 Session。
- 记分板记录通过 `session_id` 关联到对应的被测会话，见 [Session 与 Trace](/sessions-and-traces)。
- Web App 的评估页面是这些文件的只读视图。趋势图只显示分数；评估明细表把被测 Agent、模型 ID 和推理强度分列显示。见[评估中心](/evaluation-center)。

每一个分数都能追溯到产生它的那次运行。

## 相关 Skill

| Skill | 用途 |
| --- | --- |
| `agent-supervision` | 为委派任务创建监管伴生者，及时告警并执行有界恢复 |
| `agent-initialization` | 把需求变成可用的 Agent：编写它的 `AGENTS.md`，安装它需要的 Skill |
| `benchmark-design` | 设计并校准包含多道题目的能力 Benchmark |
| `benchmark-reproduction` | 复现已有 benchmark，先冒烟验证，再询问全量评估 |
| `agent-evaluation` | 隔离地运行一道 Benchmark 题目一次，并为这次运行打分 |
| `agent-optimization` | 根据 Benchmark 的结果改进 Agent |

Skill 如何组织和安装，见[技能与插件](/skills)。
