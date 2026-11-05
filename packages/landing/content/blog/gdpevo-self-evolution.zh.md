---
title: "用 Penguin Harness 在 GDPEVO 上开展自进化实验"
date: 2026-11-04
category: practice
author: Leijun Zhou
excerpt: "在 PenguinHarness 0.2.19 中使用内置的 GDPEVO Essential 系列 Benchmark（包含六个子 Benchmark，共 30 道训练题与 30 道测试题），对比评测 SkillAdam、SkillOpt、TRACE 与 OpenSkill 四种 Agent 自进化方法。"
---

本文介绍如何使用 PenguinHarness 0.2.19 在 [GDPEVO Essential](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/leaderboards/gdpevo-essential) 系列 Benchmark 上开展 Agent 自进化实验。实验中基座模型固定为 `DeepSeek-V4.1-Flash-1017`，思考强度设为 `max`，系统对比了 [SkillAdam](https://arxiv.org/abs/2609.08944v1)、[SkillOpt](https://arxiv.org/abs/2605.23904v1)、[TRACE](https://arxiv.org/abs/2608.22793v2) 和 [OpenSkill](https://arxiv.org/abs/2606.06741v1) 四种自进化方法。下文将依次说明 GDPEVO Essential 系列 Benchmark 的构成与评测规则、自进化方法的核心机制、Web 界面的实验启动方式、系统内部的执行流程以及最终的实测结果。

## 1. GDPEVO Essential 系列 Benchmark 的构成与评测规则

GDPEVO Essential 是一套面向企业级真实业务任务与 Agent 自进化能力评测的系列 Benchmark，由六个独立的子 Benchmark 组成，合计包含 30 道训练题与 30 道测试题（共 60 道题）。在 [penguin-harness-benchmark](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/data) 仓库与 PenguinHarness 内置评测库中，每个子 Benchmark 均由配对的训练集与测试集组成，各自包含 5 道训练题与 5 道保留测试题：

| Benchmark 名称 | Benchmark 标识 | 题目数量 | 任务概述 |
| :--- | :--- | :--- | :--- |
| 服务工单处理 | [service-ticket-resolution](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/data/penguinharness-benchmark-gdpevo-essential-service-ticket-resolution-train) | 5 训练 / 5 测试 | 查询客服后台记录，核实并处理待办工单 |
| 财务管控 | [financial-control](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/data/penguinharness-benchmark-gdpevo-essential-financial-control-train) | 5 训练 / 5 测试 | 根据财务系统数据完成账目核对与结账核算 |
| 投资组合管理 | [portfolio-management](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/data/penguinharness-benchmark-gdpevo-essential-portfolio-management-train) | 5 训练 / 5 测试 | 读取资管平台数据，计算持仓估值与调仓方案 |
| 医保审核 | [coverage-review](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/data/penguinharness-benchmark-gdpevo-essential-coverage-review-train) | 5 训练 / 5 测试 | 对照医保条款与申报材料，给出理赔审核结论 |
| 法院书记员业务 | [court-clerk-operations](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/data/penguinharness-benchmark-gdpevo-essential-court-clerk-operations-train) | 5 训练 / 5 测试 | 核对立案卷宗材料，整理案件排期与归档信息 |
| 工程项目组合分析 | [engineering-portfolio-analytics](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/data/penguinharness-benchmark-gdpevo-essential-engineering-portfolio-analytics-train) | 5 训练 / 5 测试 | 汇总多项工程的进度与资源数据，输出组合分析结果 |

在 GDPEVO Essential 系列 Benchmark 的评测规则下，每个子 Benchmark 的实验遵循以下三项设定：

- **按 Benchmark 独立训练与测试**：六个子 Benchmark 彼此独立，每个 Benchmark 单独开展训练并产出一份专属的 `SKILL.md` 技能文档，不同 Benchmark 之间不混合训练数据，也不共享习得的技能。
- **训练阶段（5 道题共享单容器连续会话，限时 6 小时）**：同一个 Benchmark 的 5 道训练题在同一个业务容器与同一个连续会话中完成，中途不重置环境或工作区。训练容器在本地回环端口提供只读业务后端服务，并内置在线评分接口 `POST /api/judge` 供 Agent 在演进过程中获取得分与诊断反馈。具体是否调用该接口由自进化方法本身决定，例如有监督方法会借此引导技能修订，而无监督方法则完全依靠自建的虚拟测试进行演进。
- **测试阶段（5 道题 × 3 轮独立容器评测，每题限时 4 小时）**：训练产出的 `SKILL.md` 一经导出即被冻结，随后在该 Benchmark 的 5 道保留测试题上完整重复评测 3 轮（单个 Benchmark 共 15 次测试运行，全系列 6 个 Benchmark 共 90 次测试运行）。每一道测试题的每一次作答均在全新的隔离容器与空白会话中独立运行，且关闭一切在线训练反馈接口，待作答结束后由离线评分器统一判分。

## 2. 自进化方法：以 SkillAdam 为例

在本次实验中，我们将 [SkillAdam](https://arxiv.org/abs/2609.08944v1)、[SkillOpt](https://arxiv.org/abs/2605.23904v1)、[TRACE](https://arxiv.org/abs/2608.22793v2) 与 [OpenSkill](https://arxiv.org/abs/2606.06741v1) 四种近期学术界的自进化工作复现并适配为 PenguinHarness 的内置方法插件，以便在统一的业务容器与评分标准下横向评测它们的效果。

这里以我们适配的 [SkillAdam](https://arxiv.org/abs/2609.08944v1)（对应插件 `skilladam-rsi-toolkit`）为例说明容器内的演进过程。在连续训练环境中，目标 Agent 需要根据 5 道训练题的反馈不断修订 `SKILL.md`。如果直接让模型在每轮之后自由改写整份文档，实践中很容易遇到两类问题：一是缺乏对历史失败修改的记录，模型容易在已被证伪的方向上反复尝试，二是单次改动的步幅难以控制，为了修好某一道题的局部问题，常常把原本在其他题目上生效的规则改坏。

针对这两个痛点，SkillAdam 原论文借鉴了深度学习中 Adam 优化器“一阶动量 + 二阶方差自适应步长”的设计思路。在我们的插件适配中，训练容器内的目标 Agent 按以下四步闭环迭代演进 `SKILL.md`：

<figure class="post-figure" data-widget="skilladam-loop"><ol class="fig-steps"><li>五题试跑测分差：目标 Agent 完成 T1–T5 试跑并统计各题分差</li><li>严格均分门控：对比本轮均分与当前最佳，严格提升时采纳晋级</li><li>Adam 状态更新：同步更新一阶 EIT 问题账本与二阶方差编辑预算 Bt</li><li>局部微调 SKILL.md：仅在额度允许的范围内局部修改并输出新版 SKILL.md</li></ol><figcaption>SkillAdam 的四阶段演进闭环。</figcaption></figure>

- **无技能初测与初版提炼**：训练启动后，Agent 首先在不挂载任何业务技能的状态下完成 5 道训练题的初次尝试，根据执行轨迹与评分反馈提炼出初版 `SKILL.md`。在随后的每一轮迭代中，Agent 均使用当前或候选技能文档在训练题上实测作答，收集各题得分、新旧分差与具体失误原因。
- **演进问题追踪器（EIT）**：算法在迭代全程维护一份问题账本，持续追踪训练题中暴露的错误模式、历次尝试过的修复方案及其实际效果。即便某一轮提出的候选修改最终因为没有提分而被拒绝，这次失败尝试的记录也会更新回 EIT 中，避免后续轮次重复无效修改。
- **方差自适应编辑预算**：每当候选版本在 5 道训练题上完成实测后，算法会评估该次修改在不同题目上引起的得分波动。如果一次修改让部分题目得分上升，却让另一些题目得分大幅回落，说明当前改动方向存在较大分歧，系统便会自动收紧下一轮允许修改的文档块数，迫使模型转向局部微调。
- **严格均分门控**：只有当候选 `SKILL.md` 在 5 道训练题上的平均得分相比当前版本严格上升时，才会被正式采纳并替换当前版本，否则拒绝该次修改并保留原版本。全部迭代完成后，最后一次被采纳的 `SKILL.md` 即作为最终训练产物导出。

具体而言，在第 <i>t</i> 轮迭代中，设第 <i>i</i> 道训练题在修改前与修改后的归一化得分分别为 <i>s<sub>i</sub></i><sup>curr</sup> 与 <i>s<sub>i</sub></i><sup>cand</sup>，则该题的得分变化量为 Δ<sub><i>i</i></sub> = <i>s<sub>i</sub></i><sup>cand</sup> − <i>s<sub>i</sub></i><sup>curr</sup>。记 <i>n</i> = 5 道训练题得分变化量的算术平均值为 Δ̄，本轮修改在各题间引起的分差样本方差为：

<p align="center"><i>σ</i><sub>Δ</sub><sup>2</sup> = (1 / (<i>n</i> − 1)) ∑<sub><i>i</i>=1..<i>n</i></sub> (Δ<sub><i>i</i></sub> − Δ̄)<sup>2</sup></p>

算法以平滑系数 <i>β</i><sub>2</sub> = 0.9 维护该方差的指数移动平均 <i>V<sub>t</sub></i>（初值 <i>V</i><sub>0</sub> = 0），并据此计算下一轮允许修改的最大差异块数 <i>B</i><sub><i>t</i>+1</sub>：

<p align="center"><i>V<sub>t</sub></i> = <i>β</i><sub>2</sub> <i>V</i><sub><i>t</i>−1</sub> + (1 − <i>β</i><sub>2</sub>) <i>σ</i><sub>Δ</sub><sup>2</sup>， <i>B</i><sub><i>t</i>+1</sub> = max(<i>B</i><sub>min</sub>, round(<i>B</i><sub>base</sub> · (1 − clip(<i>V<sub>t</sub></i> / <i>V</i><sub>cap</sub>, 0, 1))))</p>

其中基础预算 <i>B</i><sub>base</sub> = 4，最小预算 <i>B</i><sub>min</sub> = 1，方差上限 <i>V</i><sub>cap</sub> = 0.1。当累计波动率 <i>V<sub>t</sub></i> 增大时，下一轮允许修改的块数从默认的 4 块收缩至 1～2 块，当各题提分效果平稳一致时，修改预算随之恢复。

下图与表格展示了实验中“工程项目组合分析”、“医保审核”和“法院书记员业务”三个子 Benchmark 在连续训练容器内的真实得分演进过程（百分制）：

<figure class="post-figure" data-figure="skilladam-progression"> <svg class="fig-svg" viewBox="0 0 560 220" role="img" aria-labelledby="gdpevo-self-evolution-skilladam-progression-zh-title"> <title id="gdpevo-self-evolution-skilladam-progression-zh-title">三个子 Benchmark 在连续训练容器内的五题平均得分演进曲线</title> <path d="M56 28H532M56 68H532M56 108H532M56 148H532" class="fig-link"/> <path d="M56 28V168H532" class="fig-axis"/> <text x="46" y="32" text-anchor="end" class="fig-tick">100</text> <text x="46" y="72" text-anchor="end" class="fig-tick">80</text> <text x="46" y="112" text-anchor="end" class="fig-tick">60</text> <text x="46" y="152" text-anchor="end" class="fig-tick">40</text> <text x="96" y="188" text-anchor="middle" class="fig-label">无技能初测</text> <text x="224" y="188" text-anchor="middle" class="fig-label">初版 Skill</text> <text x="352" y="188" text-anchor="middle" class="fig-label">第 1 轮迭代</text> <text x="480" y="188" text-anchor="middle" class="fig-label">第 2 轮迭代</text> <path d="M96 129.5L224 78.3L352 33.3L480 28.0" class="fig-edge"/> <circle cx="96" cy="129.5" r="4" class="fig-s1"/> <circle cx="224" cy="78.3" r="4" class="fig-s1"/> <circle cx="352" cy="33.3" r="4" class="fig-s1"/> <circle cx="480" cy="28.0" r="4" class="fig-s1"/> <text x="96" y="145" text-anchor="middle" class="fig-num">49.24</text> <text x="224" y="94" text-anchor="middle" class="fig-num">74.86</text> <text x="352" y="23" text-anchor="middle" class="fig-num">97.33</text> <text x="480" y="19" text-anchor="middle" class="fig-num">100.00</text> <path d="M96 61.9L224 40.3L352 40.2L480 39.2" class="fig-edge"/> <rect x="92" y="57.9" width="8" height="8" rx="1" class="fig-s2"/> <rect x="220" y="36.3" width="8" height="8" rx="1" class="fig-s2"/> <rect x="348" y="36.2" width="8" height="8" rx="1" class="fig-s2"/> <rect x="476" y="35.2" width="8" height="8" rx="1" class="fig-s2"/> <text x="96" y="52" text-anchor="middle" class="fig-num">83.07</text> <text x="224" y="31" text-anchor="middle" class="fig-num">93.87</text> <text x="352" y="54" text-anchor="middle" class="fig-num">93.93</text> <text x="510" y="43" text-anchor="start" class="fig-num">94.40</text> <path d="M96 88.9L224 68.7L352 68.5L480 57.2" class="fig-edge"/> <circle cx="96" cy="88.9" r="4" class="fig-s3"/> <circle cx="224" cy="68.7" r="4" class="fig-s3"/> <circle cx="352" cy="68.5" r="4" class="fig-s3"/> <circle cx="480" cy="57.2" r="4" class="fig-s3"/> <text x="96" y="104" text-anchor="middle" class="fig-num">69.54</text> <text x="224" y="61" text-anchor="middle" class="fig-num">79.67</text> <text x="352" y="83" text-anchor="middle" class="fig-num">79.74</text> <text x="480" y="73" text-anchor="middle" class="fig-num">85.42</text> <circle cx="110" cy="210" r="4" class="fig-s1"/> <text x="120" y="214" class="fig-label">工程项目组合分析</text> <rect x="246" y="206" width="8" height="8" rx="1" class="fig-s2"/> <text x="260" y="214" class="fig-label">医保审核</text> <circle cx="350" cy="210" r="4" class="fig-s3"/> <text x="360" y="214" class="fig-label">法院书记员业务</text> </svg> <ol class="fig-steps"> <li>工程项目组合分析：无技能初测 49.24，初版 Skill 74.86，第 1 轮迭代 97.33，第 2 轮迭代 100.00</li> <li>医保审核：无技能初测 83.07，初版 Skill 93.87，第 1 轮迭代 93.93，第 2 轮迭代 94.40</li> <li>法院书记员业务：无技能初测 69.54，初版 Skill 79.67，第 1 轮迭代 79.74，第 2 轮迭代 85.42</li> </ol> <figcaption>三个子 Benchmark 在连续训练容器内的五题平均分变化（百分制）：从无技能初测到提炼初版技能，再经两轮迭代实现提升。</figcaption> </figure>

| Benchmark | 无技能初测 | 初版 Skill | 第 1 轮迭代 | 第 2 轮迭代 | 最终保留得分 |
| :--- | ---: | ---: | ---: | ---: | ---: |
| 工程项目组合分析 | 49.24 | 74.86 | 97.33 (采纳) | 100.00 (采纳) | 100.00 |
| 医保审核 | 83.07 | 93.87 | 93.93 (采纳) | 94.40 (采纳) | 94.40 |
| 法院书记员业务 | 69.54 | 79.67 | 79.74 (采纳) | 85.42 (采纳) | 85.42 |

可以看到，在工程项目组合分析、医保审核与法院书记员业务三个 Benchmark 中，Agent 从无技能初测的 49.24 分、83.07 分和 69.54 分出发，提炼出初版 `SKILL.md` 后得分明显提升，再经过两轮迭代修改，训练均分分别达到 100.00 分、94.40 分和 85.42 分。

除 SkillAdam 外，本次实验还同步评测了另外三种代表性自进化方法，四者的原论文与核心机制对比如下：

| 方法名称 | 原论文 | 插件标识 | 容器内学习与选版方式 |
| :--- | :--- | :--- | :--- |
| SkillAdam | [arXiv:2609.08944](https://arxiv.org/abs/2609.08944v1) | `skilladam-rsi-toolkit` | 结合演进问题追踪器与分差方差自适应预算迭代修改，导出严格提升训练均分的最后一个采纳版本 |
| SkillOpt | [arXiv:2605.23904](https://arxiv.org/abs/2605.23904v1) | `skillopt-rsi-toolkit` | 分批反思成功与失败轨迹，合并局部修改提案并按余弦退火预算更新，导出训练集得分最高的采纳版本 |
| TRACE | [arXiv:2608.22793](https://arxiv.org/abs/2608.22793v2) | `trace-rsi-toolkit` | 策展者与执行者双角色协同：执行者解题，策展者从轨迹中提炼模块化技能库，按完整训练批次最高均分选版 |
| OpenSkill | [arXiv:2606.06741](https://arxiv.org/abs/2606.06741v1) | `openskill-rsi-toolkit` | 不使用在线训练评分接口，通过检索领域知识并构造独立虚拟测试来迭代修复技能，导出最后一个有效版本 |

## 3. 在 PenguinHarness Web 界面启动实验

在 PenguinHarness 中开展 GDPEVO 自进化实验，不需要编写底层调度脚本。我们可以直接从新建一个主控 Agent 开始，为其挂载对应的 RSI 工具包插件，再通过对话发起实验。

### 第一步：新建主控 Agent 并挂载 RSI 工具包

1. 打开 Web 界面左侧的 **Agents** 页面，点击右上角的**手动创建**（`Create manually`）。
2. 填写智能体名称（例如 `GDPEVO Controller`）与标识（例如 `gdpevo_controller`）。
3. 在创建弹窗的**插件**（`Plugins`）下拉列表中搜索 `skill`，勾选 `skilladam-rsi-toolkit`（如需对比其他方法，也可一并勾选 `skillopt-rsi-toolkit`、`trace-rsi-toolkit` 或 `openskill-rsi-toolkit`），点击**创建**（`Create`）。

<img src="/blog-screenshots/gdpevo-create-agent.webp" width="2160" height="1760" alt="在 Create agent 弹窗中填写 GDPEVO Controller 并搜索勾选 skilladam-rsi-toolkit 插件" />

### 第二步：进入该 Agent 的对话界面并配置模型

创建完成后，直接在 **Agents** 列表的 `GDPEVO Controller` 卡片右侧点击 **`+ New chat`** 进入它的专属对话界面，在输入框下方将模型选为 `DeepSeek V4.1 Flash`，并将思考强度调为 `max`。

<img src="/blog-screenshots/gdpevo-configure-model.webp" width="1676" height="830" alt="在 GDPEVO Controller 的对话界面选定 DeepSeek V4.1 Flash 模型与 max 思考强度" />

### 第三步：选择工具包并发送启动指令

由于“单容器连续训练一次、冻结导出 `SKILL.md`、在测试集上对 Baseline 与 Final 各重复测试 3 轮”以及具体的任务路径和评分规则均已内置在 `skilladam-rsi-toolkit` 与 Benchmark 包说明中，启动指令无需重复描述实验流程，只需在输入框中通过 `/skilladam-rsi-toolkit`（或点击技能图标）挂载工具包，并指明工具包名称、目标 Benchmark、模型与思考强度以及 Docker 并发上限即可。

如果只跑单个 Benchmark（以 `service-ticket-resolution` 为例），在聊天框输入：

> 使用 `skilladam-rsi-toolkit`，在 GDPEVO Essential 的 `service-ticket-resolution` Benchmark 上开展自进化实验。模型使用 `DeepSeek V4.1 Flash`，思考强度 `max`，Docker 并发上限 `4`。

如果直接开展 GDPEVO Essential 系列全部六个子 Benchmark 的实验，在聊天框输入：

> 使用 `skilladam-rsi-toolkit`，在 GDPEVO Essential 系列的全部六个 Benchmark 上开展自进化实验。模型使用 `DeepSeek V4.1 Flash`，思考强度 `max`，Docker 并发上限 `4`。

如果要评测其他自进化算法，只需将挂载的技能与指令中的 `skilladam-rsi-toolkit` 替换为 `skillopt-rsi-toolkit`、`trace-rsi-toolkit` 或 `openskill-rsi-toolkit`。

> **TODO（配图占位 3 — 挂载 `skilladam-rsi-toolkit` 并发送启动指令）**：此处预留截图，展示在聊天输入框中挂载 `skilladam-rsi-toolkit` 技能标签并输入上述启动指令的界面。

## 4. 实验启动后的内部执行流程

在 Web 界面发送启动指令后，**主控 Agent** 会在后台自动按以下四个阶段完成训练与测试：

<figure class="post-figure" data-widget="gdpevo-orchestration"><ol class="fig-steps"><li>多轮训练循环：主控 Agent 通过 Harbor 拉起 1 Shared Docker，目标 Agent 在 T1–T5 上完成多轮演进</li><li>产出进化 Agent：训练结束后导出并锁定只读 SKILL.md，装配为进化 Agent</li><li>多轮隔离测试：主控 Agent 通过 Harbor 调度一分五并发测试，在 Isolated Dockers 中对 Test 1–5 各独立运行 3 轮</li><li>离线判分出分：五合一汇入离线评分器，统计各题得分与最终均分</li></ol><figcaption>主控 Agent 在后台自动执行的四阶段实验流程。</figcaption></figure>

### 1. 多轮训练循环

任务环境准备就绪后，**主控 Agent** 先保留一份不挂载任何业务技能的初始状态作为基线对照（Baseline），同时通过 **Harbor** 为当前 Benchmark 拉起一个共享训练容器。Docker 为该 Benchmark 提供了完整的环境隔离：业务后端服务、任务数据与在线评分接口均运行在容器内部。**目标 Agent** 在该共享容器的同一个持久会话中按顺序循环试做 5 道训练题，经历多轮诊断与迭代修改。

### 2. 产出进化 Agent

当共享容器内的多轮训练循环结束后，**主控 Agent** 收集最后一次被采纳的 `SKILL.md` 并锁定其写入权限，将其作为只读技能挂载到干净的初始状态上，生成冻结的**进化 Agent**。

### 3. 多轮隔离测试

**主控 Agent** 通过 **Harbor** 将**进化 Agent**（以及基线对照状态）投放到该 Benchmark 的 5 道保留测试题上，完整重复运行 3 轮测试（单个 Benchmark 共 15 个独立测试容器）。在测试阶段，每一道题目的每一次作答均在全新的 Docker 容器与空白会话中独立运行，不同题目与不同轮次之间互不共享文件系统、数据库状态或会话历史，且容器内关闭在线训练评分接口。

### 4. 离线判分出分

所有测试容器运行完毕后，各题作答结果汇入**离线评分器**统一判分，逐题计算百分制得分，并汇总得出最终均分与标准差（如 `68.95 ± 0.74`）。

## 5. 结果统计与实测数据

实验的分数与开销按以下两级聚合规则统计：

- **单 Benchmark 测试得分**：设第 <i>r</i> 轮测试（<i>r</i> ∈ {1, 2, 3}）中第 <i>q</i> 道测试题（<i>q</i> ∈ {1..5}）的得分为 <i>s<sub>r,q</sub></i>。先计算每一轮测试内 5 道题的平均分 <i>s̄<sub>r</sub></i> = (1/5) ∑<sub><i>q</i>=1..5</sub> <i>s<sub>r,q</sub></i>，再对 3 轮测试的均分计算均值 <i>μ</i> = (1/3) ∑<sub><i>r</i>=1..3</sub> <i>s̄<sub>r</sub></i> 与样本标准差 <i>s</i> = √((1/2) ∑<sub><i>r</i>=1..3</sub> (<i>s̄<sub>r</sub></i> − <i>μ</i>)<sup>2</sup>)。
- **系列总体得分**：在每一轮测试 <i>r</i> 内，先对 6 个子 Benchmark 的单轮均分求等权平均得到该轮总体均分 <i>S̄<sub>r</sub></i> = (1/6) ∑<sub><i>d</i>=1..6</sub> <i>s̄<sub>r,d</sub></i>，再对 3 轮总体均分计算均值与样本标准差。
- **费用与耗时**：训练阶段每个 Benchmark 只跑 1 次，直接汇总 6 个子 Benchmark 实际产生的总费用与总耗时。测试阶段共跑 3 轮，表中展示的测试费用与耗时为“3 轮完整测试合计除以 3”，即完成全系列一轮完整测试（30 道测试题）的平均开销。费用按 MMSP 的统一计费标准核算。

四种方法与统一基线在 GDPEVO Essential 系列六个 Benchmark 上的总体结果如下：

| 方法 | 总体测试得分 (均分 ± 标准差) | 相比 Baseline 提升 | 训练总费用 | 训练总耗时 | 单轮测试平均费用 | 单轮测试平均耗时 |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | 56.32 ± 2.17 | — | — | — | $2.51 | 5h 20m |
| SkillOpt | 70.25 ± 0.03 | +13.93 | $3.89 | 4h 53m | $1.95 | 4h 30m |
| SkillAdam | 68.95 ± 0.74 | +12.63 | $5.45 | 4h 19m | $2.06 | 3h 44m |
| TRACE | 68.02 ± 1.80 | +11.69 | $5.29 | 3h 26m | $1.67 | 3h 37m |
| OpenSkill | 62.16 ± 2.31 | +5.83 | $5.56 | 8h 15m | $2.63 | 4h 45m |

六个子 Benchmark 的分项测试得分（均分 ± 标准差）如下：

| Benchmark | Baseline | SkillAdam | SkillOpt | TRACE | OpenSkill |
| :--- | ---: | ---: | ---: | ---: | ---: |
| 服务工单处理 | 48.90 ± 10.06 | 65.78 ± 0.00 (+16.88) | 69.95 ± 6.30 (+21.05) | 59.38 ± 3.85 (+10.49) | 61.46 ± 0.28 (+12.57) |
| 财务管控 | 50.97 ± 1.08 | 63.89 ± 4.42 (+12.93) | 58.03 ± 7.14 (+7.07) | 62.56 ± 1.55 (+11.59) | 52.45 ± 9.15 (+1.48) |
| 投资组合管理 | 70.16 ± 2.10 | 74.25 ± 1.28 (+4.09) | 77.40 ± 3.18 (+7.24) | 74.55 ± 8.71 (+4.39) | 74.27 ± 4.90 (+4.11) |
| 医保审核 | 55.00 ± 0.00 | 80.67 ± 0.58 (+25.67) | 71.00 ± 0.00 (+16.00) | 68.67 ± 0.58 (+13.67) | 73.67 ± 2.52 (+18.67) |
| 法院书记员业务 | 52.60 ± 1.68 | 55.37 ± 2.32 (+2.77) | 61.98 ± 1.41 (+9.39) | 51.43 ± 1.69 (−1.17) | 50.55 ± 2.65 (−2.04) |
| 工程项目组合分析 | 60.32 ± 5.11 | 73.74 ± 0.00 (+13.42) | 83.15 ± 0.00 (+22.83) | 91.52 ± 1.57 (+31.19) | 60.55 ± 3.08 (+0.23) |

## 6. 实验洞察与讨论（待补充）

> **TODO（Insights 占位符）**：本节预留用于后续补充本次 GDPEVO Essential 系列 Benchmark 自进化实验的核心洞察与深入分析（例如不同子 Benchmark 下的技能提炼特性、有监督在线评分反馈与无监督虚拟测试的边界对比、以及演进后推理步数与成本下降的机理讨论）。
