---
title: 评估中心
description: 在 Web App 中创建 Benchmark、给 Agent 打分，并根据分数改进 Agent。
---

评估中心是 Web App 里衡量和改进 Agent 的地方。**Benchmark** 是一组题目，每道题包含任务题干和一份私有的评分细则。Benchmark 属于 Project，不属于某个 Agent，所以它可以给 Project 里的任何 Agent 打分。

- 要创建 Benchmark，见[让 AI 创建 Benchmark](#让-ai-创建-benchmark) 或[手动创建 Benchmark](#手动创建-benchmark)。
- 要查看题目、分数曲线和历次评估，见[查看 Benchmark](#查看-benchmark)。
- 要给 Agent 打分，见[评估 Agent](#评估-agent)。
- 要根据分数改进 Agent，见[优化 Agent](#优化-agent)。
- 要换一批题目或清理 Benchmark，见[替换 Benchmark](#替换-benchmark) 和[删除 Benchmark](#删除-benchmark)。

这些页面背后的评估与优化机制，见[自我进化](/self-improvement)。

## 打开评估中心

在侧边栏中选择**评估中心**。这个页面（`/benchmark`）以卡片形式列出当前 Project 的所有 Benchmark。

标题下方有三张带编号的步骤卡片，概括了整个循环：**出题**、**评估**和**优化**。每张卡片都写明在哪里做这一步：用右上角的创建按钮，或者在某个 Benchmark 上点**使用**，再选对应的标签页；**优化**卡片还提示可以换一种自进化算法。owner 有**用 AI 创建**和**手动创建**两个按钮；成员只有**用 AI 创建**，第一张卡片也只写这一个。

每张 Benchmark 卡片显示：

- 标题、目录名和描述；
- 题目数量和每题运行次数；
- 最近一次评估的时间，以及测过的 Agent；
- 分数走势小图，以及最新分数和它相对同一[标签](#分数曲线)下上一次评估的变化。

卡片上的操作有**使用**、**查看**，Project owner 还能看到一个删除图标。直接点卡片和点**查看**效果相同。

要缩小列表范围，在搜索框里输入即可，搜索匹配标题、描述和被测智能体。访问 `/benchmark?agentId=<agent>` 只列出评估过这个 Agent 的 Benchmark；点**显示全部**可以重新看到所有 Benchmark。

### 尚未就绪的 Benchmark

未完成的 Benchmark 显示为遮罩状态：卡片变暗并盖上一条提示，**使用**和**查看**不可用，它的页面也在题目和曲线的位置显示同样的提示。只有 owner 的删除图标仍然可用。

- **构建中**：AI 还在出题并校准难度，完成后即可打开这个 Benchmark。
- **创建失败**：难度校准没有完成。由 owner 删除这个 Benchmark 再重新创建；成员只会看到校准没有完成，因为删除是 owner 的操作。

### 示例 Benchmark

每个 Project 都自带 `example-benchmark`，其中的示例评估测的是 `default_agent`，所以页面一开始就有数据。它在 Project 创建时写入：删掉之后就不会再出现。

### 内置 Benchmark

新建的 Project 还自带五个取自公开评测集的 Benchmark，即 **PenguinHarness Benchmark Sec A** 到 **Sec E**，每个都是挑选出的、能在纯 CPU 的 Docker 环境里运行的子集。各自的描述里写明了原始评测集：

| Benchmark | 原始评测集：衡量什么 |
| --- | --- |
| `penguinharness-benchmark-sec-a` | rag-bench-essential（Data Analysis Bench）：基于报告、表格、文档库、调查微观数据与 SQL 数据库的数据分析 |
| `penguinharness-benchmark-sec-b` | DeepSWE v1.1：在真实开源仓库里实现功能、修复缺陷 |
| `penguinharness-benchmark-sec-c` | AutomationBench：跨模拟 SaaS 应用的业务流程 |
| `penguinharness-benchmark-sec-d` | Terminal-Bench-Science 0.1：研究级的科学计算 |
| `penguinharness-benchmark-sec-e` | Terminal-Bench 4.0：在终端里完成的高难度真实任务 |

每道题都以 [Harbor](https://github.com/harbor-framework/harbor) 任务的形式在 Docker 里运行。任务文件不在 PenguinHarness 里，而是放在公开仓库 [Prism-Shadow/penguin-harness-benchmark](https://github.com/Prism-Shadow/penguin-harness-benchmark)，运行它们的规则也写在那里。题干写着任务的简述和任务文件夹在该仓库固定提交下的链接，其中的 **How this case is run** 一节链接这些规则，并给出启动任务的命令。分数由任务自己的验证器决定：通过得 100 分，未通过得 0 分。

**评估之前**

- 执行评估的 Agent 所在机器装有 Docker（含 Compose v2）和 [uv](https://docs.astral.sh/uv/)，并能访问 GitHub、Docker Hub、nodejs.org、npm 仓库和模型服务。
- 评估所用的模型，即评估会话的模型，已在**模型库**页面保存了 API key。评估会把这一条模型配置复制进每个任务容器，不需要 Vault。
- 执行评估的 Agent 的 `agent-evaluation` Skill 为 2026.10.09.1 或更新版本。它随 `rsi-default` 提供，该插件在 2026.10.09.3 及更早的版本中名为 `agent-tuning`。在此之前创建的 Agent 保留着旧副本，需要在**插件市场**页面更新这个插件。

它们和其他 Benchmark 一样评估，见[评估 Agent](#评估-agent)。执行评估的 Agent 的 `agent-evaluation` Skill 从题干认出这类题，并按仓库里的规则运行：评估先按题干给出的提交取一次仓库，再为每道题的每次运行跑一次 Harbor trial，同时至多四个，因为每个 trial 都要占用主机上数量有限的 Docker 网络。被测 Agent 带着自己的 Agent State 在任务容器里运行，一次 trial 从几分钟到一小时左右不等（含镜像构建）。每次 trial 的文件，包括 Agent 的 Trace 和验证器的输出，都留在该 Benchmark 的 `.jobs/` 目录下；这次运行记在 Session id `harbor:<trial 名>` 名下，评估详情弹窗里可以复制它。

跑一次大约花多少钱、PenguinHarness 在这些题上得分如何（三次尝试的准确率、成本、Token 数与耗时），见仓库里的 [results/v0.2.13](https://github.com/Prism-Shadow/penguin-harness-benchmark/blob/main/results/v0.2.13/README.md)。这几套题按那里实测所用的模型校准过难度，所以分数只描述这 50 道题，不代表上游完整评测集上的水平。

它们自带的评估记录为空。它们和示例一样，只在 Project 创建时写入，此后不再写入：删掉的不会再出现。升级前就已存在的 Project 不会因为升级而得到它们；之后新建的 Project 都有。

## 让 AI 创建 Benchmark

AI 为一个 Agent 出题，逐题试测来校准难度，并记录这个 Agent 的第一个分数，也就是基线分。

1. 在评估中心右上角，选择**用 AI 创建**。
2. 在**让 AI 创建 Benchmark** 对话框中，选择**被测智能体**，也就是这套题要考的 Agent。分数会记在它名下。
3. 描述要考察的能力和场景，或者从**试试这些示例**里选一个作为起点。
4. 选择**在新对话中编辑**。提示词会填进一个新对话的输入框，并已选好 `benchmark-design` 和 `agent-evaluation` 两个 Skill。
5. 检查提示词，然后发送。发送之前什么都不会运行。

对话框里「将由『…』在新对话中完成」这一行写明了实际出题的 Agent：Project 的默认 Agent，而不是被测智能体。

Builder 试测题目和记录基线分时，都用这个新对话的模型来运行被测智能体。之后在**评估**标签页发起的评估也一样，用的是评估会话自己的模型，而图表会为每个模型单独画一条线。想让之后的分数和基线分落在同一条线上，就用基线所用的模型来评估。

出题期间，这个 Benchmark 的卡片显示**构建中**。记录好基线分后，Benchmark 即可打开。校准失败时，卡片显示**创建失败**，由 owner 删除这个 Benchmark 再重新创建。

## 手动创建 Benchmark

**开始之前**

- 只有 Project owner 能手动创建 Benchmark。

1. 在评估中心右上角，选择**手动创建**。
2. 在**手动创建 Benchmark** 表单中，填写**标题**、**Benchmark id** 和**描述**。id 也是目录名，只能包含字母、数字、`_` 和 `-`。它不会随标题自动变化；点输入框旁边的**用 AI 生成**，可以从标题生成一个 kebab-case 的 id。
3. 设置**每题运行次数**，取 1 到 1000 之间的整数。评估和优化默认把每道题运行这么多次，再取平均。
4. 为每道题填写**目录名后缀**、**题目标题**、**题干**和**评分细则**。题干交给被测的 Agent；评分细则列出可观察的评分项，合计 100 分，永远不会交给被测的 Agent。点**添加题目**可以再加一道题。
5. 选择**创建 Benchmark**。这个 Benchmark 的页面随即打开。

手动创建时不用选择所属的 Agent。手动创建的 Benchmark 立即发布，但还没有基线分，所以优化之前，先用它[评估 Agent](#评估-agent)。

## 查看 Benchmark

点 Benchmark 卡片或**查看**，打开这个 Benchmark 的页面（`/benchmark/<benchmark>`）。**返回列表**回到列表页。

页头在标题旁边写出 Benchmark 的目录 `benchmarks/<benchmark>`，附带**复制目录路径**按钮；清单带版本时还写出 Benchmark 的版本（例如 `v2026.10.09.1`），另有它自己的**使用**按钮。Agent 从仓库文件夹导入的 Benchmark 另在**来源**处链接那个文件夹。

### 题目

**题目**区域列出这个 Benchmark 的所有题目。点某道题的**查看详情**即可打开它。

题目对话框用和插件详情相同的文件浏览器展示题目文件：左侧是逐级展开的文件树，右侧是只读预览。文件树有两个顶层文件夹：

- **任务材料**：被测的 Agent 据此作答。
- **评分标准**：评估方据此打分。这个文件夹标注着**被测 Agent 不可见**。

### 分数曲线

**分数随时间变化**图表按时间画出每次评估的分数，每个**标签**一条线。标签由被测 Agent、模型 ID 和思考等级组成，所以只有可比的分数才会落在同一条线上。没有标签的记录归入灰色的**未标注**系列。

标签刻意不包含 Agent State 版本：同一个 Agent 在相同模型和思考等级下的历次版本会留在同一条线上，改进正应该在这条线上显现出来。把鼠标悬停在某个点上，可以看到它测的是哪个版本。

### 评估明细

**评估明细**表按从新到旧的顺序列出这个 Benchmark 的评估，列依次是**时间**、**被测 Agent**、**版本**、**模型 ID**、**推理强度**、**分数**、**成本**和**耗时**。还没有评估的 Benchmark 会显示**暂无评估记录**。

点一行，就在对话框里打开这次评估。对话框显示：

- 标签，以及被测 Agent 和它的版本；
- 分数、成本和耗时；
- 这次评估的说明，标题和正文分开展示；
- 逐题表，每行可以展开，查看每次运行的原始结果及其所在的 Session。

在这张表里点一道题，题目对话框会叠在上面打开。

## 就题目或评估问 AI

题目对话框和评估对话框的底部都有**问 AI**。点开是一个提示词对话框，问题已经填好，还可以换成其他示例问题。默认问题就是第一个示例，试过别的问题后可以随时换回来。

题目对话框中的示例：

- **解释这道题考什么、怎样才算答好**（默认）
- **评分细则在奖励什么？**
- **为什么有的运行在这道题上分数低？**
- **题干怎样才能更清楚？**

评估对话框中的示例：

- **解释这次评估的结果**（默认）
- **为什么这次分数低？**
- **哪些题最弱、该改什么？**
- **与上一次评估相比变化在哪？**

提示词末尾有一段固定内容，把屏幕上的事实一并交给 Agent：

- 对于题目：`statement/README.md` 和 `rubric/README.md` 的路径，以及最近一次评估里各次运行在这道题上的分数。
- 对于评估：Benchmark id 和目录、评估时间、标签、版本、评估 Runtime、总分和逐题结果、每次运行的 Session id，以及评估说明。

提示词要求 Agent 读这些文件和 Trace，解释它的发现。Agent 只读取和分析，既不改 Benchmark，也不改被测的 Agent。选择**在新对话中编辑**，然后发送提示词。

## 评估 Agent

评估让一个 Agent 跑完 Benchmark 的每道题，并在这个 Benchmark 的记分板上新增一条带标签的分数。

1. 在 Benchmark 卡片或 Benchmark 页面的页头上，选择**使用**。对话框默认打开**评估**标签页。
2. 在**被测智能体**中，选择要评估的 Agent，默认是最近一次评估所测的 Agent。
3. 在**执行评估的智能体**中，选择负责运行和打分的 Agent。它需要装有 `agent-evaluation` Skill，没装时对话框会提醒你。
4. 可选：修改**评估会话使用的模型**（预设为 Project 的默认模型）或**每题运行次数**（预设为 Benchmark 配置的次数），并填写**说明**。
5. 选择**在新对话中编辑**，检查提示词，然后发送。

被测 Agent 在评估会话的模型上运行：就是**评估会话使用的模型**里选的那个，发送前在输入框里换了模型则以换后的为准。它的思考等级沿用自己的配置，对话框不会改动。

评估会话是你的一段普通对话；它启动的每个被测会话都是 CLI 会话，归入会话列表的**后台会话**折叠夹。评估完成后，会成为这个 Benchmark **评估明细**表的最新一行。

## 优化 Agent

优化用一种自进化算法（**方法**）改进 Agent。默认方法每次按一个假设改动 Agent，分数严格提高才保留新版本，比较的起点是这个 Agent 在当前 Benchmark 上的基线分。其他方法各自运行同名的 RSI 工具包，见 [RSI 工具包](/self-improvement#rsi-工具包)。

**开始之前**

- 使用默认方法时，这个 Agent 在当前 Benchmark 上已有一次完整的评估。用 AI 创建的 Benchmark 已经为它的被测智能体测过一次；其他情况下，先[评估这个 Agent](#评估-agent)。其他方法会自己先测出 Agent 的起点分数。

1. 在 Benchmark 卡片或 Benchmark 页面的页头上，选择**使用**，再切到**优化**标签页。
2. 在**方法**中选择 **Default（试跑 → 反思 → 提升）**、**OPRO**、**APE**、**ACE** 或 **AWM**。字段下方的提示说明所选方法做什么。
3. 在**被测智能体**中，选择要改进的 Agent。标签页上会显示它当前的基线分和目标分数。
4. 在**执行优化的智能体**中，选择实际执行优化的 Agent。它需要装有该方法的 Skill：Default 为 `agent-optimization`，其他方法为与其插件同名的 Skill（`rsi-opro`、`rsi-ape`、`rsi-ace` 或 `rsi-awm`）。没装时对话框会提醒你。
5. 设置**每题运行次数**。使用 Default 时，还要设置**最多轮数**（默认 3）和**目标分数**；目标分数默认是基线分向上取整后加 10，最高 100。
6. 可选：修改**优化会话使用的模型**（预设为 Project 的默认模型），并填写**优化重点**。
7. 选择**在新对话中编辑**，检查提示词，然后发送。

使用 Default 时，达到目标分数优化会提前结束，否则在跑满最多轮数后结束。优化过程中的评估沿用基线记录的模型和思考等级。每个采纳的版本都会在同一条曲线上添一个点，版本号显示在**版本**列和这个点的悬停提示里。

使用其他方法时，**最多轮数**和**目标分数**会隐藏：预算由方法自定，即论文的默认值降为冒烟档，除非**优化重点**另有要求。提示词把被测智能体、Benchmark 和每题运行次数交给该方法的 Skill，要求它按原论文的流程运行、固定被测智能体的 Runtime、经工具包自带的评测参考测量，并把每条完整评估以同一标签记入记分板。

> [!WARNING]
> 被测的 Agent 在这个 Benchmark 上还没有基线分时，标签页会提示你先到**评估**标签页取得基线分，目标分数也默认为 80。这时仍然可以发送，但使用默认方法时 `agent-optimization` Skill 会停下来，说明它需要基线分。

## 替换 Benchmark

Benchmark 一经创建，题目就冻结了。Web App 和服务端接口都不能修改题干或评分细则：题目一改，记分板上已有的分数就不再可比。AI 出题过程中的难度校准发生在取得基线分之前，属于创建的一部分。

想换一批题目，就新建一个 Benchmark，再删掉旧的：

1. 打开一道题，选择**问 AI**，选**题干怎样才能更清楚？**，然后发送。
2. 选择**用 AI 创建**，描述旧的 Benchmark 以及建议的修改。
3. 新 Benchmark 发布后，[删除旧的那个](#删除-benchmark)。

## 删除 Benchmark

只有 Project owner 能删除 Benchmark，而且只能在列表中它的卡片上删除，Benchmark 页面上没有删除入口。

1. 在 Benchmark 卡片上，选择删除图标（**删除 Benchmark**）。
2. 阅读确认提示：它的全部题目和评估记录都将删除，无法恢复。
3. 选择**删除**。

> [!NOTE]
> 删掉 `example-benchmark` 或[内置 Benchmark](#内置-benchmark) 同样是最终的：它们只在 Project 创建时写入，此后不再写入。

## 工作原理

- **存储。** Benchmark 就是 Project 里与 `agents/` 平级的 `benchmarks/<benchmark>/` 目录，以 Benchmark id 命名。它的清单是 `benchmark_config.toml`，其中还记有日期版本和这份副本的来源（早先版本建的 Benchmark 两者都没有）；每道题都有 `statement/README.md` 和 `rubric/README.md`，分数记在 `scoreboard.yaml` 里。见 [Benchmark 存储](/self-improvement#benchmark-存储)。
- **状态。** `benchmark_config.toml` 中的 `status` 决定遮罩：`draft` 显示**构建中**，`failed` 显示**创建失败**，`published` 解除遮罩。清单读不了的 Benchmark 同样遮罩，显示**清单无法读取**，旁边图标的悬停提示说明原因。
- **用 AI 创建。** 提示词的固定结尾把被测智能体的 id、期望的基线分和 Pilot 迭代上限交给 `benchmark-design` Skill，并要求取得基线分。
- **手动创建。** 服务端按 Skill 读取的目录结构，把表单内容写入磁盘（`POST …/benchmarks`，仅 owner），状态为 `published`。
- **评估。** 提示词要求通过自行派生的 `agent-evaluation` 子 Agent，在本会话自己的模型上跑完完整的 Case × runs 矩阵；执行评估的 Agent 从系统提示词的 `Provider` 与 `Model ID` 两行读出这个模型。每条结果报告的 Agent、模型和思考等级都必须一致，最后只向 `scoreboard.yaml` 追加一条带标签的评估。被测的 Agent 和 Benchmark 都保持不变。
- **优化。** 使用 Default 时，提示词的固定结尾把被测智能体、Benchmark、每题运行次数、目标分数和最多轮数交给 `agent-optimization`；使用其他方法时，交给该方法的 Skill 的只有被测智能体、Benchmark 和每题运行次数，预算由方法自定。**方法**列表与插件库 Agent 自进化分类的插件一一对应。
- **删除。** 服务端整目录删除（`DELETE …/benchmarks/:id`）。评估还在运行时删除 Benchmark，可能留下一个目录，因为运行中的评估还在往里写。这个目录没有 `benchmark_config.toml`，不会出现在列表里，可以手动删除。
- **示例与内置 Benchmark。** 在 Project 创建时写入，此后不再写入。早先版本的 Project 保留已有的内容，不会得到内置 Benchmark。
- **内置 Benchmark。** 它们的清单与普通 Benchmark 无异，来源为 `builtin`；每道题的题干写明任务在仓库固定提交下的文件夹，并链接仓库里的运行规则，`agent-evaluation` Skill 与 RSI 工具包的评测参考都照此运行。`agent-evaluation` 的 `reference/harbor.md` 只补充 PenguinHarness 需要的部分：检出放在哪里、运行哪份 Agent State、trial 如何折算成分数。
