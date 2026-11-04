---
title: "用 Penguin Harness 在 GDPEVO 上开展自进化实验"
date: 2026-11-04
category: practice
excerpt: "在 PenguinHarness 0.2.19 中使用内置的 GDPEVO Essential 六大企业场景（30 道训练题与 30 道测试题），对比评测 SkillAdam、SkillOpt、TRACE 与 OpenSkill 四种 Agent 自进化方法。"
---

本文介绍如何使用 PenguinHarness 0.2.19 在 [GDPEVO Essential](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/leaderboards/gdpevo-essential) 评测集上开展 Agent 自进化实验。实验中基座模型固定为 `DeepSeek-V4.1-Flash-1017`，思考强度设为 `max`，系统对比了 [SkillAdam](https://arxiv.org/abs/2609.08944v1)、[SkillOpt](https://arxiv.org/abs/2605.23904v1)、[TRACE](https://arxiv.org/abs/2608.22793v2) 和 [OpenSkill](https://arxiv.org/abs/2606.06741v1) 四种自进化方法。下文将依次说明评测集的数据规模与任务设定、自进化方法的核心机制、Web 界面的实验启动方式、系统内部的执行流程以及最终的实测结果。

## 1. GDPEVO Essential 的数据与任务设定

[GDPevo](https://github.com/Prism-Shadow/GDPevo)（[arXiv:2608.03764](https://arxiv.org/abs/2608.03764)）是面向真实企业工作流的 Agent 自进化评测基准，完整版包含 24 个有状态业务任务组、共 240 道业务题目。**GDPEVO Essential** 从中精选了覆盖 CRM、ERP、金融、医疗、法律与数据分析六大领域的 **6 个代表性企业场景**。

每个场景均配备 **1 个共享业务容器环境**、**5 道训练题（Train）**与 **5 道保留测试题（Test）**，六个场景合计 **30 道训练题与 30 道测试题（共 60 道题）**。在 PenguinHarness 0.2.19 的评估中心与 [penguin-harness-benchmark](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/packages) 仓库中，这六个场景以 **12 个内置 Benchmark 包**（6 个训练包 + 6 个测试包）的形式发布，各场景的数据明细如下：

| 业务场景 | 所属领域 | 上游任务组 | 场景标识与数据目录 | 训练题数 | 测试题数 | 业务 API 端点数 | 任务概述 |
| :--- | :--- | :--- | :--- | ---: | ---: | ---: | :--- |
| 服务工单处理 | CRM | `task_group_003` | [service-ticket-resolution](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/data/penguinharness-benchmark-gdpevo-essential-service-ticket-resolution-train) | 5 | 5 | 28 | 查询客服后台记录，完成离线工单核实、移动端分流与企业投诉调查 |
| 财务管控 | ERP | `task_group_005` | [financial-control](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/data/penguinharness-benchmark-gdpevo-essential-financial-control-train) | 5 | 5 | 26 | 核对报销单据、应付账款、供应商合规、预付摊销与总账关账记录 |
| 投资组合管理 | 金融 | `task_group_010` | [portfolio-management](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/data/penguinharness-benchmark-gdpevo-essential-portfolio-management-train) | 5 | 5 | 14 | 分析能源与固收交易策略、跨市场相关性以及多资产主动配置权重 |
| 医保审核 | 医疗 | `task_group_014` | [coverage-review](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/data/penguinharness-benchmark-gdpevo-essential-coverage-review-train) | 5 | 5 | 13 | 对照医保政策完成事前授权、拒赔申诉、同行评议与支付完整性审核 |
| 法院书记员业务 | 法律 | `task_group_018` | [court-clerk-operations](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/data/penguinharness-benchmark-gdpevo-essential-court-clerk-operations-train) | 5 | 5 | 12 | 综合案卷、罚单与政策记录，处理案件裁定、财务登记与缓刑转介 |
| 工程项目组合分析 | 数据分析 | `task_group_024` | [engineering-portfolio-analytics](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/data/penguinharness-benchmark-gdpevo-essential-engineering-portfolio-analytics-train) | 5 | 5 | 12 | 汇总工程工作项分类、可靠性与安全 SLA 时效、发布就绪度与依赖阻塞项 |
| **合计（6 个场景）** | **6 大领域** | **6 个任务组** | **12 个内置包（6 Train + 6 Test）** | **30** | **30** | **105** | **每题输出结构化 JSON，由原始加权评分器按百分制判分** |

在 GDPEVO Essential 的 Benchmark 设定下，每个场景的实验遵循以下三项规则：

- **分场景独立训练**：六个业务场景彼此独立，每个场景单独开展训练并产出一份专属的 `SKILL.md` 技能文档，不同场景之间不混合训练数据，也不共享习得的业务规则。
- **训练阶段（5 道题共享单容器连续会话，限时 6 小时）**：同一场景的 5 道训练题在同一个业务容器与同一个连续会话中完成，中途不重置环境或工作区。训练容器在本地回环端口提供只读业务后端服务，并内置在线评分接口 `POST /api/judge` 供 Agent 在演进过程中获取得分与诊断反馈。具体是否调用该接口由自进化方法本身决定，例如有监督方法会借此引导技能修订，而无监督方法则完全依靠自建的虚拟测试进行演进。
- **测试阶段（5 道题 × 3 轮独立容器评测，每题限时 4 小时）**：训练产出的 `SKILL.md` 一经导出即被冻结，随后在同场景的 5 道保留测试题上完整重复评测 3 轮（单个场景共 15 次测试运行，全量 6 个场景共 90 次测试运行）。每一道测试题的每一次作答均在全新的隔离容器与空白会话中独立运行，且关闭一切在线训练反馈接口，待作答结束后由离线评分器统一判分。

## 2. 自进化方法：以 SkillAdam 为例

在本次实验中，我们将 [SkillAdam](https://arxiv.org/abs/2609.08944v1)、[SkillOpt](https://arxiv.org/abs/2605.23904v1)、[TRACE](https://arxiv.org/abs/2608.22793v2) 与 [OpenSkill](https://arxiv.org/abs/2606.06741v1) 四种近期学术界的自进化工作复现并适配为 PenguinHarness 的内置方法插件，以便在统一的业务容器与评分标准下横向评测它们的效果。

这里以我们适配的 [SkillAdam](https://arxiv.org/abs/2609.08944v1)（对应插件 `skilladam-rsi-toolkit`）为例说明容器内的演进过程。在连续训练环境中，目标 Agent 需要根据 5 道训练题的反馈不断修订 `SKILL.md`。如果直接让模型在每轮之后自由改写整份文档，实践中很容易遇到两类问题：一是缺乏对历史失败修改的记录，模型容易在已被证伪的方向上反复尝试，二是单次改动的步幅难以控制，为了修好某一道题的局部问题，常常把原本在其他题目上生效的规则改坏。

针对这两个痛点，SkillAdam 原论文借鉴了深度学习中 Adam 优化器“一阶动量 + 二阶方差自适应步长”的设计思路。在我们的插件适配中，训练容器内的目标 Agent 按以下四步闭环迭代演进 `SKILL.md`：

<figure class="post-figure" data-figure="skilladam-loop"> <svg class="fig-svg" viewBox="0 0 560 250" role="img" aria-labelledby="gdpevo-self-evolution-skilladam-loop-zh-title"> <title id="gdpevo-self-evolution-skilladam-loop-zh-title">SkillAdam 容器内四步自进化闭环与底部 EIT 演进问题追踪器</title> <defs><marker id="gdpevo-self-evolution-skilladam-loop-zh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs> <text x="68" y="20" text-anchor="middle" class="fig-title">1 无技能初测</text> <rect x="10" y="32" width="116" height="88" rx="6" class="fig-box"/> <rect x="18" y="46" width="100" height="24" rx="4" class="fig-terminal"/> <text x="68" y="62" text-anchor="middle" class="fig-label">5 道训练题初测</text> <rect x="18" y="78" width="100" height="26" rx="4" class="fig-s2"/> <text x="68" y="95" text-anchor="middle" class="fig-code fig-label">初版 SKILL.md</text> <text x="68" y="138" text-anchor="middle" class="fig-note">暴露初始失分模式</text> <path d="M130 76H144" class="fig-edge" marker-end="url(#gdpevo-self-evolution-skilladam-loop-zh-arrow)"/> <text x="206" y="20" text-anchor="middle" class="fig-title">2 方差自适应预算</text> <rect x="148" y="32" width="116" height="88" rx="6" class="fig-box"/> <rect x="156" y="46" width="100" height="24" rx="4" class="fig-terminal"/> <text x="206" y="62" text-anchor="middle" class="fig-label">分差方差 EMA Vt</text> <rect x="156" y="78" width="100" height="26" rx="4" class="fig-s2"/> <text x="206" y="95" text-anchor="middle" class="fig-label">预算 Bt+1 ∈ [1,4]</text> <text x="206" y="138" text-anchor="middle" class="fig-note">波动大则收紧步幅</text> <path d="M268 76H282" class="fig-edge" marker-end="url(#gdpevo-self-evolution-skilladam-loop-zh-arrow)"/> <text x="344" y="20" text-anchor="middle" class="fig-title">3 受限修订提案</text> <rect x="286" y="32" width="116" height="88" rx="6" class="fig-box"/> <rect x="294" y="46" width="100" height="24" rx="4" class="fig-s2"/> <text x="344" y="62" text-anchor="middle" class="fig-label">修改 1..Bt+1 块</text> <rect x="294" y="78" width="100" height="26" rx="4" class="fig-terminal"/> <text x="344" y="95" text-anchor="middle" class="fig-note">其余有效规则锁定</text> <text x="344" y="138" text-anchor="middle" class="fig-note">局部受限修改文档</text> <path d="M406 76H420" class="fig-edge" marker-end="url(#gdpevo-self-evolution-skilladam-loop-zh-arrow)"/> <text x="487" y="20" text-anchor="middle" class="fig-title">4 严格均分门控</text> <rect x="424" y="32" width="126" height="88" rx="6" class="fig-box"/> <rect x="434" y="46" width="106" height="24" rx="4" class="fig-s2"/> <text x="487" y="62" text-anchor="middle" class="fig-label">均分上升 → 采纳</text> <rect x="434" y="78" width="106" height="26" rx="4" class="fig-link"/> <text x="487" y="95" text-anchor="middle" class="fig-note">未超当前 → 回退</text> <text x="487" y="138" text-anchor="middle" class="fig-note">导出最后采纳版本</text> <path d="M487 148V178" class="fig-edge" marker-end="url(#gdpevo-self-evolution-skilladam-loop-zh-arrow)"/> <text x="520" y="168" text-anchor="middle" class="fig-note">记录成败</text> <path d="M206 180V148" class="fig-edge" marker-end="url(#gdpevo-self-evolution-skilladam-loop-zh-arrow)"/> <text x="164" y="168" text-anchor="middle" class="fig-note">指导下一轮</text> <rect x="10" y="182" width="540" height="46" rx="8" class="fig-terminal"/> <text x="26" y="209" class="fig-title">EIT 演进问题追踪器</text> <rect x="168" y="193" width="114" height="24" rx="4" class="fig-box"/> <text x="225" y="209" text-anchor="middle" class="fig-label">暴露的错误模式</text> <rect x="292" y="193" width="116" height="24" rx="4" class="fig-s2"/> <text x="350" y="209" text-anchor="middle" class="fig-label">已生效修复方案</text> <rect x="418" y="193" width="118" height="24" rx="4" class="fig-link"/> <text x="477" y="209" text-anchor="middle" class="fig-note">被拒修改防重试</text> </svg> <ol class="fig-steps"> <li>1 无技能初测：5 道训练题初测，暴露初始失分模式，提炼初版 SKILL.md</li> <li>2 方差自适应预算：根据分差方差 EMA Vt 计算修改块预算 Bt+1 ∈ [1,4]</li> <li>3 受限修订提案：修改 1..Bt+1 块，其余有效规则锁定</li> <li>4 严格均分门控：均分严格上升则采纳，未超当前则回退，导出最后采纳版本</li> <li>EIT 演进问题追踪器：持久记录暴露的错误模式、已生效修复方案与被拒修改防重试</li> </ol> <figcaption>SkillAdam 在单容器连续训练中的四步演进闭环：底部的演进问题追踪器（EIT）跨轮次记录成败经验并防止重复无效修改，顶部的方差预算与严格均分门控共同约束单次修改步幅。</figcaption> </figure>

- **无技能初测与初版提炼**：训练启动后，Agent 首先在不挂载任何业务技能的状态下完成 5 道训练题的初次尝试，根据执行轨迹与评分反馈提炼出初版 `SKILL.md`。在随后的每一轮迭代中，Agent 均使用当前或候选技能文档在训练题上实测作答，收集各题得分、新旧分差与具体失误原因。
- **演进问题追踪器（EIT）**：算法在迭代全程维护一份问题账本，持续追踪训练题中暴露的错误模式、历次尝试过的修复方案及其实际效果。即便某一轮提出的候选修改最终因为没有提分而被拒绝，这次失败尝试的记录也会更新回 EIT 中，避免后续轮次重复无效修改。
- **方差自适应编辑预算**：每当候选版本在 5 道训练题上完成实测后，算法会评估该次修改在不同题目上引起的得分波动。如果一次修改让部分题目得分上升，却让另一些题目得分大幅回落，说明当前改动方向存在较大分歧，系统便会自动收紧下一轮允许修改的文档块数，迫使模型转向局部微调。
- **严格均分门控**：只有当候选 `SKILL.md` 在 5 道训练题上的平均得分相比当前版本严格上升时，才会被正式采纳并替换当前版本，否则拒绝该次修改并保留原版本。全部迭代完成后，最后一次被采纳的 `SKILL.md` 即作为最终训练产物导出。

具体而言，在第 <i>t</i> 轮迭代中，设第 <i>i</i> 道训练题在修改前与修改后的归一化得分分别为 <i>s<sub>i</sub></i><sup>curr</sup> 与 <i>s<sub>i</sub></i><sup>cand</sup>，则该题的得分变化量为 Δ<sub><i>i</i></sub> = <i>s<sub>i</sub></i><sup>cand</sup> − <i>s<sub>i</sub></i><sup>curr</sup>。记 <i>n</i> = 5 道训练题得分变化量的算术平均值为 Δ̄，本轮修改在各题间引起的分差样本方差为：

<p align="center"><i>σ</i><sub>Δ</sub><sup>2</sup> = (1 / (<i>n</i> − 1)) ∑<sub><i>i</i>=1..<i>n</i></sub> (Δ<sub><i>i</i></sub> − Δ̄)<sup>2</sup></p>

算法以平滑系数 <i>β</i><sub>2</sub> = 0.9 维护该方差的指数移动平均 <i>V<sub>t</sub></i>（初值 <i>V</i><sub>0</sub> = 0），并据此计算下一轮允许修改的最大差异块数 <i>B</i><sub><i>t</i>+1</sub>：

<p align="center"><i>V<sub>t</sub></i> = <i>β</i><sub>2</sub> <i>V</i><sub><i>t</i>−1</sub> + (1 − <i>β</i><sub>2</sub>) <i>σ</i><sub>Δ</sub><sup>2</sup>， <i>B</i><sub><i>t</i>+1</sub> = max(<i>B</i><sub>min</sub>, round(<i>B</i><sub>base</sub> · (1 − clip(<i>V<sub>t</sub></i> / <i>V</i><sub>cap</sub>, 0, 1))))</p>

其中基础预算 <i>B</i><sub>base</sub> = 4，最小预算 <i>B</i><sub>min</sub> = 1，方差上限 <i>V</i><sub>cap</sub> = 0.1。当累计波动率 <i>V<sub>t</sub></i> 增大时，下一轮允许修改的块数从默认的 4 块收缩至 1～2 块，当各题提分效果平稳一致时，修改预算随之恢复。

下图与表格展示了实验中“工程项目组合分析”、“医保审核”和“法院书记员业务”三个场景在连续训练容器内的真实得分演进过程（百分制）：

<figure class="post-figure" data-figure="skilladam-progression"> <svg class="fig-svg" viewBox="0 0 560 220" role="img" aria-labelledby="gdpevo-self-evolution-skilladam-progression-zh-title"> <title id="gdpevo-self-evolution-skilladam-progression-zh-title">三个代表性场景在连续训练容器内的五题平均得分演进曲线</title> <path d="M56 28H532M56 68H532M56 108H532M56 148H532" class="fig-link"/> <path d="M56 28V168H532" class="fig-axis"/> <text x="46" y="32" text-anchor="end" class="fig-tick">100</text> <text x="46" y="72" text-anchor="end" class="fig-tick">80</text> <text x="46" y="112" text-anchor="end" class="fig-tick">60</text> <text x="46" y="152" text-anchor="end" class="fig-tick">40</text> <text x="96" y="188" text-anchor="middle" class="fig-label">无技能初测</text> <text x="224" y="188" text-anchor="middle" class="fig-label">初版 Skill</text> <text x="352" y="188" text-anchor="middle" class="fig-label">第 1 轮迭代</text> <text x="480" y="188" text-anchor="middle" class="fig-label">第 2 轮迭代</text> <path d="M96 129.5L224 78.3L352 33.3L480 28.0" class="fig-edge"/> <circle cx="96" cy="129.5" r="4" class="fig-s1"/> <circle cx="224" cy="78.3" r="4" class="fig-s1"/> <circle cx="352" cy="33.3" r="4" class="fig-s1"/> <circle cx="480" cy="28.0" r="4" class="fig-s1"/> <text x="96" y="145" text-anchor="middle" class="fig-num">49.24</text> <text x="224" y="94" text-anchor="middle" class="fig-num">74.86</text> <text x="352" y="23" text-anchor="middle" class="fig-num">97.33</text> <text x="480" y="19" text-anchor="middle" class="fig-num">100.00</text> <path d="M96 61.9L224 40.3L352 40.2L480 39.2" class="fig-edge"/> <rect x="92" y="57.9" width="8" height="8" rx="1" class="fig-s2"/> <rect x="220" y="36.3" width="8" height="8" rx="1" class="fig-s2"/> <rect x="348" y="36.2" width="8" height="8" rx="1" class="fig-s2"/> <rect x="476" y="35.2" width="8" height="8" rx="1" class="fig-s2"/> <text x="96" y="52" text-anchor="middle" class="fig-num">83.07</text> <text x="224" y="31" text-anchor="middle" class="fig-num">93.87</text> <text x="352" y="54" text-anchor="middle" class="fig-num">93.93</text> <text x="510" y="43" text-anchor="start" class="fig-num">94.40</text> <path d="M96 88.9L224 68.7L352 68.5L480 57.2" class="fig-edge"/> <circle cx="96" cy="88.9" r="4" class="fig-s3"/> <circle cx="224" cy="68.7" r="4" class="fig-s3"/> <circle cx="352" cy="68.5" r="4" class="fig-s3"/> <circle cx="480" cy="57.2" r="4" class="fig-s3"/> <text x="96" y="104" text-anchor="middle" class="fig-num">69.54</text> <text x="224" y="61" text-anchor="middle" class="fig-num">79.67</text> <text x="352" y="83" text-anchor="middle" class="fig-num">79.74</text> <text x="480" y="73" text-anchor="middle" class="fig-num">85.42</text> <circle cx="110" cy="210" r="4" class="fig-s1"/> <text x="120" y="214" class="fig-label">工程项目组合分析</text> <rect x="246" y="206" width="8" height="8" rx="1" class="fig-s2"/> <text x="260" y="214" class="fig-label">医保审核</text> <circle cx="350" cy="210" r="4" class="fig-s3"/> <text x="360" y="214" class="fig-label">法院书记员业务</text> </svg> <ol class="fig-steps"> <li>工程项目组合分析：无技能初测 49.24，初版 Skill 74.86，第 1 轮迭代 97.33，第 2 轮迭代 100.00</li> <li>医保审核：无技能初测 83.07，初版 Skill 93.87，第 1 轮迭代 93.93，第 2 轮迭代 94.40</li> <li>法院书记员业务：无技能初测 69.54，初版 Skill 79.67，第 1 轮迭代 79.74，第 2 轮迭代 85.42</li> </ol> <figcaption>三个场景在连续训练容器内的五题平均分演进轨迹（百分制）：从无技能初测到初版技能提炼，再经两轮受限迭代实现单调提升。</figcaption> </figure>

| 业务场景 | 无技能初测 | 初版 Skill | 第 1 轮迭代 | 第 2 轮迭代 | 最终保留得分 |
| :--- | ---: | ---: | ---: | ---: | ---: |
| 工程项目组合分析 | 49.24 | 74.86 | 97.33 (采纳) | 100.00 (采纳) | 100.00 |
| 医保审核 | 83.07 | 93.87 | 93.93 (采纳) | 94.40 (采纳) | 94.40 |
| 法院书记员业务 | 69.54 | 79.67 | 79.74 (采纳) | 85.42 (采纳) | 85.42 |

可以看到，在工程项目组合分析、医保审核与法院书记员业务三个场景中，Agent 从无技能初测的 49.24 分、83.07 分和 69.54 分出发，先通过首轮轨迹诊断提炼出初版 `SKILL.md` 实现大幅跃升，随后在两轮方差受限的迭代修订中稳步消除残余失分点，训练均分分别达到 100.00 分、94.40 分和 85.42 分。

除 SkillAdam 外，本次实验还同步评测了另外三种代表性自进化方法，四者的原论文与核心机制对比如下：

| 方法名称 | 原论文 | 插件标识 | 容器内学习与选版方式 |
| :--- | :--- | :--- | :--- |
| SkillAdam | [arXiv:2609.08944](https://arxiv.org/abs/2609.08944v1) | `skilladam-rsi-toolkit` | 结合演进问题追踪器与分差方差自适应预算迭代修改，导出严格提升训练均分的最后一个采纳版本 |
| SkillOpt | [arXiv:2605.23904](https://arxiv.org/abs/2605.23904v1) | `skillopt-rsi-toolkit` | 分批反思成功与失败轨迹，合并局部修改提案并按余弦退火预算更新，导出训练集得分最高的采纳版本 |
| TRACE | [arXiv:2608.22793](https://arxiv.org/abs/2608.22793v2) | `trace-rsi-toolkit` | 策展者与执行者双角色协同：执行者解题，策展者从轨迹中提炼模块化技能库，按完整训练批次最高均分选版 |
| OpenSkill | [arXiv:2606.06741](https://arxiv.org/abs/2606.06741v1) | `openskill-rsi-toolkit` | 不使用在线训练评分接口，通过检索领域知识并构造独立虚拟测试来迭代修复技能，导出最后一个有效版本 |

## 3. 在 PenguinHarness Web 界面启动实验

在 PenguinHarness 0.2.19 中，默认 Agent 已预装 `skilladam-rsi-toolkit`、`agent-evaluation` 等全部自进化与评测技能，且六个场景的 12 个 GDPEVO Essential Benchmark 包均已内置。实验人员无需额外安装插件或编写底层调度脚本，只需在 Web 界面中完成以下两步即可发起实验。

### 第一步：在 Web 界面配置模型与思考强度

打开 PenguinHarness 0.2.19 的 Web 界面，在模型设置中添加 `deepseek/deepseek-flash` 并填入 API Key，将当前会话使用的模型选为 `deepseek/deepseek-flash`，思考强度调为 **Max**。

### 第二步：在聊天框发送启动指令

由于具体的任务路径、容器运行参数与评分规则均已内置在方法技能和 Benchmark 包说明中，直接在 Web 聊天框向 Agent 发送一句简短指令即可，只需说明方法、评测场景、模型与思考强度。

如果只跑单个场景（以服务工单处理为例），在聊天框输入：

> 使用 SkillAdam，在 GDPEVO Essential-Service Ticket Resolution 上开展自进化实验。模型使用 deepseek/deepseek-flash，思考强度 max。

如果直接开展全量六个场景的实验，在聊天框输入：

> 使用 SkillAdam 完成全部六个 GDPEVO Essential 场景的全量实验，每个场景独立训练一次，冻结后对 Baseline 与 Final 各完整测试三次。模型使用 deepseek/deepseek-flash，思考强度 max。

## 4. 实验启动后的内部执行流程

当实验人员在 Web 界面发出启动指令后，主控 Agent 便会自动接管实验现场，在后台按以下四个阶段完成从基准构建、连续训练冻结到多轮独立评测的全流程编排：

<figure class="post-figure" data-figure="gdpevo-workflow"> <svg class="fig-svg" viewBox="0 0 560 236" role="img" aria-labelledby="gdpevo-self-evolution-gdpevo-workflow-zh-title"> <title id="gdpevo-self-evolution-gdpevo-workflow-zh-title">GDPEVO 实验在 PenguinHarness 中的四阶段执行与容器隔离流程</title> <defs><marker id="gdpevo-self-evolution-gdpevo-workflow-zh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs> <text x="68" y="20" text-anchor="middle" class="fig-title">1 基线分支冻结</text> <rect x="10" y="32" width="116" height="94" rx="6" class="fig-box"/> <rect x="18" y="46" width="100" height="24" rx="4" class="fig-terminal"/> <text x="68" y="62" text-anchor="middle" class="fig-label">初始空白状态</text> <rect x="18" y="80" width="100" height="32" rx="4" class="fig-s2"/> <text x="68" y="100" text-anchor="middle" class="fig-label">冻结 Baseline</text> <text x="68" y="144" text-anchor="middle" class="fig-note">不含任何业务 Skill</text> <path d="M130 79H144" class="fig-edge" marker-end="url(#gdpevo-self-evolution-gdpevo-workflow-zh-arrow)"/> <text x="206" y="20" text-anchor="middle" class="fig-title">2 单容器连续训练</text> <rect x="148" y="32" width="116" height="94" rx="6" class="fig-box"/> <rect x="156" y="46" width="100" height="24" rx="4" class="fig-terminal"/> <text x="206" y="62" text-anchor="middle" class="fig-label">5 题共享单容器</text> <rect x="156" y="80" width="100" height="32" rx="4" class="fig-s2"/> <text x="206" y="100" text-anchor="middle" class="fig-label">冻结 Final 状态</text> <text x="206" y="144" text-anchor="middle" class="fig-note">导出并锁定 SKILL.md</text> <path d="M268 79H282" class="fig-edge" marker-end="url(#gdpevo-self-evolution-gdpevo-workflow-zh-arrow)"/> <text x="348" y="20" text-anchor="middle" class="fig-title">3 保留集隔离评测</text> <rect x="286" y="32" width="124" height="94" rx="6" class="fig-box"/> <rect x="296" y="46" width="104" height="24" rx="4" class="fig-terminal"/> <text x="348" y="62" text-anchor="middle" class="fig-label">5 题 × 3 轮独立跑</text> <rect x="296" y="80" width="104" height="32" rx="4" class="fig-s2"/> <text x="348" y="100" text-anchor="middle" class="fig-label">15 个全新容器</text> <text x="348" y="144" text-anchor="middle" class="fig-note">关闭在线评分接口</text> <path d="M414 79H428" class="fig-edge" marker-end="url(#gdpevo-self-evolution-gdpevo-workflow-zh-arrow)"/> <text x="491" y="20" text-anchor="middle" class="fig-title">4 两级指标聚合</text> <rect x="432" y="32" width="118" height="94" rx="6" class="fig-box"/> <rect x="442" y="46" width="98" height="24" rx="4" class="fig-terminal"/> <text x="491" y="62" text-anchor="middle" class="fig-label">单轮 5 题均分</text> <rect x="442" y="80" width="98" height="32" rx="4" class="fig-s2"/> <text x="491" y="100" text-anchor="middle" class="fig-label">3 轮 μ ± s 榜单</text> <text x="491" y="144" text-anchor="middle" class="fig-note">汇总分差与成本耗时</text> <rect x="10" y="168" width="540" height="46" rx="8" class="fig-terminal"/> <text x="26" y="195" class="fig-title">Harbor × Docker</text> <rect x="164" y="179" width="182" height="24" rx="4" class="fig-box"/> <text x="255" y="195" text-anchor="middle" class="fig-label">训练期：单场景共享 1 个容器</text> <rect x="356" y="179" width="182" height="24" rx="4" class="fig-s2"/> <text x="447" y="195" text-anchor="middle" class="fig-label">测试期：每题每轮独立新容器</text> </svg> <ol class="fig-steps"> <li>1 基线分支冻结：从初始空白状态直接锁定冻结 Baseline（不含任何业务 Skill）</li> <li>2 单容器连续训练：5 道训练题共享单容器连续演进，导出并锁定 SKILL.md 生成冻结 Final 状态</li> <li>3 保留集隔离评测：Baseline 与 Final 各在 5 道测试题上独立评测 3 轮（每组 15 个全新容器，关闭在线评分接口）</li> <li>4 两级指标聚合：先算单轮 5 题均分，再汇总 3 轮均值 μ、样本标准差 s 以及 MMSP 费用与耗时</li> <li>Harbor × Docker：训练期采用单场景共享 1 个容器，测试期采用每题每轮独立新容器</li> </ol> <figcaption>主控 Agent 在后台自动编排的四阶段实验流程：训练阶段在单容器内连续演进并冻结技能，测试阶段为每一道题的每一轮评测拉起全新容器，严格隔离状态与反馈。</figcaption> </figure>

### 1. 基线分支冻结

任务环境准备就绪后，主控 Agent 初始化一个不含任何业务技能的基准状态，并将其直接打包锁定为冻结基线状态，用于在测试集上评测模型未经过自进化训练时的原始表现。

### 2. 单容器连续训练与最终状态冻结

与此同时，主控 Agent 在基准状态上加载所选方法的训练规则，并通过 Harbor 为每个业务场景拉起一个独立的 Docker 容器开展连续训练。Docker 为每个训练场景提供了完整的环境隔离：业务后端服务、任务数据与在线评分接口均运行在容器内部，仅放行本地业务调用与模型请求。目标 Agent 在该隔离容器的同一个持久会话中完成 5 道训练题的试做、诊断与多轮迭代，导出最终定型的 `SKILL.md`。训练结束后，主控 Agent 将导出的 `SKILL.md` 重新挂载到最初备份的基准状态上并予以锁定，生成冻结的最终状态。

### 3. 装配测试 Agent 与保留集多轮评测

主控 Agent 将冻结的基线状态与最终状态分别装配给测试 Agent，通过 Harbor 并发队列在各场景的 5 道保留测试题上完整运行 3 轮评测。在测试阶段，每一道题目的每一次作答都会由 Harbor 启动一个全新的 Docker 容器与空白会话，实现严格的单题级环境隔离，不同题目与不同轮次之间互不共享文件系统、业务数据库状态或会话历史，容器内同时关闭在线训练评分通道，待作答结束后由离线评分器统一给出百分制得分。

### 4. 结果回收与指标聚合

所有测试容器运行完毕后，主控 Agent 自动回收全部轮次的得分、耗时与模型 Token 消耗记录，按统一的跨轮次与跨场景统计规范完成两级指标聚合，生成最终的评测榜单与实验报告。

## 5. 结果统计与实测数据

实验的分数与开销按以下两级聚合规则统计：

- **单场景测试得分**：设第 <i>r</i> 轮测试（<i>r</i> ∈ {1, 2, 3}）中第 <i>q</i> 道测试题（<i>q</i> ∈ {1..5}）的得分为 <i>s<sub>r,q</sub></i>。先计算每一轮测试内 5 道题的平均分 <i>s̄<sub>r</sub></i> = (1/5) ∑<sub><i>q</i>=1..5</sub> <i>s<sub>r,q</sub></i>，再对 3 轮测试的均分计算均值 <i>μ</i> = (1/3) ∑<sub><i>r</i>=1..3</sub> <i>s̄<sub>r</sub></i> 与样本标准差 <i>s</i> = √((1/2) ∑<sub><i>r</i>=1..3</sub> (<i>s̄<sub>r</sub></i> − <i>μ</i>)<sup>2</sup>)。
- **跨场景总体得分**：在每一轮测试 <i>r</i> 内，先对 6 个场景的单轮均分求等权平均得到该轮总体均分 <i>S̄<sub>r</sub></i> = (1/6) ∑<sub><i>d</i>=1..6</sub> <i>s̄<sub>r,d</sub></i>，再对 3 轮总体均分计算均值与样本标准差。
- **费用与耗时**：训练阶段每个场景只跑 1 次，直接汇总 6 个场景实际产生的总费用与总耗时。测试阶段共跑 3 轮，表中展示的测试费用与耗时为“3 轮完整测试合计除以 3”，即完成一轮完整测试（30 道测试题）的平均开销。费用按 MMSP 的统一计费标准核算。

四种方法与统一基线在六个场景上的总体结果如下：

| 方法 | 总体测试得分 (均分 ± 标准差) | 相比 Baseline 提升 | 训练总费用 | 训练总耗时 | 单轮测试平均费用 | 单轮测试平均耗时 |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | 56.32 ± 2.17 | — | — | — | $2.51 | 5h 20m |
| SkillOpt | 70.25 ± 0.03 | +13.93 | $3.89 | 4h 53m | $1.95 | 4h 30m |
| SkillAdam | 68.95 ± 0.74 | +12.63 | $5.45 | 4h 19m | $2.06 | 3h 44m |
| TRACE | 68.02 ± 1.80 | +11.69 | $5.29 | 3h 26m | $1.67 | 3h 37m |
| OpenSkill | 62.16 ± 2.31 | +5.83 | $5.56 | 8h 15m | $2.63 | 4h 45m |

六个业务场景的分项测试得分（均分 ± 标准差）如下：

| 业务场景 | Baseline | SkillAdam | SkillOpt | TRACE | OpenSkill |
| :--- | ---: | ---: | ---: | ---: | ---: |
| 服务工单处理 | 48.90 ± 10.06 | 65.78 ± 0.00 (+16.88) | 69.95 ± 6.30 (+21.05) | 59.38 ± 3.85 (+10.49) | 61.46 ± 0.28 (+12.57) |
| 财务管控 | 50.97 ± 1.08 | 63.89 ± 4.42 (+12.93) | 58.03 ± 7.14 (+7.07) | 62.56 ± 1.55 (+11.59) | 52.45 ± 9.15 (+1.48) |
| 投资组合管理 | 70.16 ± 2.10 | 74.25 ± 1.28 (+4.09) | 77.40 ± 3.18 (+7.24) | 74.55 ± 8.71 (+4.39) | 74.27 ± 4.90 (+4.11) |
| 医保审核 | 55.00 ± 0.00 | 80.67 ± 0.58 (+25.67) | 71.00 ± 0.00 (+16.00) | 68.67 ± 0.58 (+13.67) | 73.67 ± 2.52 (+18.67) |
| 法院书记员业务 | 52.60 ± 1.68 | 55.37 ± 2.32 (+2.77) | 61.98 ± 1.41 (+9.39) | 51.43 ± 1.69 (−1.17) | 50.55 ± 2.65 (−2.04) |
| 工程项目组合分析 | 60.32 ± 5.11 | 73.74 ± 0.00 (+13.42) | 83.15 ± 0.00 (+22.83) | 91.52 ± 1.57 (+31.19) | 60.55 ± 3.08 (+0.23) |

## 6. 实验洞察与讨论（待补充）

> **TODO（Insights 占位符）**：本节预留用于后续补充本次 GDPEVO Essential 自进化实验的核心洞察与深入分析（例如不同业务场景下的技能迁移特性、有监督在线评分反馈与无监督虚拟测试的边界对比、以及演进后推理步数与成本下降的机理讨论）。
