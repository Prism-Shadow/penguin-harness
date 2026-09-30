---
title: "自由创建、评估、进化任意多个 Agent"
date: 2026-09-16
category: practice
excerpt: "让 AI 编写 Benchmark 并测出基线分，问 AI 一道题在考什么，Benchmark 需要调整时用新的替换旧的，再评估和优化你的 Agent：Optimizer 负责改进，Evaluator 负责严格打分。"
---

大多数 Agent 项目都卡在同一个地方：改一版提示词，手动试两三道题，说不清 Agent 是真的变好了，还是你运气好。PenguinHarness 的评估中心用一套可重复的循环取代这种猜测。

Benchmark 是一组题目，每道题带一份评分标准。用 Benchmark 评估一个 Agent，就能得到分数；你还可以让 AI 据此优化这个 Agent。每个 Agent、每个 Benchmark 都是 Project 里的一个目录，想建多少就建多少，没有上限。

这篇教程写给在 PenguinHarness 里运行 Agent、想知道改动到底有没有用的人。在教程里，你会：

- 让 AI 为一个 Agent 编写 Benchmark，并测出它的第一个分数；
- 打开一道题，问 AI 它在考什么；
- 用改进后的 Benchmark 替换旧的，并删掉旧的；
- 评估一个 Agent，再优化它，并读懂结果。

读完之后，你会得到一个已发布的 Benchmark 和一张能对比所有已测版本的图表；如果某一轮优化超过了基线分，还会得到一个改进后的 Agent 版本。

## 准备工作

- PenguinHarness 0.2.13 或更高版本，桌面应用或 Web App 都可以。
- 在**模型库**页面配置好模型。
- 一个待测的 Agent：你在**智能体**页面创建的任意 Agent，或者每个 Project 自带的 **General Agent**（`default_agent`）。

每一步里干活的 Agent 都需要 `agent-tuning` 插件里的 Skill：`benchmark-design`、`agent-evaluation` 和 `agent-optimization`。General Agent 已经预装了它们，下文的对话框默认也会选它。

## 循环如何分工

评估中心把工作分给四个角色：

| 角色 | 做什么 | 不能做什么 |
| --- | --- | --- |
| Builder（出题方） | 编写题目和评分标准，试跑题目来校准难度，并记录基线分。 | 修改被测 Agent。 |
| 被测 Agent | 一次做一道题，在一个全新的 Workspace 里工作，里面只有这道题的任务材料。 | 查看评分标准。 |
| Evaluator（评估方） | 在一道题上把被测 Agent 运行一次，严格按评分标准给结果打分。 | 修改 Agent 或 Benchmark。 |
| Optimizer（优化方） | 阅读分数、题干和测试运行的 Trace，一次按一个假设修改 Agent。 | 查看评分标准、参考答案或 Evaluator 的评分理由。 |

Builder 和 Optimizer 都是你从评估中心的对话框里启动的，各自在一段独立的对话里工作。评估也在你发起的一段对话里进行，由**执行评估的智能体**负责协调。每个给一次运行打分的 Evaluator 都是子 Agent：一次评估或一轮优化，会为每道题的每次运行各派出一个 Evaluator。

![Optimizer 和 Evaluator 各自能读什么、能改什么](/blog-assets/evaluation-center-roles-zh.png)

Evaluator 和 Optimizer 是有意朝相反方向用力的。Evaluator 严格打分，而它依据的评分标准，Optimizer 始终看不到。Optimizer 会想尽办法提分，可它不知道答案是怎么判分的，要想稳定地提分，就只能让 Agent 真正更擅长这项任务。

## 第 1 步：打开评估中心

教程从评估中心页面开始。在侧栏选择**评估中心**。

页面顶部有三张卡片，概括了整个流程（**出题**、**评估**、**优化**），下面是 Project 里的 Benchmark。每张 Benchmark 卡片显示题目数量、测过的 Agent、分数趋势和最新分数。

