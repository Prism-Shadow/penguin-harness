---
title: 自我进化
description: Skill 如何构建 Benchmark、给 Agent 打分，并只保留让分数提高的改动；每个版本都有快照，每个分数都能追溯。另有运行其他自进化算法的 RSI 工具包。
---

PenguinHarness 的自我进化是一个循环：为 Agent 构建 Benchmark，在上面给 Agent 打分，修改 Agent，只有分数严格提升才保留改动。这个循环不额外引入任何运行机制，而是由 Skill 编排普通的 Agent 机制：评估是普通的 Session，优化是普通的文件编辑，每个结果都是 Project 里的文件。

构建 Benchmark 和优化 Agent 分别在两个独立的顶层 Session 中运行，每一次单独的评估则通过内置的 `run_subagent` 工具委派出去。顶层 Prompt 提供这次任务的设定：Agent、Benchmark、要考察的能力、分数和轮数。其余一切都由 Skill 负责：调用关系、校准、Freeze、结果协议、修复、回滚和汇报。

这个循环就是 Default RSI Toolkit；其他自进化算法见 [RSI 工具包](#rsi-工具包)。

## 角色

| 角色 | Skill | 运行方式 | 职责 |
| --- | --- | --- | --- |
| Builder | 先 `agent-initialization`，后 `benchmark-design` | 一个顶层 Session | 搭建 Agent，然后编写并校准一个包含多道题目的 Benchmark，记录基线 |
| Target Agent | — | 每次运行一个全新的顶层 Session | 被评估或被优化的 Agent，只在自己隔离的 Workspace 里工作 |
| Evaluator | `agent-evaluation` | 通过 `run_subagent` 创建的叶子子 Agent | 让 Target Agent 在一道题目上运行一次，并为这次运行打分 |
| Optimizer | `agent-optimization` | 另一个独立的顶层 Session | 按可证伪的假设修改 Target Agent，分数严格提升才保留新版本 |

没有为这些角色专门预留的内置 Agent：每个角色就是一个 Skill，四个 Skill 都随 `rsi-default` 插件（Default RSI Toolkit）提供。在 Web App 界面里，Target Agent 叫作**被测智能体**。

### 角色之间的调用

1. Builder 或 Optimizer 通过 `run_subagent` 并行下发完整的 Case × runs 矩阵：矩阵中的每一格对应一个 Evaluator，并要求它使用 `agent-evaluation`。
2. 每个 Evaluator 用 Penguin CLI 启动一次 Target Agent：开一个全新的顶层 Session，在 Target Agent 的 `workspaces/` 目录下建一个专属 Workspace，并以绝对路径传入。`penguin run` 创建的每个 Session 都是 CLI 会话，所以每个被测会话都会归入 Web App 会话列表的**后台会话**折叠夹并标为 CLI，不会混进这个 Agent 的活跃对话。Evaluator 自己的 Session 是普通的子 Agent Session，同样在这个折叠夹里。
3. Target Agent 运行结束后，Evaluator 按评分细则为这次运行打分，返回一条协议结果：分数、成本、耗时和被测会话 id。Evaluator 不改动任何 Agent 或 Benchmark，也从不写 `scoreboard.yaml`。
4. 调用方核对完整的矩阵后写入 `scoreboard.yaml`。

两种调用方都会先确认 Evaluator 的完整响应是纯协议 YAML，然后才读取其中的状态或分数。格式不合规时，由同一个 Evaluator 基于已有结果重发，不重新运行 Target Agent。

## 信息隔离

被测的 Agent 看不到评分方式，分数才有意义。因此每个角色读取的是 Benchmark 的不同部分：

| 角色 | 读取 | 不读取 |
| --- | --- | --- |
| Target Agent | 全新 Workspace 里题目 `statement/` 的副本，以及自己的 Agent State | 评分细则：它从不进入这个 Workspace，路径也不会告诉 Target Agent |
| Evaluator | 题干、评分细则、Target Agent 的 State，以及本次运行的 Workspace 和 Trace | 其他 Agent、Project 的密钥、无关的 Workspace 或 Trace |
| Optimizer | 公开的题干、记分板、与分数关联的被测 Trace，以及 Target Agent 的 State | 评分细则、Gold（标准答案）、私有评分条件、Evaluator 的 State、Workspace 或 Trace、其他 Agent，以及 Project 的密钥 |
| Builder | 整个 Benchmark（包括它自己写的评分细则）、Target Agent 的 State，以及被测 Trace | Evaluator 的 State、Workspace 或 Trace、其他 Agent，以及 Project 的密钥 |

Evaluator 返回的结果里不含评分细则的内容、Gold、逐项得分和评分理由。新增或修改的题目下发之前，Builder 先做泄题检查：任何公开文件都不得泄露 Gold、私有评分条件，或能指向预期解法的提示。一旦私有的评估信息进入 Optimizer 的上下文，Optimizer 就回滚正在测试的 Candidate，并以「污染」为由停止。

> [!WARNING]
> 信息隔离靠的是 Skill 指令和可审计的 Trace，不是沙箱。这里没有文件系统沙箱、文件权限或工具限制来阻止 Agent 读取评分细则：Target Agent 以 `--approve allow-all` 运行，只是它的 Workspace 里没有评分细则；其他角色能读什么，则由 Skill 规定。Agent 的每一次工具调用都记在它的 Trace 里，违规事后可以查出来。Project 成员也能在 Web App 里查看所有评分细则。

## 构建 Benchmark

第一个顶层 Session 负责创建 Agent 和它的能力评估。Builder 先执行 `agent-initialization`，再执行 `benchmark-design`，拿到的输入是 Target Agent、要考察的能力、期望的基线分数和 Pilot 迭代上限。

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

## RSI 工具包

RSI（Recursive Self-Improvement，递归自我进化）正是本页讲的事：模型固定不动，Agent 依据自己实测的结果改进自己的 Harness——提示词、Skill、工具与钩子。每一种自进化算法都以一个 **RSI 工具包**发布，也就是插件库 **Agent 自进化**分类里的一个插件。上文的循环就是 **Default RSI Toolkit**（`rsi-default`）；另外四个工具包各按原论文的流程运行一种已发表的算法，各带一个与插件同名的 Skill：

- **OPRO**（`rsi-opro`），出自 [Large Language Models as Optimizers](https://arxiv.org/abs/2309.03409)（Yang 等，2023）：优化器依据历史指令与分数提出新指令，每个候选都在冻结的 Benchmark 上测量，保留得分最高的指令。
- **APE**（`rsi-ape`），出自 [Large Language Models are Human-Level Prompt Engineers](https://arxiv.org/abs/2211.01910)（Zhou 等，2022）：不迭代、一次完成，提议者从输入 / 输出示例归纳候选指令，每个候选都测量一遍，保留最优者。
- **ACE**（`rsi-ace`），出自 [Agentic Context Engineering](https://arxiv.org/abs/2510.04618)（Zhang 等，2025），采用其顺序离线算法：Reflector 逐条阅读训练 Trace，Curator 把教训并入 Agent 每次任务前都会读的规则手册（playbook），最终的手册在冻结的 Benchmark 上测量。
- **AWM**（`rsi-awm`），出自 [Agent Workflow Memory](https://arxiv.org/abs/2409.07429)（Wang 等，2024）：从成功轨迹归纳工作流并存入 Agent 的记忆，可以在线（训练流）或离线（给定经验）进行，冻结后在 Benchmark 上测试。

OPRO 与 APE 各自带一个小型演示任务：只要提出来，Skill 会先新建一个 Agent 和一套 6 题的 Benchmark 再开始。每个 Skill 都写明论文的默认参数和一档更小的冒烟预算；除非你要求，它从不按论文的完整预算运行。

工具包之间互不依赖，也不依赖 `rsi-default`，任何一个单独安装即可运行。每个工具包都在被测 Agent 里自行初始化学习槽：一个 Agent 自有的 Skill，存放方法学到的内容（指令、规则手册或工作流），再在它的 `AGENTS.md` 里加一行固定指令，要求它开始任务前先读这个 Skill。方法的循环只改这个 Skill 存放的内容。每一次测量都经由工具包自带的 `references/evaluation.md` 进行：它与 `agent-evaluation` 采用同一套单格协议（每个 Case × run 经 `run_subagent` 派生一个子 Agent，返回纯协议 YAML），写入同样的记分板记录。四个算法工具包里的这份文件逐字节相同。内置 Benchmark 的题目按题干的 **How this case is run** 一节运行，与 `agent-evaluation` 一致。

工具包测量的每个候选都取一个新的 Agent State `version`。与默认循环相同，每个版本在被改动之前先打快照；运行结束时停在方法选定的版本上。这些评估照常写入 `scoreboard.yaml`，标签规则不变，因此同一个 Agent 在同一模型与思考等级下的默认循环与 OPRO 共用图表上的一条线：各点的版本号区分它们，每条评估的摘要标题写明所用的方法。在 Web App 中，用评估中心**优化**标签页的**方法**字段选择工具包，见[评估中心](/evaluation-center#优化-agent)。

## 复现的 Benchmark

复现一个已发表的 benchmark 不是工具包的事。复现的 Benchmark 是公开仓库 [penguin-harness-benchmark](https://github.com/Prism-Shadow/penguin-harness-benchmark) 中 `packages/<id>/` 下的一个包，经导入进入 Project：让 Agent 导入这个包的文件夹，副本会记下它来自哪个提交（来源为 `git`，见[清单](#清单)）。运行它的特殊流程写在 Benchmark 自身，即各题题干的 **How this case is run** 一节和仓库的 README，从不写进插件或 Skill，因此每个 RSI 工具包都以同样的方式运行它。五个内置 Benchmark 就是这样的复现，随每个新 Project 一起写入。

## 从 Web App 发起

Web App 的[评估中心](/evaluation-center)不需要手写 Prompt，就能启动同样的两个顶层 Session。它的对话框把请求预填进一个新对话，并选好对应的 Skill；你发送之前，什么都不会运行。对话框从不选择 Target Agent 的评估 Runtime。具体步骤见[评估中心](/evaluation-center)。

## Benchmark 存储

Benchmark 属于 Project，每个 Benchmark 存放在 `<root>/<project>/benchmarks/<id>/`，与 `agents/` 平级。Benchmark 与 Agent 是平级关系，谁也不隶属于谁：一个 Benchmark 可以评估多个 Agent，一个 Agent 也可以接受多个 Benchmark 的评估。因此 `benchmark_config.toml` 不记录任何 Agent，被测的 Agent 记在每一条评估上。

```text
<project>/benchmarks/<id>/
├── benchmark_config.toml       # the manifest: id, title, description, version, status, runs (Builder runs is fixed at 1), [origin]
├── <case-id>/
│   ├── statement/              # the task given to the Target Agent
│   └── rubric/                 # private scoring rubric, isolated from the Target Agent
└── scoreboard.yaml             # evaluation records (current format)
```

`rubric/` 与 `statement/` 刻意分开存放：Target Agent 只拿到题干，永远拿不到评分细则。

有 `benchmark_config.toml` 的目录才算 Benchmark：`benchmarks/` 下缺少这个文件的目录不会列出。从未评估过的 Benchmark 照样有清单，照常列出。评估还在运行时删除 Benchmark，会留下这样一个没有清单的目录，因为运行中的评估还在往原来的路径里写；这种残留目录可以放心手动删除。

### 清单

`benchmark_config.toml` 描述一个 Benchmark，就像 `plugin.json` 描述一个插件：

```toml
id = "report-writing-v1"
title = "Report writing"
description = "Hard cases for the report writer"
version = "2026.10.09.1"
status = "published"
runs = 1

[origin]
kind = "agent"
```

| 键 | 取值 |
| --- | --- |
| `id` | 目录名。`id` 与所在目录不符的清单不会被读取 |
| `title`、`description` | 标题（缺省时以目录名代替）和可选的描述；由服务端写入时分别不超过 200 和 2,000 个字符 |
| `version` | 日期版本 `"YYYY.MM.DD.N"` |
| `status` | `draft`、`published` 或 `failed`，见 [Benchmark 状态](#benchmark-状态) |
| `runs` | 每题运行次数，正整数，缺省为 1；由服务端写入时不超过 1,000 |
| `[origin]` | 这份副本的来源，记在 `kind` 里：`builtin`（随 Project 预置）、`manual`（手动创建表单）、`agent`（由 `benchmark-design` 写入）、`git`（Agent 从仓库文件夹导入：带 `url`、解析到的 40 位提交 `ref`、`path` 与 `imported_at`）或 `zip`（上传的包：带 `imported_at`） |

`id`、`version` 与 `[origin]` 是本版本新增的键，读取时都可以省略。早先版本写下的清单一个都没有，照原样读取：以目录名为 id，没有版本，也没有来源。没有任何东西改写它，也不需要手动处理。`id`、`version` 或 `[origin]` 出现了却不合规，清单就读不了（见 [Benchmark 状态](#benchmark-状态)）。早先版本读到本版本写下的清单时，会忽略它不认识的键。

凡是 Agent 可能在本地改动的东西都带日期版本，Skill 与 Benchmark 都是如此。新的 Benchmark 从当天的 `.1` 开始，同一天的下一次修订取下一个序号；`benchmark-design` 每次改题或改 `status` 都会递增版本。Benchmark 页面在目录路径旁显示它的版本。

Benchmark 的**包**是 `benchmark_config.toml` 加上各题目录。`scoreboard.yaml`、`.jobs/` 下的 trial、其他以点开头的条目和符号链接都属于这块磁盘上的副本，永远不属于包。原始大文件同样不进包：题干以固定提交的仓库链接引用它们，内置 Benchmark 的题干就是这样写的。五个内置 Benchmark 另以同一格式发布在公开仓库 Prism-Shadow/penguin-harness-benchmark 的 `packages/` 下。

### Benchmark 状态

`status` 表示 Benchmark 是否已经完成：

| 状态 | 何时设置 | 在 Web App 中 |
| --- | --- | --- |
| `draft` | `benchmark-design` 还在编写题目、校准难度 | 遮罩显示：不能**使用**，也没有详情页 |
| `published` | Formal Baseline 已经记录 | 可以使用 |
| `failed` | `benchmark-design` 报告了 `calibration_failed` | 遮罩显示为创建失败，并提示删除后重新创建 |

`failed` 的 Benchmark 不能使用。手动创建的 Benchmark、内置示例和内置 Benchmark 一开始就是 `published`。清单里没有这个键，或者取值既不是 `draft` 也不是 `failed`，都按 `published` 读取。清单不可用（不是合法的 TOML、`id` 与所在目录不符，或 `version`、`[origin]` 不合规）的 Benchmark 仍以目录名列出，按 `failed` 处理：评估中心把它遮罩并说明原因，修好文件之前不能使用。

### 评估记录

`scoreboard.yaml` 里的每条评估记录都带时间戳，并包含：

- `agent_id`：这次评估测试的 Agent。它与 `model_id`、`thinking_level` 一起组成这条记录的**标签**。趋势图以时间为横轴、分数为纵轴，每个标签画一条线，只有同一标签下的分数才可比。Agent State 的 `version` 不属于标签：同一个 Agent 在同一 Runtime 下的历次版本，正是这张图要展示的趋势，所以它们共用一条线，每个点的悬停提示里写着对应的版本。评估记录还不带 Agent 的时期写下的记录，读作未标注，归入图表的灰色系列。
- 评估 Runtime：`provider`、`model_id` 和 `thinking_level`。对于基线，用户指定的 `(provider, model_id)` 模型对优先，否则沿用 Builder Session 的模型对；评估中心**评估**标签页发起的评估同样沿用其评估会话的模型对；优化则沿用 Reference 的 Runtime。`thinking_level` 从 Target Agent 的配置读取，不依赖 Trace 元数据。
- `summary_title` 和 `summary`：这一轮的结论和下一轮的假设。
- 由模型写入的分数、成本和耗时平均值。题目级的值是各次运行的平均，评估级的值是各道题目的平均。单次运行的成本保留记录时的精度。成本平均值忽略 `null`，只有所有参与计算的成本都未知时才为 `null`。分数保留两位小数，成本平均值保留六位小数，`duration_ms` 为整数。
- 每道题目的逐次运行明细：每次运行记录 `score`、`cost`、`duration_ms` 和 `session_id`。

每次运行和每道题目都以 100 分为满分，所以记分板条目不带 `max_score`。服务端和 Web App 直接信任已存储的平均值，既不重算，也不交叉核对。旧格式的记分板不迁移，也不回填。

### 示例 Benchmark

创建 Project 时，会在 Project 层级预置一个示例 Benchmark（`packages/core/src/state/example-benchmark.ts`）。它的三条示例评估都标注为 `agent_id: default_agent`，所以评估页面开箱就有数据。整个目录随时可以删除或替换。

示例与五个内置 Benchmark 只在 Project 创建时写入一次（`packages/core/src/state/project-benchmarks.ts`）：服务端创建 Project 时写入，`default_project` 则在全新安装首次启动时写入。每个都先写进 `benchmarks/.seeding/` 下的临时目录，再改名就位；写入失败即 Project 创建失败，并整体回滚。目录已存在的 id 直接跳过、从不往里写，因此服务端沿用已有数据根里的 `default_project` 时，它自己的 Benchmark 原样保留，只补上缺少的。此后不再写入：初始化或加载 `default_agent` 都不碰 `benchmarks/`，删掉的不会再出现。早先版本的 Project 保持原样：不会得到内置 Benchmark，示例在的仍在，删掉的也不会回来。

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

| Skill | 插件 | 用途 |
| --- | --- | --- |
| `agent-initialization` | `rsi-default` | 把需求变成可用的 Agent：编写它的 `AGENTS.md`，安装它需要的 Skill |
| `benchmark-design` | `rsi-default` | 设计并校准包含多道题目的能力 Benchmark |
| `agent-evaluation` | `rsi-default` | 隔离地运行一道 Benchmark 题目一次，并为这次运行打分 |
| `agent-optimization` | `rsi-default` | 根据 Benchmark 的结果改进 Agent |
| `rsi-opro` | `rsi-opro` | 运行 OPRO：依据历史分数优化指令 |
| `rsi-ape` | `rsi-ape` | 运行 APE：从输入 / 输出示例归纳指令 |
| `rsi-ace` | `rsi-ace` | 运行 ACE：从训练 Trace 进化规则手册 |
| `rsi-awm` | `rsi-awm` | 运行 AWM：从成功轨迹归纳工作流 |

Skill 如何组织和安装，见[技能与插件](/skills)。
