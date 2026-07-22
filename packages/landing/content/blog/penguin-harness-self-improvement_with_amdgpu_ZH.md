---
title: "在 AMD GPU 上用 PenguinHarness 实现 Agent 自我进化"
date: 2026-07-22
category: "news"
excerpt: "通过本地 Qwen3:8B 与 Fireworks API 的双模型分工，完整演示 PenguinHarness 从基线评测、Trace 分析到 Agent 优化与回滚的自我进化闭环。"
description: "介绍 PenguinHarness 如何通过 Benchmark、Trace、可编辑的 Agent State 与 Snapshot 回滚构建自我进化闭环，并用本地 Qwen3:8B 与 Fireworks API 完成一次双模型实验。"
---
# 在 AMD GPU 上用 PenguinHarness 实现 Agent 自我进化

*AMD × PrismShadow——高钰洋、张宁（AMD），郑耀威（PrismShadow）。*

[PenguinHarness](https://github.com/Prism-Shadow/penguin-harness) 是一个开源的 Agent Harness。它把模型接入、Agent 配置、工作区工具、Session、Trace、Skill 和 Benchmark 放在同一套运行环境中，并同时提供 CLI 与 Web UI。在线模型和通过 OpenAI 兼容接口暴露的本地模型，都可以作为其中的推理后端。

这个项目比较特别的一点，是它把 Agent 的行为定义为一组可以读取、修改和版本化的状态文件，而不是一段只能由开发者手工维护的固定提示词。角色说明、工作方式、可复用 Skill 和运行参数都属于 Agent State；一次任务又会留下完整的 Session 与 Trace。因此，另一个 Agent 可以先评测目标 Agent，再根据真实运行记录修改它的状态，最后用同一套评测验证修改是否有效。

这就是 PenguinHarness 所说的“自我进化”：它不重新训练模型，也不更新模型权重，而是持续改进模型外部的 Agent Harness，并用可重复的结果决定新版本能否被保留。

## PenguinHarness 如何实现自我进化

一个 Agent 的主要可编辑状态包括：

- `AGENTS.md`：角色、边界和工作流程；
- `skills/`：可复用能力；
- `system_config.yaml`：版本和运行配置。

围绕这些状态，PenguinHarness 把自我进化组织成三个角色：

- **Target Agent**：真正执行任务、接受评测和改进的目标 Agent；
- **Evaluator**：在隔离工作区中运行一个 Benchmark Case，并根据私有 Rubric 评分；
- **Optimizer**：读取基线分数及其关联 Trace，提出改进假设并修改 Target Agent State。

完整闭环如下：

1. 为目标能力建立多 Case Benchmark。
2. 对 Target Agent 重复运行，得到可追溯的基线。
3. 从分数和对应 Trace 中定位稳定的失败模式。
4. 保存 Snapshot，并修改 Agent State。
5. 使用相同 Benchmark 和相同模型重新评测候选版本。
6. 总分严格提高则保留新版本，否则恢复原状态。

这个流程主要由内置 Skill 编排：

- `agent-creation`：根据需求创建初始 Agent；
- `benchmark-design`：设计多 Case Benchmark，并建立完整基线；
- `agent-evaluation`：隔离执行并评分一次 Case 运行；
- `agent-optimization`：分析基线和 Trace，修改 Agent State，并完成候选版本评测与回滚。

这里的关键不只是“让另一个模型改写提示词”，而是让每次修改都经过同条件复测。Benchmark 提供度量，Trace 提供证据，Snapshot 提供恢复点，版本号则把分数与实际 Agent State 对应起来。优化没有带来严格提升时，候选修改不会被当成进化成果。

为了把这套机制完整跑一遍，本文采用双模型分工：AMD GPU 上通过 Ollama 运行的 Qwen3:8B 作为 Target Agent 的模型；通过 Fireworks API 调用的模型则用于运行 `default_agent`，负责创建 Agent、设计 Benchmark 和执行优化。我们先测出 v1 的基线，再让 Optimizer 根据真实 Trace 改进它，最后由同一 Benchmark 决定接受新版本还是回滚。这个例子关注的是自我进化闭环本身，而不是比较模型排行榜上的能力高低。

## 本文要完成的实验

我们创建一个 `meeting-summary-agent`。它读取少量文本文件，并在工作区中生成：

```markdown
# 摘要

## 已确认

## 待办

## 未确定
```

Benchmark 包含两个 Case：

| Case | 任务 |
|---|---|
| 单份会议纪要 | 提取已确认事项、两个待办和一个未确定项 |
| 草案与正式决定 | 同时读取草案和正式决定，并以正式决定为准 |

每个 Case 独立运行 3 次，因此一次完整评测共有 6 次 Target Agent 运行。

完整流程如下：

1. 配置本地 Qwen3:8B 与 Fireworks API 模型。
2. 创建 v1 Agent。
3. 导出 v1 Snapshot。
4. 创建并运行 Benchmark。
5. 查看基线和 Trace。
6. 优化 Agent。
7. 使用相同 Benchmark 重新评测候选版本。
8. 接受新版本或回滚。

---

## 第一步：配置 AMD GPU 上的 Qwen3:8B 与 Fireworks API

本实验使用两类模型：

| 用途 | Agent | 模型 |
|---|---|---|
| 创建 Agent、设计 Benchmark 和执行优化 | `default_agent` | Fireworks API 模型 |
| 接受评测与进化 | `meeting-summary-agent` | AMD GPU 上的 Qwen3:8B |

### 准备本地 Qwen3:8B

本地模型通过 Ollama 运行。AMD 驱动、ROCm 和 Ollama 的安装不是本文重点，这里不做详细介绍；只需提前确认 Qwen3:8B 已经能够被 Ollama 正常调用。具体安装方式可以参考 [Ollama Linux 文档](https://docs.ollama.com/linux) 和 [GPU 支持文档](https://docs.ollama.com/gpu)。

### 获取 Fireworks API

通过 AMD AI Developer Program，AMD 与 Fireworks AI 合作，为符合条件的开发者提供价值 50 美元的免费 Fireworks 额度。Fireworks 通过 OpenAI 兼容端点提供开源权重模型。可参阅 [Fireworks API 获取指南](https://penguin.ooo/blog/fireworks-credits-amd)，了解额度兑换和 API Key 获取步骤。

### 在 Web UI 中注册模型

安装并启动 PenguinHarness：

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

打开 Web UI 的 **Models** 页面，添加本地 Qwen3:8B：

<img width="491" height="481" alt="PenguinHarness 本地 Qwen3:8B 模型配置" src="https://github.com/user-attachments/assets/a0d866e9-21e6-4b89-8ec1-b50710aed0db" />

然后配置 Fireworks API Key，并将 DeepSeek V4 Flash 设置为默认模型：

<img width="498" height="479" alt="PenguinHarness Fireworks API 模型配置" src="https://github.com/user-attachments/assets/3b392317-615d-46d3-95c9-f9e3b4ad61a5" />

这样，新建 `default_agent` 顶层 Chat 时可以直接使用 Project Default，也就是 Fireworks 模型；Benchmark 在运行 `meeting-summary-agent` 时，则显式指定下面这组本地模型配置：

```text
provider: custom
model_id: qwen3:8b
```

后续的 baseline 和 candidate 都必须沿用这组 `(provider, model_id)`，否则分数不能直接比较。

---

## 第二步：创建 v1 Agent

在 PenguinHarness Web UI 中创建一个新的 Agent：`meeting-summary-agent`。

使用 `default_agent` 新建一个顶层 Chat，模型选择刚刚设为 Project Default 的 Fireworks 模型。然后调用 `agent-creation` Skill，并输入下面的 Prompt，生成 `meeting-summary-agent` 的 v1 版本。v1 只定义基本职责和安全边界，不提前写入完整总结流程，这样 Benchmark 才能真实暴露它缺少的工作习惯。

<details>
<summary><strong>展开：创建 v1 Agent 的完整 Prompt</strong></summary>

```text
请使用 agent-creation Skill 配置 Agent `meeting-summary-agent`。

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


创建完成后，可以在 Agent 列表中看到新增的 `meeting-summary-agent`：

<img width="1376" height="464" alt="Agent 列表中的 meeting-summary-agent" src="https://github.com/user-attachments/assets/7e3f70d2-2164-4f90-8507-6c2d1cd9085c" />

然后进入 Agent 设置页面并导出 v1 Snapshot。它是后续 Candidate 失败时的回滚基础。

<img width="790" height="407" alt="导出 v1 Agent State Snapshot" src="https://github.com/user-attachments/assets/6f0c4745-3fd5-4c66-b302-bd58e42ce646" />

---

## 第三步：创建 Benchmark

仍然在使用 Fireworks 模型的 `default_agent` 顶层 Chat 中调用 `benchmark-design` Skill，并输入下面的 Prompt 来创建并校准 v1 版本的 Benchmark。

Benchmark ID 使用：

```text
simple-file-summary-2case-v1
```

两个 Case 的总分为 100 分，每个 Case 运行 3 次。Target Agent 只能看到公开题面，不能看到私有 Rubric。

<details>
<summary><strong>展开：创建并校准 Benchmark 的完整 Prompt</strong></summary>

```text
请使用 benchmark-design Skill，为下面的 Test Agent 创建并校准 Benchmark。

Test Agent:
meeting-summary-agent

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

完成后，会得到如下图所示的 Benchmark 结构：

<img width="635" height="350" alt="生成后的 Benchmark 结构" src="https://github.com/user-attachments/assets/f44b9bbd-4b38-4c14-aa3a-2d95f44165cf" />

在 Web UI 中查看运行输出，并在 Benchmark 页面检查总分、每个 Case 的均分，以及对应的 Session 和 Trace。

<img width="550" height="235" alt="Benchmark 基线评分" src="https://github.com/user-attachments/assets/5dbfb515-198d-4d29-9ff3-01eccd61d630" />

可以看到，整体评分为 84 分。由于任务较为简单，baseline 已经进入 80 分区间，但仍有优化空间。后续我们会继续优化 Agent，以展示完整的自我进化过程。


---

## 第四步：优化 Agent

基线建立后，在使用 Fireworks 模型的 `default_agent` 顶层 Chat 中调用 `agent-optimization` Skill，并输入下面的 Prompt。Optimizer 会分析全部 6 次运行及其 Trace，提出一个可泛化的行为假设，再修改 `AGENTS.md` 或创建一个职责明确、范围有限的 Skill。

<details>
<summary><strong>展开：优化 Agent 的完整 Prompt</strong></summary>

```text
请使用 agent-optimization Skill，以 Benchmark optimization mode 优化目标 Agent。

Test Agent:
meeting-summary-agent

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

一种可能的优化方向，是加入简洁的工作流程或执行约束。

具体修改内容应由真实 Trace 决定，而不能把 Benchmark 的答案直接写入 Agent State。

---

## 第五步：比较并保留新版本

Optimizer 会使用同样的两个 Case、同样的 Qwen3:8B 和同样的 3 次重复运行评测 Candidate。

接受规则很简单：

```text
candidate 总分 > reference 总分
→ 保留新版本

candidate 总分 <= reference 总分
→ 回滚到 v1
```

优化完成后可以看到，Agent 修改了 `AGENTS.md`，新增了工作流程，并重新运行全部 Case，得到新的评测分数：

<img width="857" height="413" alt="Agent 优化结果与更新后的 Agent State" src="https://github.com/user-attachments/assets/f046ca42-e7ef-4063-8c10-babce816eba4" />

如果 v2 被接受，再从 Agent Overview 导出 v2 Snapshot。如果还需要继续优化，可以基于已接受的版本重复上述流程。

打开 Benchmark 页面，选择 **MEETING SUMMARY AGENT**，可以查看两轮评测形成的进化记录：

<img width="628" height="515" alt="Benchmark 页面中的两轮进化记录" src="https://github.com/user-attachments/assets/58be7385-8746-4931-92e6-f563dc26e804" />

> 由于示例任务较为简单，一轮优化后分数便接近满分。在更复杂的真实场景中，自我进化能力的价值会体现得更加明显。

---

## 结语

这个实验展示的并不是 Qwen3:8B 在运行中重新训练了自己，而是 PenguinHarness 让 Agent 的工作方式进入了一个可验证闭环：

```text
行为被 Benchmark 测量
→ 失败可以回溯到 Trace
→ 工作流程被写入 Agent State
→ 新版本重新接受完整评测
→ 只有真实提升才被保留
```

对于本地模型来说，这种方式尤其有价值：不需要准备训练数据或微调权重，也能通过更清晰的工作流程，提高 Agent 完成任务的稳定性。

## 参考资料

- [PenguinHarness GitHub](https://github.com/Prism-Shadow/penguin-harness)
- [PenguinHarness 自我进化文档](https://penguin.ooo/docs/self-improvement/)
- [Fireworks API 免费额度兑换与 API Key 获取](https://penguin.ooo/blog/fireworks-credits-amd)