![评估中心：三张流程卡片和 Benchmark 列表](/blog-assets/evaluation-center-overview-zh.png)

## 第 2 步：让 AI 创建 Benchmark

这一步，AI 会写出你的第一个 Benchmark：一组带评分标准的题目，难度经过校准，给你的 Agent 留出提升空间。

1. 点击右上角的**用 AI 创建**。
2. 在**被测智能体**里，选择这些题目面向的 Agent。
3. 描述你想测试的能力和场景，或者在**试试这些示例**下面选一个示例。好的描述会点明任务难在哪里：来源相互冲突、信息缺失、格式要求严格。
4. 选择**在新对话中编辑**。

![「让 AI 创建 Benchmark」对话框](/blog-assets/evaluation-center-create-with-ai-zh.png)

PenguinHarness 会打开一个新对话：完整的提示词已经填好，`benchmark-design` 和 `agent-evaluation` 两个 Skill 也已选中。消息还没有发出，你仍然可以修改提示词。

发送之前，先看一眼消息框工具栏里的模型。Builder 试跑题目、测基线分时，都会用这个对话的模型来运行被测 Agent；之后从**评估**标签页发起的评估，则用 Agent 自己配置的模型运行，而图表会为每个模型单独画一条线。想让基线分和之后的分数落在同一条线上，就选 Agent 配置的那个模型。提示词和模型都确认无误后，再发送。

接下来，Builder 会写出大约三道题，每道题包含一份给 Agent 的题干和一份满分 100 分的评分标准。它会试跑这些题目并加以调整，最多四轮，目标是让基线分低于 50，因为 Agent 已经能通过的 Benchmark 体现不出改进。每次试跑，每道题只运行一次。这期间，新 Benchmark 的卡片会显示**构建中**。校准结束后，只要基线分低于 85，Builder 就会记下 Agent 的第一个分数，也就是基线分，然后发布 Benchmark。

## 第 3 步：读懂 Benchmark

在相信任何分数之前，先看看 Builder 写出了什么。在 Benchmark 卡片上选择**查看**。Benchmark 页面包含：

- **题目**：Benchmark 里的每一道题。
- **分数随时间变化**：每个点代表一次评估。同一个 Agent 在同一模型、同一推理强度下的评估属于同一个系列，方便你追踪这个 Agent 各个版本的变化。
- **评估明细**：所有评估按从新到旧排列，列出被测 Agent、版本、模型、推理强度、分数、成本和耗时。点开一行，可以看到每道题、每次运行的分数。

![新 Benchmark 的页面：题目、图表上的基线分和评估明细表](/blog-assets/evaluation-center-benchmark-detail-zh.png)

到第 8 步，图上有了更多结果，你会再回来看这张**分数随时间变化**图表。

## 第 4 步：问 AI 一道题在考什么

只有弄明白分数是怎么来的，分数才对你有用。这一步会打开一道题，让 AI 解释它在测什么。

1. 在一道题旁边选择**查看详情**。题目会在文件浏览器里打开，里面有两个文件夹：**任务材料**是被测 Agent 拿到的内容；**评分标准**标着**被测 Agent 不可见**。
2. 选择**问 AI**。
3. 默认的问题是**解释这道题考什么、怎样才算答好**。可以直接用，也可以换一个示例，比如**评分细则在奖励什么？**
4. 选择**在新对话中编辑**，然后发送消息。

![在 Benchmark 中打开的一道题：任务材料、隐藏的评分标准和「问 AI」按钮](/blog-assets/evaluation-center-case-zh.png)

Agent 会拿到题干和评分标准的路径，把两份都读一遍，再用直白的语言解释这道题。它只读，不改。

## 第 5 步：用更好的 Benchmark 替换旧的

这一步是可选的，Benchmark 本身需要调整时再做。Benchmark 一旦创建，题目就冻结了：无论 Web App 还是 API，都改不了题干或评分标准。这样才能保证同一个 Benchmark 上的所有分数可以相互比较。要改题目，就创建一个新的 Benchmark，把旧的换下来。

