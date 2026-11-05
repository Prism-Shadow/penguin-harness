---
title: "在 AMD GPU 上用 PenguinHarness 跑通 Agent 自我进化闭环"
date: 2026-07-22
category: practice
author: 高钰洋（AMD）、张宁（AMD）、郑耀威（PrismShadow）
excerpt: "用 AMD GPU 上的本地 Qwen3:8B 和 Fireworks API 上的模型，跑通一个完整的 PenguinHarness 自我进化闭环：从基线评估、Trace 分析，到 Agent 优化与回滚。"
description: "介绍 PenguinHarness 如何通过 Benchmark、Trace、可编辑的 Agent State 与 Snapshot 回滚构建自我进化闭环，并用本地 Qwen3:8B 与 Fireworks API 完成一次双模型实验。"
---

> 本文基于 PenguinHarness 0.1.1 撰写，之后的版本在部分细节上可能有所不同。

AMD × PrismShadow——高钰洋、张宁（AMD），郑耀威（PrismShadow）。

在本教程中，你会用 [PenguinHarness](https://github.com/Prism-Shadow/penguin-harness) 跑通一个完整的自我进化闭环：创建一个小 Agent，用 Benchmark 评估它，让 Optimizer 根据真实 Trace 中的证据改进它，分数更高才保留新版本。被测 Agent 使用 AMD GPU 上的 Qwen3:8B；负责创建、评估和优化的 Agent 则使用 Fireworks API 上的模型。

全程不重新训练模型，也不改动任何权重。本教程面向想让 Agent 更可靠、又不想准备训练数据的开发者，尤其适合 Agent 使用本地模型的场景。任务刻意选得很小，因为这里关注的是闭环本身，而不是比较模型在排行榜上的高低。

## 准备工作

- 一块 AMD GPU，并且 Ollama 已经能在上面正常运行 Qwen3:8B。AMD 驱动、ROCm 和 Ollama 的安装不在本教程范围内，具体方法可以参考 [Ollama Linux 文档](https://docs.ollama.com/linux)和 [GPU 支持文档](https://docs.ollama.com/gpu)。
- Fireworks API 访问权限。通过 AMD AI Developer Program，AMD 与 Fireworks AI 合作，为符合条件的开发者提供价值 50 美元的免费 Fireworks 额度；Fireworks 通过 OpenAI 兼容端点提供开源权重模型。额度兑换和 API Key 获取步骤，见 [Fireworks API 获取指南](https://penguin.ooo/blog/fireworks-credits-amd)。

## PenguinHarness 如何实现自我进化

PenguinHarness 是一个开源的 Agent Harness。它把模型接入、Agent 配置、Workspace 工具、Session、Trace、Skill 和 Benchmark 放在同一套运行环境中，同时提供 CLI 与 Web App；在线模型和通过 OpenAI 兼容端点暴露的本地模型，都可以用作推理后端。

PenguinHarness 把 Agent 的行为定义为一组可读、可编辑、带版本的状态文件，而不是一段只能由开发者手工维护的固定提示词。角色说明、工作流程、可复用的 Skill 和运行参数都属于 Agent State，每次任务也都会留下完整的 Session 与 Trace。因此，一个 Agent 可以先评估另一个 Agent，再根据真实运行记录修改它的 State，最后用同一套评估验证修改是否有效。

这就是 PenguinHarness 所说的自我进化：它不重新训练模型，也不更新模型权重，而是改进模型外围的 Agent Harness，并用可重复的测量结果决定新版本能否保留。

### 可编辑的 Agent State

Agent State 中主要的可编辑部分包括：

- `AGENTS.md`：角色、边界和工作流程；
- `skills/`：可复用的能力；
- `system_config.yaml`：版本和运行配置。

### 三个角色

- **Target Agent**：执行任务、接受评估和改进的目标 Agent；
- **Evaluator**：在隔离的 Workspace 中运行一道 Benchmark 题目，并按私有评分细则打分；
- **Optimizer**：读取基线分数及其关联的 Trace，提出改进假设，并修改 Target Agent 的 State。

### 自我进化闭环

1. 为目标能力创建包含多道题目的 Benchmark。
2. 多次运行 Target Agent，得到可追溯的基线。
3. 根据分数和关联的 Trace，定位稳定的失败模式。
4. 保存快照，然后修改 Agent State。
5. 用同一个 Benchmark 和同一个模型评估候选版本。
6. 总分严格提高才保留新版本，否则恢复之前的 State。

这个闭环由内置 Skill 编排：

- `agent-creation`：根据需求创建初始 Agent；
- `benchmark-design`：设计包含多道题目的 Benchmark，并建立完整基线；
- `agent-evaluation`：隔离执行一道题目的一次运行并打分；
- `agent-optimization`：分析基线和 Trace，修改 Agent State，评估候选版本并处理回滚。

关键不只是让一个模型改写另一个模型的提示词，而是让每次修改都在相同条件下重新评估。Benchmark 提供测量，Trace 提供证据，快照提供恢复点，State 版本号则把每个分数对应到实际产生它的 Agent State。优化没有带来严格提升时，候选修改就不算一次成功的进化。

### 两个模型，各司其职

本教程把工作分给两个模型：

| 用途 | Agent | 模型 |
|---|---|---|
| 创建 Agent、设计 Benchmark 和执行优化 | `default_agent` | Fireworks API 模型 |
| 接受评估和改进 | `meeting_summary_agent` | AMD GPU 上的 Qwen3:8B |

Qwen3:8B 通过 Ollama 在 AMD GPU 上运行，作为 Target Agent 的模型；通过 Fireworks API 调用的模型运行 `default_agent`，负责创建 Agent、设计 Benchmark 和执行优化。你会先测出 v1 的基线，再让 Optimizer 根据真实 Trace 改进 Agent，最后由同一个 Benchmark 决定接受新版本还是回滚。

## 本文要完成的实验

你要创建的是 `meeting_summary_agent`。它读取少量文本文件，并在 Workspace 中生成下面这个文件：

```markdown
# 摘要

## 已确认

## 待办

## 未确定
```

再用一个包含两道题目的 Benchmark 评估它：

| 题目 | 任务 |
|---|---|
| 单份会议纪要 | 提取已确认事项、两个待办和一个未确定项 |
| 草案与正式决定 | 同时读取草案和正式决定，并以正式决定为准 |

每道题目独立运行三次，因此一次完整评估共有六次 Target Agent 运行。

下面的步骤按这个流程展开：

1. 配置本地 Qwen3:8B 与 Fireworks API 模型。
2. 创建 v1 Agent。
3. 导出 v1 快照。
4. 创建并运行 Benchmark。
5. 查看基线和 Trace。
6. 优化 Agent。
7. 用同一个 Benchmark 评估候选版本。
8. 接受新版本或回滚。

## 第一步：安装 PenguinHarness 并注册模型

这一步安装 PenguinHarness，并注册实验要用到的两个模型。

安装并启动 PenguinHarness：

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

在 Web App 中打开**模型仓库**页面，添加本地 Qwen3:8B：

<img width="491" height="481" alt="PenguinHarness 本地 Qwen3:8B 模型配置" src="https://github.com/user-attachments/assets/a0d866e9-21e6-4b89-8ec1-b50710aed0db" />

然后配置 Fireworks API Key，并将 DeepSeek V4 Flash 设为默认模型：

<img width="498" height="479" alt="PenguinHarness Fireworks API 模型配置" src="https://github.com/user-attachments/assets/3b392317-615d-46d3-95c9-f9e3b4ad61a5" />

这样，新建的 `default_agent` 顶层对话会使用 Project 默认模型，也就是 Fireworks 模型；Benchmark 运行 `meeting_summary_agent` 时，则显式指定下面这组本地模型配置：

```text
provider: custom
model_id: qwen3:8b
```

基线和每个候选版本都必须使用同一组 `(provider, model_id)`，否则分数无法直接比较。

## 第二步：创建 v1 Agent

这一步创建 Target Agent 的第一个版本，并保存一份快照作为恢复点。

1. 在 Web App 中创建一个新 Agent，Agent id 填 `meeting_summary_agent`。Agent id 只能包含小写字母、数字和下划线，带短横线的 id 会被拒绝。
2. 与 `default_agent` 新建一个顶层对话，模型选择刚刚设为 Project 默认模型的 Fireworks 模型。
3. 调用 `agent-creation` Skill（0.2.4 起更名为 `agent-initialization`），并提交下面的提示词。

这段提示词会生成 `meeting_summary_agent` 的 v1 版本。v1 只定义基本职责和安全边界，不提前写入完整的总结流程，这样 Benchmark 才能在真实运行中暴露它缺少的工作习惯。

<details>
<summary><strong>展开：创建 v1 Agent 的完整提示词</strong></summary>

```text
请使用 agent-creation Skill 配置 Agent `meeting_summary_agent`。

目标：
这是一个简单的本地文件总结 Agent。它读取当前工作区中的任务说明和文本文件，并创建题目要求的总结文件。

请将 v1 保持简洁：

1. 在 AGENTS.md 中只写清：
   - 读取当前工作区中的任务和相关文件；
   - 根据文件内容生成简洁总结；
   - 只在当前工作区工作；
   - 不访问外部服务；
   - 不泄露环境变量、凭证或无关文件。

2. 不要预先加入完整的文件总结工作流，例如：
   - 强制列出并读取全部材料；
   - 系统区分草案与正式决定；
   - 强制将信息分为已确认、待办和未确定；
   - 完成后逐项核对输出。

3. 不要安装业务 Skill。
4. 不要故意要求 Agent 犯错。
5. 不修改稳定的 system_prompt。
6. 设置：
   - name: Meeting Summary Agent
   - description: Summarizes a small set of local text files.

最后报告修改的 Agent State 文件和当前 State version。
```

</details>

创建完成后，可以在 Agent 列表中看到新 Agent。下图来自最初的那次运行，当时的 Agent id 是 `meeting-summary-agent`：

<img width="1376" height="464" alt="Agent 列表中的 Meeting Summary Agent" src="https://github.com/user-attachments/assets/7e3f70d2-2164-4f90-8507-6c2d1cd9085c" />

打开这个 Agent 的设置页面，在**概览**标签页点击**导出快照**，导出 v1 快照。后续候选版本失败时，这份快照就是恢复点；在它存在之前，`agent-optimization` Skill 不会改动 Agent State：

<img width="790" height="407" alt="导出 v1 Agent State Snapshot" src="https://github.com/user-attachments/assets/6f0c4745-3fd5-4c66-b302-bd58e42ce646" />

## 第三步：创建 Benchmark 并测量基线

这一步创建并校准 Benchmark，然后跑完 v1 的完整基线。

仍然在使用 Fireworks 模型的 `default_agent` 顶层对话中调用 `benchmark-design` Skill，并提交下面的提示词。它会创建并校准 v1 版本的 Benchmark，Benchmark ID 为：

```text
simple-file-summary-2case-v1
```

两道题目的满分合计 100 分，每道题目运行三次。Target Agent 只能看到公开的题干，看不到私有评分细则。

<details>
<summary><strong>展开：创建并校准 Benchmark 的完整提示词</strong></summary>

```text
请使用 benchmark-design Skill，为下面的 Test Agent 创建并校准 Benchmark。

Test Agent:
meeting_summary_agent

Benchmark ID:
simple-file-summary-2case-v1

评测模型：
provider: custom
model_id: qwen3:8b

能力目标：
读取少量本地文本文件，在工作区根目录创建 SUMMARY.md；
准确区分已确认事实、待办事项和未确定信息；
当草案与明确的正式决定冲突时，以正式决定为准；
不得猜测或修改输入材料。

统一要求：
1. 每个 Case 的 statement 中提供 README.md 和 materials/*.txt。
2. Target Agent 必须创建 SUMMARY.md。
3. SUMMARY.md 包含：
   - # 摘要
   - ## 已确认
   - ## 待办
   - ## 未确定
4. 不得修改 README.md 或 materials/。
5. runs = 3。
6. 两个 Rubric 的最高分合计为 100。
7. Statement 不得泄露私有 Rubric 或标准答案。

请创建以下两个 Case。

CASE-001：单份会议纪要，最高 45 分

materials/meeting.txt：

产品周会，日期 2026-08-03。

正式决定：2026-08-10 开放内部试用。

小林负责整理使用说明，截止 2026-08-06。
小周负责完成冒烟测试，截止 2026-08-08。

移动端导出是否包含在本次试用中，尚未决定。

Rubric 应检查：
- SUMMARY.md 是否存在；
- 标题和分类是否正确；
- 内部试用日期是否准确；
- 两个待办的负责人、事项和截止日期是否完整；
- 移动端导出是否保留为未确定；
- 是否没有编造信息；
- 输入文件是否保持不变。

CASE-002：草案与正式决定，最高 55 分

materials/plan_draft.txt：

项目草案，日期 2026-08-01。
草案计划在 2026-08-15 上线。
初步负责人为小林。

materials/final_decision.txt：

正式决定，日期 2026-08-04。
由于测试延期，上线日期改为 2026-08-22。
小林负责发布准备，截止 2026-08-20。
邮件宣传时间尚未确定。

Rubric 应检查：
- SUMMARY.md 是否存在；
- 标题和分类是否正确；
- 是否使用正式上线日期 2026-08-22；
- 是否没有把草案日期当成当前决定；
- 是否准确提取发布准备任务和截止日期；
- 邮件宣传时间是否保留为未确定；
- 是否没有编造信息；
- 输入文件是否保持不变。

完成完整的 2 Cases × 3 runs 基线，将结果写入 scoreboard.yaml。

最后报告：
- Benchmark 路径；
- 总分；
- 两个 Case 的三次原始分数与均分；
- 运行波动；
- 全部 Test Session ID。
```

</details>

完成后，Benchmark 的结构如下：

<img width="635" height="350" alt="生成后的 Benchmark 结构" src="https://github.com/user-attachments/assets/f44b9bbd-4b38-4c14-aa3a-2d95f44165cf" />

在 Web App 中查看运行输出，然后打开**评估中心**，查看总分、每道题目的平均分，以及对应的 Session 和 Trace：

<img width="550" height="235" alt="Benchmark 基线评分" src="https://github.com/user-attachments/assets/5dbfb515-198d-4d29-9ff3-01eccd61d630" />

基线总分为 84 分。由于任务较为简单，基线已经超过 80 分，但仍有提升空间。候选版本必须超过这个分数。

## 第四步：优化 Agent

这一步由 Optimizer 分析全部六次运行及其关联的 Trace，再根据证据对 Agent State 做一处小的修改。

在使用 Fireworks 模型的 `default_agent` 顶层对话中调用 `agent-optimization` Skill，并提交下面的提示词。它要求 Optimizer 提出一个可泛化的行为假设，再修改 `AGENTS.md`，或者创建一个职责明确、范围有限的 Skill。

<details>
<summary><strong>展开：优化 Agent 的完整提示词</strong></summary>

```text
请使用 agent-optimization Skill，以 Benchmark optimization mode 优化目标 Agent。

Test Agent:
meeting_summary_agent

Benchmark:
simple-file-summary-2case-v1

优化目标：
提高读取少量本地文件并生成可靠总结的稳定性。

规则：
1. 使用 scoreboard.yaml 中当前版本的完整基线作为 reference。
2. 保持相同模型：
   - provider: custom
   - model_id: qwen3:8b
3. 不修改 Case、Statement、Rubric 或 runs。
4. 分析全部 2 个 Case、每个 Case 的 3 次运行和全部 score-linked Trace。
5. 本轮只提出一个可证伪、可跨 Case 泛化的行为假设。
6. 只做支持该假设的最小 Agent State 修改。
7. 优先修改 AGENTS.md；只有确实需要复用能力时，才创建职责明确、范围有限的 Skill。
8. 不得写入 Case ID、人物名、具体日期、标准答案或私有 Rubric。
9. Candidate 必须运行完整的 2 Cases × 3 runs。
10. Candidate 总分严格高于 reference 才接受；相同或下降必须回滚。
11. 本次最多接受一个新版本。

最后报告：
- reference 总分和各 Case 均分；
- 从 Trace 中发现的稳定失败模式；
- 行为假设；
- 修改的 Agent State 文件；
- candidate 总分和各 Case 均分；
- 接受或回滚原因；
- 全部 Test Session ID。
```

</details>

一种可能的优化方向，是加入简洁的工作流程或一小组执行约束。具体修改应由真实 Trace 中的证据决定，而不是把 Benchmark 的答案直接写进 Agent State。

## 第五步：比较结果并保留新版本

这一步由 Optimizer 在完全相同的条件下评估候选版本，并执行接受规则。

候选版本使用同样的两道题目、同样的 Qwen3:8B 和同样的三次重复运行。接受规则很简单：

```text
candidate 总分 > reference 总分
→ 保留新版本

candidate 总分 <= reference 总分
→ 回滚到 v1
```

这次运行中，Optimizer 在 `AGENTS.md` 里新增了工作流程，重新运行全部题目，并报告了新的分数：

<img width="857" height="413" alt="Agent 优化结果与更新后的 Agent State" src="https://github.com/user-attachments/assets/f046ca42-e7ef-4063-8c10-babce816eba4" />

如果 v2 被接受，就在 Agent 的**概览**标签页导出 v2 快照。如果还要继续优化，就从已接受的版本出发，重复上述流程。

打开**评估中心**，选择 **MEETING SUMMARY AGENT**，就能看到两轮评估形成的进化记录：

<img width="628" height="515" alt="Benchmark 页面中的两轮进化记录" src="https://github.com/user-attachments/assets/58be7385-8746-4931-92e6-f563dc26e804" />

由于示例任务较为简单，一轮优化就把分数推到接近满分。在更复杂的真实任务中，自我进化闭环的价值会体现得更加明显。

## 实验说明了什么

你测出了 84 分的基线，让 Optimizer 根据 Trace 中的证据修改 Agent State，并执行了这样一条规则：只有在同一个 Benchmark、同一个模型、同样的运行次数下总分严格更高，新版本才会被保留。

这个实验展示的并不是 Qwen3:8B 在运行中重新训练了自己，而是 PenguinHarness 如何让 Agent 的工作流程进入一个可验证的闭环：

```text
行为被 Benchmark 测量
→ 失败可以回溯到 Trace
→ 工作流程被写入 Agent State
→ 新版本重新接受完整评测
→ 只有真实提升才被保留
```

对于本地模型来说，这种方式尤其有价值：不需要准备训练数据，也不需要微调模型权重，更清晰的工作流程同样能提高 Agent 完成任务的稳定性。

## 参考资料

- [PenguinHarness GitHub](https://github.com/Prism-Shadow/penguin-harness)
- [PenguinHarness 自我进化文档](https://penguin.ooo/docs/self-improvement/)
- [Fireworks API 免费额度兑换与 API Key 获取](https://penguin.ooo/blog/fireworks-credits-amd)
