---
title: "用 PenguinHarness 在真实企业任务上跑通 Agent 自进化实验闭环"
date: 2026-11-04
category: practice
author: Leijun Zhou (Prism Shadow AI)
excerpt: "在 PenguinHarness 0.2.19 中使用内置的 GDPEVO Essential 系列 Benchmark（包含六个子 Benchmark，共 30 道训练题与 30 道测试题），对比评测 SkillAdam、SkillOpt、TRACE 与 OpenSkill 四种 Agent 自进化方法。"
---

本文介绍如何使用 PenguinHarness 0.2.19 在 GDPEVO Essential 系列 Benchmark 上开展 Agent 自进化实验。实验中基座模型固定为 DeepSeek-V4.1-Flash-1017，思考强度设为 max，系统对比了 SkillAdam、SkillOpt、TRACE 和 OpenSkill 四种自进化方法。下文将依次说明 GDPEVO Essential 系列 Benchmark 的构成与评测规则、自进化方法的核心机制、Web 界面的实验启动方式、系统内部的执行流程以及最终的实测结果。

## 1. Benchmark 构成与评测规则

GDPEVO Essential 源自 [GDPevo Benchmark](https://arxiv.org/abs/2608.03764)，是一套面向真实企业任务与 Agent 自进化能力评测的系列 Benchmark，由六个独立的子 Benchmark 组成。每一个子 Benchmark 都是一个完整的评测单元，内部包含 5 道训练题、5 道保留测试题以及一个配套的交互式训练评测环境，全系列合计包含 30 道训练题与 30 道测试题：

| Benchmark 名称 | Benchmark 标识 | 单个子 Benchmark 构成 | 任务概述 |
| :--- | :--- | :--- | :--- |
| 服务工单处理 | [service-ticket-resolution](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/data/penguinharness-benchmark-gdpevo-essential-service-ticket-resolution-train) | 5 训练题 + 5 测试题 + 评测环境 | 查询客服后台记录，核实并处理待办工单 |
| 财务管控 | [financial-control](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/data/penguinharness-benchmark-gdpevo-essential-financial-control-train) | 5 训练题 + 5 测试题 + 评测环境 | 根据财务系统数据完成账目核对与结账核算 |
| 投资组合管理 | [portfolio-management](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/data/penguinharness-benchmark-gdpevo-essential-portfolio-management-train) | 5 训练题 + 5 测试题 + 评测环境 | 读取资管平台数据，计算持仓估值与调仓方案 |
| 医保审核 | [coverage-review](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/data/penguinharness-benchmark-gdpevo-essential-coverage-review-train) | 5 训练题 + 5 测试题 + 评测环境 | 对照医保条款与申报材料，给出理赔审核结论 |
| 法院书记员业务 | [court-clerk-operations](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/data/penguinharness-benchmark-gdpevo-essential-court-clerk-operations-train) | 5 训练题 + 5 测试题 + 评测环境 | 核对立案卷宗材料，整理案件排期与归档信息 |
| 工程项目组合分析 | [engineering-portfolio-analytics](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/data/penguinharness-benchmark-gdpevo-essential-engineering-portfolio-analytics-train) | 5 训练题 + 5 测试题 + 评测环境 | 汇总多项工程的进度与资源数据，输出组合分析结果 |

每个子 Benchmark 的评测环境中都隐藏着未在题面直接写明的企业业务规则，例如优先级策略、风控阈值与异常处理口径。Agent 需要在训练环境中与业务系统交互，根据评分反馈学会这些企业规则并总结到 SKILL.md 中，才能在测试题上取得高分。

在本次实验中，每个子 Benchmark 的实验均遵循以下三项设定：

- **按 Benchmark 独立训练与测试**：六个子 Benchmark 彼此独立，每个 Benchmark 单独开展训练并产出一份专属的 SKILL.md 技能文档，不同 Benchmark 之间不混合训练数据，也不共享习得的技能。
- **训练阶段**：同一个 Benchmark 的 5 道训练题在同一个业务容器与同一个连续会话中完成，限时 6 小时，中途不重置环境或工作区。训练容器在本地回环端口提供只读业务后端服务，并内置在线评分接口 POST /api/judge 供 Agent 在演进过程中获取得分与诊断反馈。具体是否调用该接口由自进化方法本身决定，例如有监督方法会借此引导技能修订，而无监督方法则完全依靠自建的虚拟测试进行演进。
- **测试阶段**：训练产出的 SKILL.md 一经导出即被冻结，随后在该 Benchmark 的 5 道保留测试题上完整重复评测 3 轮，单题限时 4 小时。每一道测试题的每一次作答均在全新的隔离容器与空白会话中独立运行，且关闭一切在线训练反馈接口，待作答结束后由离线评分器统一判分。

## 2. 自进化方法：以 SkillAdam 为例

在本次实验中，我们将 SkillAdam、SkillOpt、TRACE 与 OpenSkill 四种近期学术界的自进化工作复现并适配为 PenguinHarness 的内置方法插件，以便在统一的业务容器与评分标准下横向评测它们的效果。

这里以我们适配的 SkillAdam 为例说明容器内的演进过程。在连续训练环境中，目标 Agent 需要根据 5 道训练题的反馈不断修订 SKILL.md。如果直接让模型在每轮之后自由改写整份文档，实践中很容易遇到两类问题：一是缺乏对历史失败修改的记录，模型容易在已被证伪的方向上反复尝试，二是单次改动的步幅难以控制，为了修好某一道题的局部问题，常常把原本在其他题目上生效的规则改坏。

针对这两个痛点，SkillAdam 原论文借鉴了深度学习中 Adam 优化器“一阶动量 + 二阶方差自适应步长”的设计思路。在我们的插件适配中，训练容器内的目标 Agent 按以下四步闭环迭代演进 SKILL.md：

<figure class="post-figure" data-widget="skilladam-loop"><ol class="fig-steps"><li>五题试跑测分差：目标 Agent 完成 T1–T5 试跑并统计各题分差</li><li>严格均分门控：对比本轮均分与当前最佳，严格提升时采纳晋级</li><li>Adam 状态更新：同步更新一阶 EIT 问题账本与二阶方差编辑预算 Bt</li><li>局部微调 SKILL.md：仅在额度允许的范围内局部修改并输出新版 SKILL.md</li></ol><figcaption>SkillAdam 的四阶段演进闭环。</figcaption></figure>

- **无技能初测与初版提炼**：训练启动后，Agent 首先在不挂载任何业务技能的状态下完成 5 道训练题的初次尝试，根据执行轨迹与评分反馈提炼出初版 SKILL.md。在随后的每一轮迭代中，Agent 均使用当前或候选技能文档在训练题上实测作答，收集各题得分、新旧分差与具体失误原因。
- **演进问题追踪器（EIT）**：算法在迭代全程维护一份问题账本，持续追踪训练题中暴露的错误模式、历次尝试过的修复方案及其实际效果。即便某一轮提出的候选修改最终因为没有提分而被拒绝，这次失败尝试的记录也会更新回 EIT 中，避免后续轮次重复无效修改。
- **方差自适应编辑预算**：每当候选版本在 5 道训练题上完成实测后，算法会评估该次修改在不同题目上引起的得分波动。如果一次修改让部分题目得分上升，却让另一些题目得分大幅回落，说明当前改动方向存在较大分歧，系统便会自动收紧下一轮允许修改的文档块数，迫使模型转向局部微调。
- **严格均分门控**：只有当候选 SKILL.md 在 5 道训练题上的平均得分相比当前版本严格上升时，才会被正式采纳并替换当前版本，否则拒绝该次修改并保留原版本。全部迭代完成后，最后一次被采纳的 SKILL.md 即作为最终训练产物导出。

具体而言，在第 <math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>t</mi></mrow></math> 轮迭代中，设第 <math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>i</mi></mrow></math> 道训练题在修改前与修改后的归一化得分分别为 <math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><msubsup><mi>s</mi><mi>i</mi><mrow><mi mathvariant="normal">c</mi><mi mathvariant="normal">u</mi><mi mathvariant="normal">r</mi><mi mathvariant="normal">r</mi></mrow></msubsup></mrow></math> 与 <math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><msubsup><mi>s</mi><mi>i</mi><mrow><mi mathvariant="normal">c</mi><mi mathvariant="normal">a</mi><mi mathvariant="normal">n</mi><mi mathvariant="normal">d</mi></mrow></msubsup></mrow></math>，则该题的得分变化量为 <math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><msub><mi mathvariant="normal">Δ</mi><mi>i</mi></msub><mo>=</mo><msubsup><mi>s</mi><mi>i</mi><mrow><mi mathvariant="normal">c</mi><mi mathvariant="normal">a</mi><mi mathvariant="normal">n</mi><mi mathvariant="normal">d</mi></mrow></msubsup><mo>−</mo><msubsup><mi>s</mi><mi>i</mi><mrow><mi mathvariant="normal">c</mi><mi mathvariant="normal">u</mi><mi mathvariant="normal">r</mi><mi mathvariant="normal">r</mi></mrow></msubsup></mrow></math>。记 <math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>n</mi><mo>=</mo><mn>5</mn></mrow></math> 道训练题得分变化量的算术平均值为 <math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mover accent="true"><mi mathvariant="normal">Δ</mi><mo>ˉ</mo></mover></mrow></math>，本轮修改在各题间引起的分差样本方差为：

<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mrow><msubsup><mi>σ</mi><mi mathvariant="normal">Δ</mi><mn>2</mn></msubsup><mo>=</mo><mfrac><mn>1</mn><mrow><mi>n</mi><mo>−</mo><mn>1</mn></mrow></mfrac><munderover><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover><mo stretchy="false">(</mo><msub><mi mathvariant="normal">Δ</mi><mi>i</mi></msub><mo>−</mo><mover accent="true"><mi mathvariant="normal">Δ</mi><mo>ˉ</mo></mover><msup><mo stretchy="false">)</mo><mn>2</mn></msup></mrow></math>

算法以平滑系数 <math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><msub><mi>β</mi><mn>2</mn></msub><mo>=</mo><mn>0.9</mn></mrow></math> 维护该方差的指数移动平均 <math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><msub><mi>V</mi><mi>t</mi></msub></mrow></math>，初值 <math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><msub><mi>V</mi><mn>0</mn></msub><mo>=</mo><mn>0</mn></mrow></math>，并据此计算下一轮允许修改的最大差异块数 <math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><msub><mi>B</mi><mrow><mi>t</mi><mo>+</mo><mn>1</mn></mrow></msub></mrow></math>：

<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mrow><msub><mi>V</mi><mi>t</mi></msub><mo>=</mo><msub><mi>β</mi><mn>2</mn></msub><msub><mi>V</mi><mrow><mi>t</mi><mo>−</mo><mn>1</mn></mrow></msub><mo>+</mo><mo stretchy="false">(</mo><mn>1</mn><mo>−</mo><msub><mi>β</mi><mn>2</mn></msub><mo stretchy="false">)</mo><msubsup><mi>σ</mi><mi mathvariant="normal">Δ</mi><mn>2</mn></msubsup><mo separator="true">,</mo><mspace width="2em"/><msub><mi>B</mi><mrow><mi>t</mi><mo>+</mo><mn>1</mn></mrow></msub><mo>=</mo><mi>max</mi><mo>⁡</mo><mtext> ⁣</mtext><mrow><mo fence="true">(</mo><msub><mi>B</mi><mi>min</mi><mo>⁡</mo></msub><mo separator="true">,</mo><mtext>  </mtext><mi mathvariant="normal">round</mi><mo>⁡</mo><mtext> ⁣</mtext><mrow><mo fence="true">(</mo><msub><mi>B</mi><mrow><mi mathvariant="normal">b</mi><mi mathvariant="normal">a</mi><mi mathvariant="normal">s</mi><mi mathvariant="normal">e</mi></mrow></msub><mo>⋅</mo><mrow><mo fence="true">(</mo><mn>1</mn><mo>−</mo><mi mathvariant="normal">clip</mi><mo>⁡</mo><mtext> ⁣</mtext><mrow><mo fence="true">(</mo><mfrac><msub><mi>V</mi><mi>t</mi></msub><msub><mi>V</mi><mrow><mi mathvariant="normal">c</mi><mi mathvariant="normal">a</mi><mi mathvariant="normal">p</mi></mrow></msub></mfrac><mo separator="true">,</mo><mn>0</mn><mo separator="true">,</mo><mn>1</mn><mo fence="true">)</mo></mrow><mo fence="true">)</mo></mrow><mo fence="true">)</mo></mrow><mo fence="true">)</mo></mrow></mrow></math>

其中基础预算 <math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><msub><mi>B</mi><mrow><mi mathvariant="normal">b</mi><mi mathvariant="normal">a</mi><mi mathvariant="normal">s</mi><mi mathvariant="normal">e</mi></mrow></msub><mo>=</mo><mn>4</mn></mrow></math>，最小预算 <math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><msub><mi>B</mi><mi>min</mi><mo>⁡</mo></msub><mo>=</mo><mn>1</mn></mrow></math>，方差上限 <math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><msub><mi>V</mi><mrow><mi mathvariant="normal">c</mi><mi mathvariant="normal">a</mi><mi mathvariant="normal">p</mi></mrow></msub><mo>=</mo><mn>0.1</mn></mrow></math>。当累计波动率 <math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><msub><mi>V</mi><mi>t</mi></msub></mrow></math> 增大时，下一轮允许修改的块数从默认的 4 块收缩至 1～2 块，当各题提分效果平稳一致时，修改预算随之恢复。

下图与表格展示了实验中“工程项目组合分析”、“医保审核”和“法院书记员业务”三个子 Benchmark 在连续训练容器内的真实得分演进过程（百分制）：

<figure class="post-figure" data-figure="skilladam-progression"> <svg class="fig-svg" viewBox="0 0 560 284" role="img" aria-labelledby="gdpevo-self-evolution-skilladam-progression-zh-title"> <title id="gdpevo-self-evolution-skilladam-progression-zh-title">三个子 Benchmark 在连续训练容器内的五题平均得分演进曲线</title> <path d="M56 32H532M56 100H532M56 168H532M56 236H532" class="fig-link"/> <path d="M56 32V236H532" class="fig-axis"/> <text x="46" y="36" text-anchor="end" class="fig-tick">100</text> <text x="46" y="104" text-anchor="end" class="fig-tick">80</text> <text x="46" y="172" text-anchor="end" class="fig-tick">60</text> <text x="46" y="240" text-anchor="end" class="fig-tick">40</text> <text x="96" y="256" text-anchor="middle" class="fig-label">无技能初测</text> <text x="224" y="256" text-anchor="middle" class="fig-label">初版 Skill</text> <text x="352" y="256" text-anchor="middle" class="fig-label">第 1 轮迭代</text> <text x="480" y="256" text-anchor="middle" class="fig-label">第 2 轮迭代</text> <path d="M96 204.6L224 117.5L352 41.1L480 32.0" fill="none" stroke-width="1.75" class="stroke-brand-500 dark:stroke-brand-400"/> <circle cx="96" cy="204.6" r="3.5" class="fill-brand-600 dark:fill-brand-400"/> <circle cx="224" cy="117.5" r="3.5" class="fill-brand-600 dark:fill-brand-400"/> <circle cx="352" cy="41.1" r="3.5" class="fill-brand-600 dark:fill-brand-400"/> <circle cx="480" cy="32.0" r="3.5" class="fill-brand-600 dark:fill-brand-400"/> <text x="96" y="221" text-anchor="middle" class="fig-num">49.24</text> <text x="224" y="134" text-anchor="middle" class="fig-num">74.86</text> <text x="352" y="29" text-anchor="middle" class="fig-num">97.33</text> <text x="480" y="20" text-anchor="middle" class="fig-num">100.00</text> <path d="M96 89.6L224 52.8L352 52.6L480 51.0" fill="none" stroke-width="1.75" class="stroke-emerald-500 dark:stroke-emerald-400"/> <circle cx="96" cy="89.6" r="3.5" class="fill-emerald-600 dark:fill-emerald-400"/> <circle cx="224" cy="52.8" r="3.5" class="fill-emerald-600 dark:fill-emerald-400"/> <circle cx="352" cy="52.6" r="3.5" class="fill-emerald-600 dark:fill-emerald-400"/> <circle cx="480" cy="51.0" r="3.5" class="fill-emerald-600 dark:fill-emerald-400"/> <text x="96" y="78" text-anchor="middle" class="fig-num">83.07</text> <text x="224" y="41" text-anchor="middle" class="fig-num">93.87</text> <text x="352" y="68" text-anchor="middle" class="fig-num">93.93</text> <text x="480" y="66" text-anchor="middle" class="fig-num">94.40</text> <path d="M96 135.6L224 101.1L352 100.9L480 81.6" fill="none" stroke-width="1.75" class="stroke-amber-500 dark:stroke-amber-400"/> <circle cx="96" cy="135.6" r="3.5" class="fill-amber-500 dark:fill-amber-400"/> <circle cx="224" cy="101.1" r="3.5" class="fill-amber-500 dark:fill-amber-400"/> <circle cx="352" cy="100.9" r="3.5" class="fill-amber-500 dark:fill-amber-400"/> <circle cx="480" cy="81.6" r="3.5" class="fill-amber-500 dark:fill-amber-400"/> <text x="96" y="152" text-anchor="middle" class="fig-num">69.54</text> <text x="224" y="90" text-anchor="middle" class="fig-num">79.67</text> <text x="352" y="117" text-anchor="middle" class="fig-num">79.74</text> <text x="480" y="98" text-anchor="middle" class="fig-num">85.42</text> <circle cx="110" cy="274" r="3.5" class="fill-brand-600 dark:fill-brand-400"/> <text x="120" y="278" class="fig-label">工程项目组合分析</text> <circle cx="250" cy="274" r="3.5" class="fill-emerald-600 dark:fill-emerald-400"/> <text x="260" y="278" class="fig-label">医保审核</text> <circle cx="350" cy="274" r="3.5" class="fill-amber-500 dark:fill-amber-400"/> <text x="360" y="278" class="fig-label">法院书记员业务</text> </svg> <ol class="fig-steps"> <li>工程项目组合分析：无技能初测 49.24，初版 Skill 74.86，第 1 轮迭代 97.33，第 2 轮迭代 100.00</li> <li>医保审核：无技能初测 83.07，初版 Skill 93.87，第 1 轮迭代 93.93，第 2 轮迭代 94.40</li> <li>法院书记员业务：无技能初测 69.54，初版 Skill 79.67，第 1 轮迭代 79.74，第 2 轮迭代 85.42</li> </ol> <figcaption>三个子 Benchmark 在连续训练容器内的五题平均分变化（百分制）：从无技能初测到提炼初版技能，再经两轮迭代实现提升。</figcaption> </figure>

| Benchmark | 无技能初测 | 初版 Skill | 第 1 轮迭代 | 第 2 轮迭代 | 最终保留得分 |
| :--- | ---: | ---: | ---: | ---: | ---: |
| 工程项目组合分析 | 49.24 | 74.86 | 97.33 (采纳) | 100.00 (采纳) | 100.00 |
| 医保审核 | 83.07 | 93.87 | 93.93 (采纳) | 94.40 (采纳) | 94.40 |
| 法院书记员业务 | 69.54 | 79.67 | 79.74 (采纳) | 85.42 (采纳) | 85.42 |

可以看到，在工程项目组合分析、医保审核与法院书记员业务三个 Benchmark 中，Agent 从无技能初测的 49.24 分、83.07 分和 69.54 分出发，提炼出初版 SKILL.md 后得分明显提升，再经过两轮迭代修改，训练均分分别达到 100.00 分、94.40 分和 85.42 分。

除 SkillAdam 外，本次实验还同步评测了另外三种代表性自进化方法，四者的原论文与核心机制对比如下：

| 方法名称 | 原论文 | 插件标识 | 容器内学习与选版方式 |
| :--- | :--- | :--- | :--- |
| SkillAdam | [arXiv:2609.08944](https://arxiv.org/abs/2609.08944v1) | skilladam-rsi-toolkit | 结合演进问题追踪器与分差方差自适应预算迭代修改，导出严格提升训练均分的最后一个采纳版本 |
| SkillOpt | [arXiv:2605.23904](https://arxiv.org/abs/2605.23904v1) | skillopt-rsi-toolkit | 分批反思成功与失败轨迹，合并局部修改提案并按余弦退火预算更新，导出训练集得分最高的采纳版本 |
| TRACE | [arXiv:2608.22793](https://arxiv.org/abs/2608.22793v2) | trace-rsi-toolkit | 策展者与执行者双角色协同：执行者解题，策展者从轨迹中提炼模块化技能库，按完整训练批次最高均分选版 |
| OpenSkill | [arXiv:2606.06741](https://arxiv.org/abs/2606.06741v1) | openskill-rsi-toolkit | 不使用在线训练评分接口，通过检索领域知识并构造独立虚拟测试来迭代修复技能，导出最后一个有效版本 |

## 3. 在 Web 界面启动实验

下面介绍如何在 PenguinHarness 的 Web 界面中分四步启动实验。

### 第一步：配置模型 API Key

打开左侧导航栏的 Models 页面，找到实验所要使用的模型 DeepSeek V4.1 Flash，填入对应的 API Key 并点击 Save 保存。

<img class="my-4 rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-assets/gdpevo-model-api-key.webp" width="2280" height="1600" alt="在 Models 页面的 Model settings 弹窗中配置 DeepSeek V4.1 Flash 的 API Key" />

### 第二步：新建主控 Agent

进入左侧的 Agents 页面，点击右上角的 Create manually，设置智能体的名称和 ID。接着在下方的插件下拉框中搜索 skill，勾选本次实验使用的 skilladam-rsi-toolkit，也可以同时勾选 skillopt-rsi-toolkit、trace-rsi-toolkit 和 openskill-rsi-toolkit 以便后续对比不同算法，最后点击 Create 完成创建。

<img class="my-4 rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-assets/gdpevo-create-agent.webp" width="2160" height="1760" alt="在 Create agent 弹窗中设置智能体名称与 ID 并搜索勾选自进化工具包插件" />

### 第三步：进入对话并选择模型

创建完成后，在 Agents 列表中找到刚刚创建的智能体卡片，点击右侧的 New chat 进入它的对话界面。

<img class="my-4 rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-assets/gdpevo-agent-new-chat.webp" width="2127" height="898" alt="在 Agents 列表中点击新建智能体卡片右侧的 New chat 按钮" />

进入对话界面后，在输入框下方将模型选为 DeepSeek V4.1 Flash，并将思考强度调为 max。

<img class="my-4 rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-assets/gdpevo-configure-model.webp" width="1676" height="830" alt="在对话界面选定 DeepSeek V4.1 Flash 模型与 max 思考强度" />

### 第四步：挂载工具包并启动

在聊天输入框中输入 / 呼出命令菜单并选择 skilladam-rsi-toolkit 将其挂载到当前对话，随后在指令中说明 RSI 工具包名称、目标 Benchmark、训练迭代轮数、测试重复轮数、模型、思考强度与 Docker 并发上限。其中训练迭代轮数与测试重复轮数均可按需指定，例如训练迭代设为 2 轮，测试重复默认设为 3 轮，也可改为 5 轮或 6 轮。

<img class="my-4 rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-assets/gdpevo-slash-skill.webp" width="1636" height="1035" alt="在聊天输入框中输入斜杠呼出命令菜单并选择 skilladam-rsi-toolkit" />

如果只评测单个子 Benchmark，例如 service-ticket-resolution，在聊天框输入：

> 使用 skilladam-rsi-toolkit，在 GDPEVO Essential 的 service-ticket-resolution Benchmark 上开展自进化实验，训练迭代 2 轮，测试重复 3 轮。模型使用 DeepSeek V4.1 Flash，思考强度 max，Docker 并发上限 4。

<img class="my-4 rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-assets/gdpevo-launch-single.webp" width="1615" height="495" alt="挂载 skilladam-rsi-toolkit 并输入单个子 Benchmark 的自进化实验启动指令" />

如果直接评测 GDPEVO Essential 系列的全部六个子 Benchmark，在聊天框输入：

> 使用 skilladam-rsi-toolkit，在 GDPEVO Essential 系列的全部六个 Benchmark 上开展自进化实验，训练迭代 2 轮，测试重复 3 轮。模型使用 DeepSeek V4.1 Flash，思考强度 max，Docker 并发上限 4。

<img class="my-4 rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-assets/gdpevo-launch-all.webp" width="1615" height="458" alt="挂载 skilladam-rsi-toolkit 并输入 GDPEVO Essential 全系列六个子 Benchmark 的启动指令" />

评测其他自进化算法时，只需将挂载的 RSI 工具包和指令中的 skilladam-rsi-toolkit 替换为 skillopt-rsi-toolkit、trace-rsi-toolkit 或 openskill-rsi-toolkit。

## 4. 实验内部执行流程

在 Web 界面发送启动指令后，主控 Agent 会在后台自动按以下四个阶段完成训练与测试：

<figure class="post-figure" data-widget="gdpevo-orchestration"><ol class="fig-steps"><li>多轮训练循环：主控 Agent 通过 Harbor 拉起 1 Shared Docker，目标 Agent 在 T1–T5 上完成多轮演进</li><li>产出进化 Agent：训练结束后导出并锁定只读 SKILL.md，装配为进化 Agent</li><li>多轮隔离测试：主控 Agent 通过 Harbor 调度一分五并发测试，在 Isolated Dockers 中对 Test 1–5 各独立运行 3 轮</li><li>离线判分出分：五合一汇入离线评分器，统计各题得分与最终均分</li></ol><figcaption>主控 Agent 在后台自动执行的四阶段实验流程。</figcaption></figure>

### 1. 多轮训练循环

任务环境准备就绪后，主控 Agent 先保留一份不挂载任何业务技能的初始状态作为基线对照，同时通过 Harbor 为当前 Benchmark 拉起一个共享训练容器。Docker 为该 Benchmark 提供了完整的环境隔离：业务后端服务、任务数据与在线评分接口均运行在容器内部。目标 Agent 在该共享容器的同一个持久会话中按顺序循环试做 5 道训练题，经历多轮诊断与迭代修改。

### 2. 产出进化 Agent

当共享容器内的多轮训练循环结束后，主控 Agent 收集最后一次被采纳的 SKILL.md 并锁定其写入权限，将其作为只读技能挂载到干净的初始状态上，生成冻结的进化 Agent。

### 3. 多轮隔离测试

主控 Agent 通过 Harbor 将进化 Agent 与基线状态分别投放到该 Benchmark 的 5 道保留测试题上，完整重复运行 3 轮测试。在测试阶段，每一道题目的每一次作答均在全新的 Docker 容器与空白会话中独立运行，不同题目与不同轮次之间互不共享文件系统、数据库状态或会话历史，且容器内关闭在线训练评分接口。

### 4. 离线判分出分

所有测试容器运行完毕后，各题作答结果汇入离线评分器统一判分，逐题计算百分制得分，并汇总得出最终均分与标准差。

## 5. 结果统计与实测数据

实验的分数与开销按以下两级聚合规则统计：

- **单 Benchmark 测试得分**：设第 <math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>r</mi><mo>∈</mo><mo stretchy="false">{</mo><mn>1</mn><mo separator="true">,</mo><mn>2</mn><mo separator="true">,</mo><mn>3</mn><mo stretchy="false">}</mo></mrow></math> 轮测试中第 <math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>q</mi><mo>∈</mo><mo stretchy="false">{</mo><mn>1</mn><mo separator="true">,</mo><mo>…</mo><mo separator="true">,</mo><mn>5</mn><mo stretchy="false">}</mo></mrow></math> 道测试题的得分为 <math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><msub><mi>s</mi><mrow><mi>r</mi><mo separator="true">,</mo><mi>q</mi></mrow></msub></mrow></math>。先计算每一轮测试内 5 道题的平均分 <math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><msub><mover accent="true"><mi>s</mi><mo>ˉ</mo></mover><mi>r</mi></msub><mo>=</mo><mfrac><mn>1</mn><mn>5</mn></mfrac><msubsup><mo>∑</mo><mrow><mi>q</mi><mo>=</mo><mn>1</mn></mrow><mn>5</mn></msubsup><msub><mi>s</mi><mrow><mi>r</mi><mo separator="true">,</mo><mi>q</mi></mrow></msub></mrow></math>，再对 3 轮测试的均分计算均值 <math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>μ</mi><mo>=</mo><mfrac><mn>1</mn><mn>3</mn></mfrac><msubsup><mo>∑</mo><mrow><mi>r</mi><mo>=</mo><mn>1</mn></mrow><mn>3</mn></msubsup><msub><mover accent="true"><mi>s</mi><mo>ˉ</mo></mover><mi>r</mi></msub></mrow></math> 与样本标准差 <math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>s</mi><mo>=</mo><msqrt><mrow><mfrac><mn>1</mn><mn>2</mn></mfrac><msubsup><mo>∑</mo><mrow><mi>r</mi><mo>=</mo><mn>1</mn></mrow><mn>3</mn></msubsup><mo stretchy="false">(</mo><msub><mover accent="true"><mi>s</mi><mo>ˉ</mo></mover><mi>r</mi></msub><mo>−</mo><mi>μ</mi><msup><mo stretchy="false">)</mo><mn>2</mn></msup></mrow></msqrt></mrow></math>。
- **系列总体得分**：在每一轮测试 <math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>r</mi></mrow></math> 内，先对 6 个子 Benchmark 的单轮均分求等权平均得到该轮总体均分 <math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><msub><mover accent="true"><mi>S</mi><mo>ˉ</mo></mover><mi>r</mi></msub><mo>=</mo><mfrac><mn>1</mn><mn>6</mn></mfrac><msubsup><mo>∑</mo><mrow><mi>d</mi><mo>=</mo><mn>1</mn></mrow><mn>6</mn></msubsup><msub><mover accent="true"><mi>s</mi><mo>ˉ</mo></mover><mrow><mi>r</mi><mo separator="true">,</mo><mi>d</mi></mrow></msub></mrow></math>，再对 3 轮总体均分计算均值与样本标准差。
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

## 6. 结果分析与案例研究

从上表可以看到，四种自进化方法在总体均分上全部超越了未训练的 Baseline，而且在搭载冻结后的 SKILL.md 后，三种方法的测试阶段费用和耗时反而低于 Baseline——这说明提前掌握明确的业务规则不仅能提分，还能减少目标 Agent 在测试容器内的盲目试探。分项来看，医保审核、服务工单处理与工程项目组合分析三个子 Benchmark 提升最为显著，而法院书记员业务的整体提分相对有限。下面结合一正一反两个案例，具体看训练过程中学到的规则如何改变 Agent 的实际表现。

### 1. 正向案例：医保审核

医保审核要求 Agent 查阅后台的患者病历、费用明细和医保政策，判断一笔理赔申请能不能批、具体能报销多少钱。在未经过训练的 Baseline 中，Agent 在全部 5 道测试题、连续三轮重复测试里无一例外地卡在了 55.00 分（标准差为 0.00）。原因在于后台系统里除了当前材料外，还一起存放着患者以前的旧病历和上一季度的旧价目表；未训练的 Agent 读完材料后分不清主次，直接把过期材料和旧价格混进来算账，只给出了“批或不批”的大致结论，因此每道题都只能拿到一半左右的基础分。

<figure class="post-figure" data-figure="case-coverage-review"> <svg class="fig-svg" viewBox="0 0 560 164" role="img" aria-labelledby="gdpevo-case-coverage-zh-title"> <title id="gdpevo-case-coverage-zh-title">医保审核任务中进化前与进化后的 Agent 执行流程对比</title> <text x="4" y="18" class="fig-title">进化前（Baseline）</text> <rect x="4" y="28" width="94" height="36" rx="6" class="fig-box"/> <text x="51" y="50" text-anchor="middle" class="fig-label">读取后台材料</text> <path d="M103 43H111V38L119 46L111 54V49H103Z" class="fill-gray-400 dark:fill-gray-500"/> <rect x="124" y="28" width="118" height="36" rx="6" class="fig-box"/> <text x="183" y="50" text-anchor="middle" class="fig-label">直接给出粗略结论</text> <path d="M247 43H255V38L263 46L255 54V49H247Z" class="fill-gray-400 dark:fill-gray-500"/> <rect x="268" y="28" width="72" height="36" rx="6" class="fig-terminal"/> <text x="304" y="50" text-anchor="middle" class="fig-num">55.00 分</text> <text x="4" y="98" class="fig-title">进化后（SkillAdam · 挂载 SKILL.md）</text> <rect x="4" y="108" width="94" height="36" rx="6" class="fig-box"/> <text x="51" y="130" text-anchor="middle" class="fig-label">读取后台材料</text> <path d="M103 123H111V118L119 126L111 134V129H103Z" class="fill-brand-600 dark:fill-brand-400"/> <rect x="124" y="108" width="94" height="36" rx="6" class="fig-s2"/> <text x="171" y="130" text-anchor="middle" class="fig-label">筛除过期材料</text> <path d="M223 123H231V118L239 126L231 134V129H223Z" class="fill-brand-600 dark:fill-brand-400"/> <rect x="244" y="108" width="94" height="36" rx="6" class="fig-s2"/> <text x="291" y="130" text-anchor="middle" class="fig-label">逐项核查条件</text> <path d="M343 123H351V118L359 126L351 134V129H343Z" class="fill-brand-600 dark:fill-brand-400"/> <rect x="364" y="108" width="94" height="36" rx="6" class="fig-s2"/> <text x="411" y="130" text-anchor="middle" class="fig-label">重算汇总填表</text> <path d="M463 123H471V118L479 126L471 134V129H463Z" class="fill-brand-600 dark:fill-brand-400"/> <rect x="484" y="108" width="72" height="36" rx="6" class="fig-s2"/> <text x="520" y="130" text-anchor="middle" class="fig-num">80.67 分</text> </svg> <ol class="fig-steps"> <li>进化前（Baseline）：读取后台材料 → 直接给出粗略结论 → 55.00 分</li> <li>进化后（SkillAdam）：读取后台材料 → 筛除过期材料 → 逐项核查条件 → 重算汇总填表 → 80.67 分</li> </ol> <figcaption>医保审核任务中进化前后的执行流程对比：蓝色节点为 Agent 在训练后主动增加的核查步骤。</figcaption> </figure>

如上图所示，目标 Agent 在连续训练环境中做完 5 道训练题并观察每次提交后的分差变化后，自己意识到不能读完材料就直接下结论，而是在 SKILL.md 中补齐了三步关键动作：一是先核对生效时间，把过期的旧病历和旧价目表筛除掉，只用当前有效的检查记录和最新价格表；二是按政策清单逐项核查患者是否办过提前审批、之前是否按规定试过常规药以及申报材料有无漏交；三是使用系统要求的标准词填写结论，并在每改完一笔明细金额后重新计算末尾的汇总数字。

带着这份 SKILL.md 进入测试集后，进化后的 Agent 在全部 5 道新题上都突破了 55 分瓶颈：第 2 题在三轮测试中全部拿到 100.00 分满分，第 1 题三轮稳定拿到 90.00 分，第 3 至第 5 题也全部从 55.00 分提升至 70.00–71.67 分，整体均分跃升至 80.67 分（+25.67）。这些内部审核规矩光靠模型自身的通用常识是猜不到的，而一旦在训练中摸清并沉淀为工作流，就能在测试集上带来稳定提分。

### 2. 过拟合案例：法院书记员业务

与医保审核相反，法院书记员业务（核对案件立案材料、安排开庭时间并整理归档记录）呈现出典型的“训练高分、测试滞涨”现象。如第 2 节的训练曲线所示，SkillAdam 在 5 道训练题上的平均分从最初的 69.54 分涨到 79.67 分，再经过两轮微调一路升到了 85.42 分；然而放到独立测试集上，最终均分却只从 Baseline 的 52.60 分微涨到 55.37 分（+2.77），TRACE 与 OpenSkill 甚至还比训练前低了 1 到 2 分。

对比训练过程中初版与第 2 轮迭代后的 SKILL.md 节选，可以直观看到规则是如何“进化歪”的：

<div class="post-tree-grid"><div class="post-tree-card"><div class="post-tree-head"><span class="post-tree-repo">SKILL.md（初版）</span><span class="post-tree-tag">训练 79.67 分</span></div><div class="post-tree-body"><div class="post-tree-row"><span class="post-tree-path"><span class="post-tree-dir"># 法院书记员立案与排期核对</span></span></div><div class="post-tree-row"><span class="post-tree-path">- 核对当事人身份、委托书与诉讼请求</span></div><div class="post-tree-row"><span class="post-tree-path">- 按法庭排期表在审限内选择空闲时段</span></div><div class="post-tree-row"><span class="post-tree-path">- 依卷宗目录归档并汇总待补件清单</span></div><div class="post-tree-row"><span class="post-tree-path">- 按案情实际缺失项填写退回补正原因</span></div></div></div><div class="post-tree-card"><div class="post-tree-head"><span class="post-tree-repo">SKILL.md（第 2 轮进化后）</span><span class="post-tree-tag">训练 85.42 分</span></div><div class="post-tree-body"><div class="post-tree-row"><span class="post-tree-path"><span class="post-tree-dir"># 法院书记员立案与排期核对</span></span></div><div class="post-tree-row"><span class="post-tree-path">- 核对当事人身份、委托书与诉讼请求</span></div><div class="post-tree-row"><span class="post-tree-path"><span class="post-tree-harm">- 合同纠纷一律顺延 14 天且跳过周五排期</span></span></div><div class="post-tree-row"><span class="post-tree-path"><span class="post-tree-harm">- 含补充证据的卷宗固定标为待二次合议</span></span></div><div class="post-tree-row"><span class="post-tree-path"><span class="post-tree-harm">- 退回原因仅限主体不适格与管辖权异议</span></span></div></div></div></div>

可以看到，初版技能总结的还是通用的立案与排期核对准则；但在后续迭代中，为了在仅有 5 道题的训练集上把最后几分抠出来，Agent 把训练样本里的局部巧合写成了右侧标红的“死规定”。当这套规则带到测试集时，在案情结构与训练题接近的第 3、4、5 题上，得分分别从 50.00、57.78 和 48.48 分升至 66.67、68.89 和 60.61 分；但在排期条件与案件类型发生变化的第 1 题和第 2 题上，右侧标红的死规定直接造成了负面干扰，导致得分从 35.29 分和 71.43 分跌至 23.53 分和 57.14 分。一升一降相互抵消，整体测试成绩几乎原地踏步，这也直接引出了下一节关于训练集过拟合与验证集划分的讨论。

## 7. 实验洞察与讨论

在搭建 PenguinHarness 这套 RSI 基础设施并开展实验的过程中，我们有以下几点观察与启发：

### 1. 主控 Agent 的模型能力门槛

一场全量 GDPEVO Essential 实验包含六个子 Benchmark 的连续训练、技能冻结交接、180 次隔离容器测试以及两级指标汇总，流程跨度很长。

在本次实验中，我们将实验规则封装进 RSI 工具包后，采用开启 max 思考强度的 DeepSeek-V4.1-Flash-1017 作为主控 Agent，它就能稳定理解实验要求，自主走完从环境准备到产出最终报告的全部步骤。这说明在我们的 RSI 工具包支持下，达到 DeepSeek-V4.1-Flash-1017 同等或更高水平的模型，都已经具备独立组织完整 RSI 实验的能力。

### 2. Benchmark 渐进式加载

无论是 GDPEVO，还是 SWE-bench、Terminal-Bench 等诸多 Benchmark，往往都包含大量任务数据、代码仓库、Docker 环境与评分脚本，如果直接打包进 PenguinHarness，会让整个系统变得非常笨重。

因此我们采用了类似渐进式加载的机制，将重型任务数据保留在独立的外部仓库中，而在 PenguinHarness 本地只内置轻量的说明文件，用来记录实验规则与数据位置。实验启动时，主控 Agent 先读取本地说明，再自行去外部仓库拉取对应数据并组织实验，这样既让 PenguinHarness 保持轻巧，又不影响实验功能的完整性。

<div class="post-tree-grid"><div class="post-tree-card"><div class="post-tree-head"><span class="post-tree-repo">penguin-harness</span><span class="post-tree-tag">本地内置轻量包</span></div><div class="post-tree-body"><div class="post-tree-row"><span class="post-tree-path"><span class="post-tree-dir">benchmarks/&lt;id&gt;/</span></span><span class="post-tree-note">本地包目录</span></div><div class="post-tree-row"><span class="post-tree-path"><span class="post-tree-branch">├── </span>benchmark_config.toml</span><span class="post-tree-note">Benchmark 元信息</span></div><div class="post-tree-row"><span class="post-tree-path"><span class="post-tree-branch">├── </span>scoreboard.yaml</span><span class="post-tree-note">本地评测得分记录</span></div><div class="post-tree-row"><span class="post-tree-path"><span class="post-tree-branch">├── </span><span class="post-tree-dir">CASE-001/</span></span><span class="post-tree-note">单题轻量说明</span></div><div class="post-tree-row"><span class="post-tree-path"><span class="post-tree-branch">│   ├── </span>task_config.toml</span><span class="post-tree-note">单题资源配额</span></div><div class="post-tree-row"><span class="post-tree-path"><span class="post-tree-branch">│   ├── </span>statement/README.md</span><span class="post-tree-note">题干与拉取地址</span></div><div class="post-tree-row"><span class="post-tree-path"><span class="post-tree-branch">│   └── </span>rubric/README.md</span><span class="post-tree-note">评分汇总规则</span></div><div class="post-tree-row"><span class="post-tree-path"><span class="post-tree-branch">└── </span><span class="post-tree-dir">CASE-002 .. CASE-005/</span></span><span class="post-tree-note">其余 4 道测试题</span></div></div></div><div class="post-tree-card"><div class="post-tree-head"><span class="post-tree-repo">penguin-harness-benchmark</span><span class="post-tree-tag">外部数据仓库</span></div><div class="post-tree-body"><div class="post-tree-row"><span class="post-tree-path"><span class="post-tree-dir">data/&lt;id&gt;/</span></span><span class="post-tree-note">按需拉取的数据目录</span></div><div class="post-tree-row"><span class="post-tree-path"><span class="post-tree-branch">├── </span>job.yaml</span><span class="post-tree-note">容器调度配置</span></div><div class="post-tree-row"><span class="post-tree-path"><span class="post-tree-branch">├── </span><span class="post-tree-dir">tasks/env/</span></span><span class="post-tree-note">业务后台与数据库</span></div><div class="post-tree-row"><span class="post-tree-path"><span class="post-tree-branch">├── </span><span class="post-tree-dir">tasks/test-001/</span></span><span class="post-tree-note">单题完整运行数据</span></div><div class="post-tree-row"><span class="post-tree-path"><span class="post-tree-branch">│   ├── </span><span class="post-tree-dir">environment/</span></span><span class="post-tree-note">容器与业务输入数据</span></div><div class="post-tree-row"><span class="post-tree-path"><span class="post-tree-branch">│   ├── </span>instruction.md</span><span class="post-tree-note">容器内任务指令</span></div><div class="post-tree-row"><span class="post-tree-path"><span class="post-tree-branch">│   └── </span>tests/score.py</span><span class="post-tree-note">离线评分脚本</span></div><div class="post-tree-row"><span class="post-tree-path"><span class="post-tree-branch">└── </span><span class="post-tree-dir">tasks/test-002 .. 005/</span></span><span class="post-tree-note">其余 4 道测试题</span></div></div></div></div>

### 3. 训练集过拟合与验证集划分

正如上一节法院书记员业务的案例所示，当 Agent 反复围绕 5 道训练题打磨 SKILL.md 时，后期追加的细化规则很容易过度拟合到具体的训练样本上，导致训练集分数越训越高，测试集却难以获得对等的泛化提升。

就像传统深度学习需要通过验证集来防止过拟合一样，未来的 Agent 自进化实验同样需要引入独立的 Validation 集：在训练集上总结修改规则，在 Validation 集上检验规则是否具备泛化能力并据此选版，最后再在测试集上评估。受限于目前版本的 GDPEVO 单子 Benchmark 数据量较小且只划分了训练集与测试集，部分原本依赖独立验证集或更大样本量的自进化算法在本次实验中不得不相应做一些改动，这也在一定程度上影响了它们的实际效果。后续我们计划推出 GDPEVO V3 版本来逐步弥补这些不足，同时也会尝试对更多传统 Benchmark 做 Train、Validation 与 Test 的切分，开展设计更为完整的自进化实验。

### 4. 实验细节偏差与 Critic Agent

复盘 DeepSeek-V4.1-Flash-1017 的实验记录时我们注意到，遇到容器启动超时、镜像拉取冲突或目录权限受限这类有明确报错的问题时，主控 Agent 通常能自己定位原因并重跑恢复。但对于没有报错、表面上顺利跑通的流程细节，主控 Agent 有时会出现自己意识不到的偏差：

- **直接复用前期试跑的结果**：在正式启动大批量测试前，主控 Agent 先抽了一道测试题试跑以确认环境连通。由于试跑拿到了有效分数，它在最后汇总成绩时直接把这次试跑分数当成第一轮正式测试的第 1 题结果填进了表格，没有严格区分前期试跑与正式测试。
- **打包环境时遗留了多余的说明文件**：在为容器准备运行环境包时，默认目录里带有内置 Benchmark 的题目说明文档。主控 Agent 在部分轮次中没有先把这些无关说明文件清理掉就直接打进了容器，而按实验规范，运行环境应当只保留当前任务所需的文件。

这类偏差之所以难靠主控 Agent 自己完全规避，是因为它同时承担了推进实验和检查结果两件事——只要任务跑完并拿到了分数，它就很容易默认流程已经合规。

这也引出了构建优秀 RSI 基础设施的一项关键改进：**在主控 Agent 与目标 Agent 之外，引入一个独立的 Critic Agent 来监督整个实验**。Critic Agent 不参与任务调度，专门在打包环境、交接 SKILL.md 和汇总成绩等节点做独立检查，及时提醒主控 Agent 纠正细节偏差，从而显著提高整个实验的置信度。