1. 先问 AI 该改什么。题目上的示例问题「**题干怎样才能更清楚？**」问的正是这件事，回答会说明下一个 Benchmark 里这道题该怎么写。
2. 再次选择**用 AI 创建**，仍然选同一个**被测智能体**。在描述里写明新 Benchmark 的名字、它要替换的旧 Benchmark，以及你想要的改动，例如：「创建 `report-writing-v2`，基于 `report-writing-v1`。保留它的三道题，写明第 2 题期望的篇幅，并把第 3 题的引用格式要求得更严格。」
3. 发送消息，让 Builder 创建并校准新的 Benchmark。它会在新 Benchmark 上记下新的基线分。
4. 新 Benchmark 发布后，回到评估中心，点击旧 Benchmark 卡片上的垃圾桶图标，再点**删除**确认。只有 Project 所有者能删除 Benchmark。

> **删除无法撤销**。删除 Benchmark 会一并删掉它的题目和评估记录，之后无法恢复。

## 第 6 步：评估 Agent

评估会给 Agent 在某个 Benchmark 上打出分数。你可以用它给另一个想对比的 Agent 打分，也可以在手动改过 Agent 之后重新打分。

1. 在 Benchmark 卡片或页面上选择**使用**，再切到**评估**标签页。
2. 在**被测智能体**里选择要打分的 Agent。
3. **执行评估的智能体**保持 **General Agent** 即可，也可以换成其他装有 `agent-evaluation` Skill 的 Agent。
4. 按需修改**评估会话使用的模型**、**每题运行次数**和**说明**。这个模型用来运行执行评估的智能体自己的会话；被测 Agent 则用它自己配置的模型运行。**每题运行次数**默认取 Benchmark 自己的设置，用 AI 创建的 Benchmark 是 1；多跑几次，可以抵消单次运行的运气成分。
5. 选择**在新对话中编辑**，然后发送。

![「使用」对话框的「评估」标签页](/blog-assets/evaluation-center-use-evaluate-zh.png)

执行评估的智能体会为每道题的每次运行派出一个 Evaluator 子 Agent。每个 Evaluator 给被测 Agent 准备一个全新的 Workspace，里面只有这道题的任务材料，然后运行被测 Agent，按评分标准给结果打分。全部运行结束后，执行评估的智能体算出平均分，记下这次评估。图表上会多出一个点，标注 Agent、模型和推理强度。

> **对话去了哪里**。评估创建的对话都收在侧栏的**评估任务**文件夹里，不会挤占 Agent 自己的对话列表。

## 第 7 步：优化 Agent

优化有个前提：Agent 在这个 Benchmark 上要有基线分。如果创建 Benchmark 时它就是**被测智能体**，基线分已经有了；否则先评估它（第 6 步）。所选 Agent 还没有基线分时，**优化**标签页会提醒你。

1. 选择**使用**，再切到**优化**标签页。
2. 在**被测智能体**里选择要改进的 Agent。标签页会显示当前的基线分和目标分数。
3. **执行优化的智能体**保持 **General Agent** 即可，也可以换成其他装有 `agent-optimization` 和 `agent-evaluation` 两个 Skill 的 Agent。
4. 设置**最多轮数**（默认 3）和**目标分数**（默认比基线分高 10 分）。
5. 按需填写**优化重点**，例如「重点改引用规则，写作风格不要动」。
6. 选择**在新对话中编辑**，然后发送。

![「使用」对话框的「优化」标签页，显示当前基线分和目标分数](/blog-assets/evaluation-center-use-optimize-zh.png)

优化期间的每次评估，都沿用基线分记录的模型和推理强度来运行 Agent，与 Optimizer 自己的会话用什么模型无关。每一轮都遵循同样的模式：

1. Optimizer 阅读最新分数和测试运行的 Trace，提出一个可证伪的假设，解释 Agent 为什么丢分。
2. 确认当前版本已经有快照，然后只做一处修改：Agent 的指令、一个针对性的 Skill，或者一个安全的配置项。
3. Evaluator 子 Agent 用修改后的 Agent 跑完整个 Benchmark。
4. 总分严格提高，这次修改就保留为 Agent 的新版本；否则 Optimizer 恢复快照，下一轮换一个假设再试。

![一轮优化：Optimizer 修改 Agent，Evaluator 给候选版本打分，分数上升时修改才会保留](/blog-assets/evaluation-center-optimize-round-zh.png)

Agent 达到目标分数，或者轮数用完，循环就会停止。被否决的尝试不会进入 Benchmark 的记录；对话里会汇报每一轮的情况，包括失败的轮次。

两个角色之间的隔离写进了各自的 Skill。Evaluator 只把这道题的任务材料复制进测试 Workspace，评分标准、参考答案和自己的评分理由一律保密。Optimizer 的 Skill 要求它不打开评分标准和评估文件，一旦私密的评估信息进入它的上下文，就立即停止。每一次读取、每一处修改都记录在 Trace 里，事后可以审计。

## 第 8 步：对比 Agent，持续改进

回到 Benchmark 页面，每个保留下来的版本都会作为一个新点，出现在这个 Agent 的系列里。在下图的例子中，版本 2 把分数从 43.33 提到 48.33，版本 3 达到 55，超过了 54 的目标，循环就在这里停止。再评估其他 Agent，或者让同一个 Agent 换一个模型、换一个推理强度，每个组合都会在这张图上有自己的系列。

![优化后的分数走势：同一个 Benchmark 上还评估了第二个 Agent](/blog-assets/evaluation-center-results-zh.png)

接下来还可以：

- **就某次评估问 AI**。在**评估明细**里选中一行，点**问 AI**，试试**哪些题最弱、该改什么？**
- **多试几个 Agent**。在**智能体**页面创建指令或模型不同的 Agent，在同一个 Benchmark 上逐个评估。
- **回到更早的版本**。Optimizer 修改某个版本之前，会在 Agent 的目录里给它留一份快照 `snapshots/v<N>.tar.gz`。要恢复某个版本，打开 Agent 的设置，选择**导入快照**，再选中对应的文件；如果 PenguinHarness 运行在另一台机器上，先把文件复制到你的电脑。导入更早的版本时会先请你确认，而且只有 Project 所有者才能导入。

## 常见问题

- **Benchmark 卡片显示「创建失败」**。校准没有产出有效的试跑，或者最后一轮之后 Agent 仍然得到 85 分及以上，这个 Benchmark 既不能评估，也不能优化。先到创建 Benchmark 的那段对话里查看失败的试跑，再删掉它重新创建；如果是 Agent 分数太高，就要求出更难的题。
- **「使用」对话框提示 Agent 缺少 Skill**。你选的执行评估或执行优化的智能体缺少 `agent-evaluation` 或 `agent-optimization`，多半跑不完。换回 **General Agent**，或者给这个 Agent 装上 `agent-tuning` 插件。
- **「优化」标签页提示 Agent 没有基线分**。先在**评估**标签页评估它（第 6 步）。
- **基线分和之后的评估不在同一条线上**。它们用的模型不同：基线分用的是创建 Benchmark 那段对话的模型，从**评估**标签页发起的评估用的是 Agent 配置的模型。见第 2 步。

## 小结

这一路，你让 AI 建好 Benchmark 并测出基线分，让 AI 解释了一道题，用更好的 Benchmark 替换了旧的，评估了一个 Agent，还让 Optimizer 在严格的 Evaluator 把关下改进了它。每道题、每个分数、每个版本都是 Project 里的文件，你可以随时查看、备份，也可以做版本管理。

这些对话框里每个选项的说明，见[评估中心文档](https://penguin.ooo/docs/evaluation-center)。想了解这套循环的设计，请阅读[自我进化](https://penguin.ooo/docs/self-improvement)。
