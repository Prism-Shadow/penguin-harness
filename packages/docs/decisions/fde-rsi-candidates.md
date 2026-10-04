# FDE RSI 候选清单

更新于 2026-10-03。来自 Awesome-RSI `36e91f8fed67e2cd0c761126f91042513df5d6ae`。保留全部 100 个方法、31 个 benchmark、3 个系统，另列本次补充工作。主判断见[综述](fde-rsi-literature-review.md)。

“全文／摘要／索引”表示本次实际核查程度；分类和简介来自候选索引，不能单凭它们认定论文严格遵守本项目协议。以下适配判断属于本项目的初筛意见。“优先”表示值得补读或实现，不是效果排名。

## 方法目录

| 方法／原文 | 修改对象 | 学习模式／更新者／选择 | 本次证据 | FDE 初筛 |
| --- | --- | --- | --- | --- |
| [NavHarness · 2609.34276](https://arxiv.org/abs/2609.34276) | Non-parametric, Context, Memory, Skill | Online / Joint / No validation | 索引 | 需改造初筛：检查在线反馈边界，改为训练期更新／测试冻结。 |
| [MoMHa · 2609.30967](https://arxiv.org/abs/2609.30967) | Non-parametric, Harness code, Context | Offline / Teacher / Artifact validation, Combined metrics | 索引 | 优先补读：核实 train/test、反馈可见性及最终版本选择。 |
| [ForeDreamer · 2608.20920](https://arxiv.org/abs/2608.20920) | Non-parametric, Harness code, Context, Memory, Skill | Offline / Teacher / Artifact validation, Benchmark score | 索引 | 后续候选：需要独立代码候选运行；原文 train/test 待核。 |
| [SEEK · 2609.29803](https://arxiv.org/abs/2609.29803) | Non-parametric, Context, Skill | Online / Teacher / Benchmark score | 摘要 | 优先补读：核查冻结模型后的 Skill 更新与历史 replay 评估。 |
| [SkillEvoReg · 2609.30861](https://arxiv.org/abs/2609.30861) | Non-parametric, Harness code, Context, Skill | Offline, Online / Teacher / Artifact validation, Instance result, Benchmark score | 摘要 | 后续候选：需要独立代码候选运行；原文 train/test 待核。 |
| [HarnessPAI · 2609.29166](https://arxiv.org/abs/2609.29166) | Non-parametric, Harness code, Context, Memory, Skill | Offline / Teacher / Artifact validation, Benchmark score | 索引 | 后续候选：需要独立代码候选运行；原文 train/test 待核。 |
| [AIDE² · 2609.26457](https://arxiv.org/abs/2609.26457) | Non-parametric, Harness code, Context, Memory | Offline / Teacher / Benchmark score | 索引 | 后续候选：需要独立代码候选运行；原文 train/test 待核。 |
| [OpenSkill · 2606.06741](https://arxiv.org/abs/2606.06741) | Non-parametric, Harness code, Context, Skill | Offline / Teacher / No validation | 索引 | 后续候选：需要独立代码候选运行；原文 train/test 待核。 |
| [SimSkill · 2609.03753](https://arxiv.org/abs/2609.03753) | Non-parametric, Harness code, Context, Memory, Skill | Offline, Online / Teacher / Artifact validation, Instance result | 索引 | 后续候选：需要独立代码候选运行；原文 train/test 待核。 |
| [Growing Harness · 2609.26760](https://arxiv.org/abs/2609.26760) | Non-parametric, Harness code, Context | Offline / Teacher / Artifact validation, Benchmark score | 索引 | 优先补读：核实 train/test、反馈可见性及最终版本选择。 |
| [JAZ · 2609.26891](https://arxiv.org/abs/2609.26891) | Non-parametric, Harness code, Context, Memory, Skill | Online / Teacher / No validation | 索引 | 需改造：索引描述使用 test feedback 更新；本项目改为 train-only。 |
| [TISD · 2609.30878](https://arxiv.org/abs/2609.30878) | Parametric | Offline / Joint / No validation | 索引 | 范围外：持久改动为模型权重；保留轨迹干预思路。 |
| [DCE + SRCL · 2609.30652](https://arxiv.org/abs/2609.30652) | Parametric | Offline / Joint / No validation | 索引 | 范围外：Teacher–Student 蒸馏改变权重。 |
| [SkillRefine · 2609.30674](https://arxiv.org/abs/2609.30674) | Non-parametric, Context, Memory, Skill | Offline / Teacher / No validation | 索引 | 优先补读：索引描述企业软件训练后冻结库，核对 PIMS-Bench 划分。 |
| [Harness-Zero · 2609.24974](https://arxiv.org/abs/2609.24974) | Non-parametric, Harness code, Context, Memory, Skill | Offline / Teacher / Artifact validation, Instance result | 索引 | 拆分候选：只评前段 harness 更新，后续蒸馏／权重训练另记。 |
| [MCE · 2601.21557](https://arxiv.org/abs/2601.21557) | Non-parametric, Harness code, Context, Memory, Skill | Offline, Online / Teacher / Artifact validation, Benchmark score | 索引 | 优先补读：核实 train/test、反馈可见性及最终版本选择。 |
| [TTSE · 2609.24289](https://arxiv.org/abs/2609.24289) | Non-parametric, Context, Memory, Skill | Offline, Online / Teacher / No validation, Instance result | 索引 | 优先补读：核实 train/test、反馈可见性及最终版本选择。 |
| [SkillPivot · 2609.29154](https://arxiv.org/abs/2609.29154) | Non-parametric, Context, Skill | Online / Teacher / Combined metrics | 索引 | 优先补读：核实 train/test、反馈可见性及最终版本选择。 |
| [Designer-RSI · 2609.22086](https://arxiv.org/abs/2609.22086) | Non-parametric, Context, Memory, Skill | Offline / Teacher / Benchmark score | 索引 | 候选保留：核实训练数据、Teacher 角色及未见任务测试。 |
| [AlgoEvo · 2609.15820](https://arxiv.org/abs/2609.15820) | Non-parametric, Context, Memory, Skill | Online / Self / Instance result | 索引 | 需改造初筛：检查在线反馈边界，改为训练期更新／测试冻结。 |
| [PILOT · 2608.26530](https://arxiv.org/abs/2608.26530) | Non-parametric, Context, Memory, Skill | Online / Teacher / No validation, Instance result | 索引 | 需改造初筛：检查在线反馈边界，改为训练期更新／测试冻结。 |
| [SkillHEX · 2608.05628](https://arxiv.org/abs/2608.05628) | Non-parametric, Context, Skill | Online / Teacher / Artifact validation, Instance result | 索引 | 优先补读：核实 train/test、反馈可见性及最终版本选择。 |
| [KSI · 2607.19592](https://arxiv.org/abs/2607.19592) | Non-parametric, Context, Memory | Online, Offline / Joint / Artifact validation | 索引 | 需改造初筛：检查在线反馈边界，改为训练期更新／测试冻结。 |
| [SAGEAgent · 2607.09521](https://arxiv.org/abs/2607.09521) | Non-parametric, Context, Memory, Skill | Offline / Teacher / Artifact validation | 索引 | 候选保留：核实训练数据、Teacher 角色及未见任务测试。 |
| [HGM · 2510.21614](https://arxiv.org/abs/2510.21614) | Non-parametric, Harness code, Context | Offline / Self / Benchmark score | 索引 | 后续候选：需要独立代码候选运行；原文 train/test 待核。 |
| [RRSI · 2609.24972](https://arxiv.org/abs/2609.24972) | Non-parametric, Harness code, Context, Memory, Skill | Offline / Teacher / Combined metrics | 摘要 | 后续候选：需要独立代码候选运行；原文 train/test 待核。 |
| [Procedural Graphs · 2609.09153](https://arxiv.org/abs/2609.09153) | Non-parametric, Context, Memory, Skill | Offline / Teacher / Artifact validation, Benchmark score | 索引 | 候选保留：核实训练数据、Teacher 角色及未见任务测试。 |
| [Experience Funnel · 2609.08919](https://arxiv.org/abs/2609.08919) | Parametric, Non-parametric, Context, Memory, Skill | Offline / Teacher / Benchmark score | 索引 | 条件候选：须拆出冻结权重的非参数分支，核对独立测试。 |
| [NeoHorse-1 · 2609.08183](https://arxiv.org/abs/2609.08183) | Parametric | Offline / Teacher / No validation | 索引 | 范围外初筛：权重更新路线；保留相关反馈与数据机制。 |
| [Ecdysis · 2609.11677](https://arxiv.org/abs/2609.11677) | Non-parametric, Harness code, Context | Offline / Teacher / Benchmark score | 索引 | 优先补读：核实 train/test、反馈可见性及最终版本选择。 |
| [COBRA-Skills · 2609.11682](https://arxiv.org/abs/2609.11682) | Non-parametric, Context, Skill | Offline / Teacher / Benchmark score | 索引 | 候选保留：核实训练数据、Teacher 角色及未见任务测试。 |
| [RSIAgent · 2609.15364](https://arxiv.org/abs/2609.15364) | Non-parametric, Context, Memory, Skill | Offline / Self / Instance result | 索引 | 候选保留：核实训练数据、Teacher 角色及未见任务测试。 |
| [ModularRSI · 2609.14857](https://arxiv.org/abs/2609.14857) | Non-parametric, Harness code, Context, Memory | Offline / Self / Artifact validation | 索引 | 后续候选：需要独立代码候选运行；原文 train/test 待核。 |
| [EvoOntology · 2609.15779](https://arxiv.org/abs/2609.15779) | Non-parametric, Harness code, Context, Memory | Offline / Teacher / Benchmark score | 索引 | 后续候选：需要独立代码候选运行；原文 train/test 待核。 |
| [EvoSkill-GUI · 2609.17653](https://arxiv.org/abs/2609.17653) | Non-parametric, Context, Memory, Skill | Online / Self / Instance result | 索引 | 需改造初筛：检查在线反馈边界，改为训练期更新／测试冻结。 |
| [EvolveTrade · 2609.17632](https://arxiv.org/abs/2609.17632) | Non-parametric, Context, Skill | Online / Teacher / No validation | 索引 | 需改造初筛：检查在线反馈边界，改为训练期更新／测试冻结。 |
| [SkillAA · 2609.20455](https://arxiv.org/abs/2609.20455) | Non-parametric, Context, Memory, Skill | Offline / Teacher / Benchmark score | 索引 | 候选保留：核实训练数据、Teacher 角色及未见任务测试。 |
| [SIFT · 2609.19526](https://arxiv.org/abs/2609.19526) | Non-parametric, Harness code, Context | Offline / Teacher / Combined metrics | 索引 | 后续候选：需要独立代码候选运行；原文 train/test 待核。 |
| [Harness-of-Harness · 2609.01481](https://arxiv.org/abs/2609.01481) | Non-parametric, Context, Memory, Other artifact | Online / Joint / Artifact validation | 索引 | 需改造初筛：检查在线反馈边界，改为训练期更新／测试冻结。 |
| [SoL-Pi · 2609.20519](https://arxiv.org/abs/2609.20519) | Non-parametric, Harness code, Context | Offline / Teacher / Combined metrics | 索引 | 后续候选：需要独立代码候选运行；原文 train/test 待核。 |
| [RISE · 2609.05295](https://arxiv.org/abs/2609.05295) | Parametric | Offline / Self / No validation | 索引 | 范围外初筛：权重更新路线；保留相关反馈与数据机制。 |
| [CHIME · 2609.02074](https://arxiv.org/abs/2609.02074) | Non-parametric, Context, Memory | Online, Offline / Self / Instance result | 索引 | 需改造初筛：检查在线反馈边界，改为训练期更新／测试冻结。 |
| [AutoTTS · 2605.08083](https://arxiv.org/abs/2605.08083) | Non-parametric, Harness code, Context, Memory | Offline / Teacher / Combined metrics, Benchmark score | 索引 | 后续候选：需要独立代码候选运行；原文 train/test 待核。 |
| [EnvHarness · 2608.19880](https://arxiv.org/abs/2608.19880) | Parametric, Non-parametric, Context, Memory, Skill, Other artifact | Offline / Teacher / No validation | 索引 | 条件候选：须拆出冻结权重的非参数分支，核对独立测试。 |
| [TTCS · 2601.22628](https://arxiv.org/abs/2601.22628) | Parametric | Online / Joint / No validation | 索引 | 范围外初筛：权重更新路线；保留相关反馈与数据机制。 |
| [VisPlay · 2511.15661](https://arxiv.org/abs/2511.15661) | Parametric | Offline / Joint / No validation | 索引 | 范围外初筛：权重更新路线；保留相关反馈与数据机制。 |
| [MM-Zero · 2603.09206](https://arxiv.org/abs/2603.09206) | Parametric | Offline / Joint / No validation | 索引 | 范围外初筛：权重更新路线；保留相关反馈与数据机制。 |
| [G-Zero · 2605.09959](https://arxiv.org/abs/2605.09959) | Parametric | Offline / Joint / No validation | 索引 | 范围外初筛：权重更新路线；保留相关反馈与数据机制。 |
| [R-Zero · 2508.05004](https://arxiv.org/abs/2508.05004) | Parametric | Offline / Joint / No validation | 索引 | 范围外初筛：权重更新路线；保留相关反馈与数据机制。 |
| [Dream-RSI · dream-rsi](https://dream-rsi.com/assets/dream-rsi.pdf) | Non-parametric, Harness code, Context, Memory | Online / Teacher / Combined metrics | 索引 | 邻近方向：历史搜索树回放；核实未见分支与线上转移评估。 |
| [SkillAdam · 2609.08944](https://arxiv.org/abs/2609.08944) | Non-parametric, Context, Memory, Skill | Offline / Teacher / Combined metrics | 索引 | 优先补读：核实 train/test、反馈可见性及最终版本选择。 |
| [SkillGLoW · 2609.02217](https://arxiv.org/abs/2609.02217) | Non-parametric, Context, Memory, Skill | Online, Offline / Teacher / Benchmark score | 索引 | 优先补读：核实 train/test、反馈可见性及最终版本选择。 |
| [ACE · 2510.04618](https://arxiv.org/abs/2510.04618) | Non-parametric, Context, Memory, Skill | Offline, Online / Teacher / No validation | 全文 | 采用原实现的逐题生成／反思重生成／整理／后测；Skill 表达与无 validation 的 final 选择注明适配。 |
| [GEPA · 2507.19457](https://arxiv.org/abs/2507.19457) | Non-parametric, Context | Offline / Teacher / Benchmark score | 全文 | 优先：保留反思、候选前沿与选择预算；单一训练集改法需注明。 |
| [Dynamic Cheatsheet · 2504.07952](https://arxiv.org/abs/2504.07952) | Non-parametric, Context, Memory, Skill | Online / Teacher / No validation | 全文 | 需改造：在线 test 学习改为 training 流，最终冻结。 |
| [Hyperagents · 2603.19461](https://arxiv.org/abs/2603.19461) | Non-parametric, Harness code, Context, Memory | Offline / Teacher / Artifact validation, Benchmark score | 索引 | 后续候选：需要独立代码候选运行；原文 train/test 待核。 |
| [GEA · 2602.04837](https://arxiv.org/abs/2602.04837) | Non-parametric, Harness code, Context | Offline / Joint / Artifact validation, Combined metrics | 索引 | 后续候选：需要独立代码候选运行；原文 train/test 待核。 |
| [PANDO · 2605.24785](https://arxiv.org/abs/2605.24785) | Non-parametric, Harness code, Context, Memory, Skill | Online / Teacher / Instance result | 索引 | 后续候选：需要独立代码候选运行；原文 train/test 待核。 |
| [DIVE · 2608.12486](https://arxiv.org/abs/2608.12486) | Non-parametric, Context, Skill | Offline / Self / Benchmark score | 索引 | 候选保留：核实训练数据、Teacher 角色及未见任务测试。 |
| [EvolveNet · 2608.04968](https://arxiv.org/abs/2608.04968) | Non-parametric, Harness code, Context | Offline / Teacher / Benchmark score | 索引 | 后续候选：需要独立代码候选运行；原文 train/test 待核。 |
| [DarwinX · 2608.07545](https://arxiv.org/abs/2608.07545) | Non-parametric, Harness code, Context, Skill | Offline / Teacher / Combined metrics | 索引 | 后续候选：需要独立代码候选运行；原文 train/test 待核。 |
| [MOSS · 2605.22794](https://arxiv.org/abs/2605.22794) | Non-parametric, Harness code | Online / Teacher / Artifact validation, Combined metrics | 索引 | 后续候选：需要独立代码候选运行；原文 train/test 待核。 |
| [SkillRevise · 2606.01139](https://arxiv.org/abs/2606.01139) | Non-parametric, Context, Skill | Online / Teacher / Combined metrics | 全文 | 需改造：同题修订后增加独立新任务测试。 |
| [ISM · 2606.31191](https://arxiv.org/abs/2606.31191) | Non-parametric, Memory, Skill | Online / Teacher / Artifact validation, Instance result | 索引 | 需改造初筛：检查在线反馈边界，改为训练期更新／测试冻结。 |
| [ExpGraph · 2605.30712](https://arxiv.org/abs/2605.30712) | Parametric, Non-parametric, Context, Memory, Skill | Offline / Teacher / Instance result | 索引 | 条件候选：须拆出冻结权重的非参数分支，核对独立测试。 |
| [DemoEvolve · 2605.24539](https://arxiv.org/abs/2605.24539) | Non-parametric, Harness code, Context | Offline / Teacher / Benchmark score | 索引 | 后续候选：需要独立代码候选运行；原文 train/test 待核。 |
| [HarnessX · 2606.14249](https://arxiv.org/abs/2606.14249) | Parametric, Non-parametric, Harness code, Context, Memory | Offline / Teacher / Artifact validation, Benchmark score | 索引 | 条件候选：须拆出冻结权重的非参数分支，核对独立测试。 |
| [HarnessBank · 2607.13683](https://arxiv.org/abs/2607.13683) | Non-parametric, Harness code, Context | Offline / Teacher / Artifact validation, Combined metrics | 索引 | 后续候选：需要独立代码候选运行；原文 train/test 待核。 |
| [RHI · 2607.15524](https://arxiv.org/abs/2607.15524) | Non-parametric, Context | Offline / Teacher / Benchmark score | 索引 | 候选保留：核实训练数据、Teacher 角色及未见任务测试。 |
| [Gödel Agent · 2410.04444](https://arxiv.org/abs/2410.04444) | Non-parametric, Harness code, Context | Offline / Self / Benchmark score | 索引 | 后续候选：需要独立代码候选运行；原文 train/test 待核。 |
| [SEAL · 2506.10943](https://arxiv.org/abs/2506.10943) | Parametric | Offline / Self / Benchmark score | 索引 | 范围外初筛：权重更新路线；保留相关反馈与数据机制。 |
| [DGM · 2505.22954](https://arxiv.org/abs/2505.22954) | Non-parametric, Harness code, Context | Offline / Joint / Combined metrics | 全文 | 后续：Teacher 修改独立代码候选，保留搜索，重新明确企业训练／测试。 |
| [AWM · 2409.07429](https://arxiv.org/abs/2409.07429) | Non-parametric, Memory, Skill | Online, Offline, Offline → Online / Teacher / No validation | 全文 | 采用 online_train：原论文逐题成功归纳机制运行于 training，随后冻结 testing；offline 仅用于已提供的规范示范轨迹。 |
| [A-MEM · 2502.12110](https://arxiv.org/abs/2502.12110) | Non-parametric, Memory | Online / Teacher / No validation | 索引 | 需改造初筛：检查在线反馈边界，改为训练期更新／测试冻结。 |
| [Cradle · 2403.03186](https://arxiv.org/abs/2403.03186) | Non-parametric, Context, Memory, Skill | Online / Joint / Instance result | 索引 | 需改造初筛：检查在线反馈边界，改为训练期更新／测试冻结。 |
| [R-Few · 2512.02472](https://arxiv.org/abs/2512.02472) | Parametric | Offline / Joint / No validation | 索引 | 范围外初筛：权重更新路线；保留相关反馈与数据机制。 |
| [ReasoningBank · 2509.25140](https://arxiv.org/abs/2509.25140) | Non-parametric, Context, Memory | Online / Joint / Instance result | 全文 | 需改造：只在 training 写 memory，testing 冻结；分开报告 MaTTS 成本。 |
| [Mem²Evolve · 2604.10923](https://arxiv.org/abs/2604.10923) | Non-parametric, Harness code, Context, Memory, Skill | Online, Offline → Online / Teacher / Instance result | 索引 | 后续候选：需要独立代码候选运行；原文 train/test 待核。 |
| [When Rules Learn · 2606.17220](https://arxiv.org/abs/2606.17220) | Non-parametric, Context, Skill | Offline / Self / Benchmark score | 索引 | 候选保留：核实训练数据、Teacher 角色及未见任务测试。 |
| [HeLa-Mem · 2604.16839](https://arxiv.org/abs/2604.16839) | Non-parametric, Memory | Online / Teacher / No validation | 索引 | 需改造初筛：检查在线反馈边界，改为训练期更新／测试冻结。 |
| [Memp · 2508.06433](https://arxiv.org/abs/2508.06433) | Non-parametric, Context, Memory, Skill | Offline → Online / Teacher / Instance result | 索引 | 需改造初筛：检查在线反馈边界，改为训练期更新／测试冻结。 |
| [Meta-Harness · 2603.28052](https://arxiv.org/abs/2603.28052) | Non-parametric, Harness code, Context, Memory | Offline / Teacher / Combined metrics | 索引 | 优先补读：核实 train/test、反馈可见性及最终版本选择。 |
| [Escher-Loop · 2604.23472](https://arxiv.org/abs/2604.23472) | Non-parametric, Harness code | Offline / Teacher / Benchmark score | 索引 | 后续候选：需要独立代码候选运行；原文 train/test 待核。 |
| [AHE · 2604.25850](https://arxiv.org/abs/2604.25850) | Non-parametric, Harness code, Context, Memory, Skill | Offline / Teacher / Artifact validation, Benchmark score | 索引 | 后续候选：需要独立代码候选运行；原文 train/test 待核。 |
| [Continual Harness · 2605.09998](https://arxiv.org/abs/2605.09998) | Parametric, Non-parametric, Harness code, Context, Memory, Skill | Online / Self, Teacher / No validation | 索引 | 条件候选：须拆出冻结权重的非参数分支，核对独立测试。 |
| [SkillSmith · 2606.01314](https://arxiv.org/abs/2606.01314) | Non-parametric, Harness code, Memory, Skill | Offline / Teacher / Artifact validation, Combined metrics | 索引 | 后续候选：需要独立代码候选运行；原文 train/test 待核。 |
| [SePO · 2606.04465](https://arxiv.org/abs/2606.04465) | Non-parametric, Context | Offline / Self, Teacher / Benchmark score | 索引 | 候选保留：核实训练数据、Teacher 角色及未见任务测试。 |
| [HarnessFix · 2606.06324](https://arxiv.org/abs/2606.06324) | Non-parametric, Harness code, Context, Memory | Offline / Teacher / Artifact validation, Benchmark score | 索引 | 优先补读：核实 train/test、反馈可见性及最终版本选择。 |
| [Self-Harness · 2606.09498](https://arxiv.org/abs/2606.09498) | Non-parametric, Harness code, Context, Memory | Offline / Self / Combined metrics | 索引 | 后续候选：需要独立代码候选运行；原文 train/test 待核。 |
| [Red Queen Gödel Machine · 2606.26294](https://arxiv.org/abs/2606.26294) | Non-parametric, Harness code, Context | Offline / Teacher / Combined metrics | 索引 | 后续候选：需要独立代码候选运行；原文 train/test 待核。 |
| [Mendel Gödel Machine · 2608.07645](https://arxiv.org/abs/2608.07645) | Non-parametric, Harness code, Context | Offline / Joint / Combined metrics | 索引 | 后续候选：需要独立代码候选运行；原文 train/test 待核。 |
| [Recuris · 2608.24876](https://arxiv.org/abs/2608.24876) | Non-parametric, Context, Memory, Skill | Offline, Offline → Online / Teacher / Artifact validation, Instance result | 索引 | 需改造初筛：检查在线反馈边界，改为训练期更新／测试冻结。 |
| [TRACE · 2608.22793](https://arxiv.org/abs/2608.22793) | Non-parametric, Context, Skill | Offline → Online / Teacher / Benchmark score | 索引 | 优先补读：核实 train/test、反馈可见性及最终版本选择。 |
| [Evo-Harness · 2608.15071](https://arxiv.org/abs/2608.15071) | Non-parametric, Context, Skill | Online / Joint / Instance result | 索引 | 需改造初筛：检查在线反馈边界，改为训练期更新／测试冻结。 |
| [HyperSkill · 2608.16114](https://arxiv.org/abs/2608.16114) | Non-parametric, Context, Memory, Skill | Online / Teacher / Instance result | 索引 | 需改造初筛：检查在线反馈边界，改为训练期更新／测试冻结。 |
| [MediSkill-Evo · 2608.23397](https://arxiv.org/abs/2608.23397) | Non-parametric, Context, Memory, Skill | Offline / Teacher / Artifact validation, Instance result | 索引 | 候选保留：核实训练数据、Teacher 角色及未见任务测试。 |
| [Prime Agent · 2608.23552](https://arxiv.org/abs/2608.23552) | Non-parametric, Context, Memory, Skill | Online / Self / Instance result | 索引 | 需改造初筛：检查在线反馈边界，改为训练期更新／测试冻结。 |
| [P²O · 2603.21877](https://arxiv.org/abs/2603.21877) | Parametric, Non-parametric, Context | Offline / Self / Benchmark score | 索引 | 条件候选：须拆出冻结权重的非参数分支，核对独立测试。 |
| [WikiSkill · 2608.27454](https://arxiv.org/abs/2608.27454) | Non-parametric, Context, Memory, Skill | Offline / Teacher / Benchmark score | 索引 | 候选保留：核实训练数据、Teacher 角色及未见任务测试。 |
| [HarnessEvolve · 2609.00829](https://arxiv.org/abs/2609.00829) | Non-parametric, Harness code, Context, Skill | Offline / Teacher / Artifact validation, Combined metrics | 索引 | 后续候选：需要独立代码候选运行；原文 train/test 待核。 |

## 方法标题与待核证据

下面保留完整标题及索引中的中文简介，方便检索。除上表已标出的原文核查外，这些简介属于检索线索；下一步要核查的共同问题是：训练／测试实例是否分离，哪些反馈参与修改，哪一版最终生效，是否计入 Teacher 与评测成本。

- **NavHarness — NavHarness: Towards Lifelong Embodied Navigation**（2609.34276）：利用环境观察与模型完成度检查，持续积累和修正空间记忆、任务交接记录，并整理房屋知识与导航 Skill，供后续新会话复用。
- **MoMHa — MoMHa: Multi-Objective Optimization of LLM Harnesses over Accuracy, Safety, and Tokens**（2609.30967）：参考历史 Harness 代码和执行轨迹提出新版本，通过有效性检查后，以准确率、安全性和 Token 成本的联合指标筛选改进。
- **ForeDreamer — ForeDreamer: A Self-Evolving Dual-Agent Memory Architecture for Future Event Prediction**（2608.20920）：分别更新预测经验与证据处理流程、工具，通过验证筛选修改，并跨流程分支复用工具，帮助后续事件预测。
- **SEEK — SEEK: Skill-Routed Evaluation with Evolvable Knowledge for Industrial Search**（2609.29803）：根据人工复核的搜索评价错误修订 Skill 库，仅在新样本上改善且历史回放表现未明显退化时接受修改。
- **SkillEvoReg — SkillEvoReg: Regularizing Agent Skill Evolution Against Overfitting**（2609.30861）：在反复更新 Skill 时加入技能丢弃、局部复杂度控制和成对反例验证，减少过拟合与已有能力退化。
- **HarnessPAI — HarnessPAI: An Evolving Harness for Physical AI**（2609.29166）：依据机器人执行视频和诊断修改程序，在开发场景中验证修复，并把成功修复经验积累为可复用 Skill。
- **AIDE² — Recursive self-improvement of AI research agents**（2609.26457）：参考历史候选的评测结果修改 AI 研究智能体自身代码，在固定任务预算下保留研究表现更好的版本。
- **OpenSkill — OpenSkill: Open-World Self-Evolution for LLM Agents**（2606.06741）：从开放资源构建 Skill 和虚拟测试，再依据执行诊断与定向检索修订 Skill，供目标任务使用。
- **SimSkill — SimSkill: A Self-Evolving LLM Agent for Skill and Knowledge Accumulation in Traffic Simulation**（2609.03753）：通过执行与评审闭环探索交通仿真任务，再把完成的经历整理为可复用代码 Skill 和相互关联的知识记忆。
- **Growing Harness — Grow the Harness, Not the Context: From Strategy-Free Scaffolds to Reusable Specialist Agents**（2609.26760）：根据失败位置局部修改代码，逐步扩展共享 Harness；联合修复一组任务，并回退损害验证集成功率的更新。
- **JAZ — Harness as a Language: A Minimalist Agent Framework With Maximal Expressivity**（2609.26891）：让元智能体依据任务反馈修订执行智能体的 Prompt 和可执行 Skill，并通过可编程上下文接口支持长程记忆。
- **TISD — TISD: On-Policy Self-Distillation with Trajectory Intervention**（2609.30878）：在教师与学生分歧较大的位置引导轨迹分支，由学生重新生成后续过程并进行蒸馏，再用更新后的学生同步教师。
- **DCE + SRCL — Recursive Self-Improvement via On-Policy Distillation for Reasoning**（2609.30652）：让学生及带参考答案的自教师共同更新，结合在策略蒸馏与经过验证的精简改写，使更新后的能力继续指导下一轮推理学习。
- **SkillRefine — SkillRefine: Cross-Source Skill Induction and Execution Validation for LLM Agents in Refinery Planning Software**（2609.30674）：结合文档与专家操作记录构建炼油规划 Skill，再依据执行约束和参考结果对照，修复技能内容与检索元数据。
- **Harness-Zero — Harness-Zero: Harness Distillation via Agent-as-Harness**（2609.24974）：根据反复出现的失败改进领域共享 Harness，再由审核智能体将其指导转为修正后的执行轨迹，通过蒸馏让学生在移除专用 Harness 后保留相关能力。
- **MCE — Meta Context Engineering via Agentic Skill Evolution**（2601.21557）：元智能体参考并组合历史上下文工程 Skill，基础智能体依据任务反馈更新可复用的上下文文件和检索代码，再通过验证集选择表现更好的上下文。
- **TTSE — TTSE: A Two-Track Online Self-Evolution Framework**（2609.24289）：将环境事实与条件化操作方法分别存储，依据任务反馈淘汰误导规则、整理冲突并更新两个规则库，供后续任务使用；在 GDPevo 上进行了双轨设计的消融实验。
- **SkillPivot — A Wrong Turn Does Not Ruin the Journey: Deviation-Guided Skill Self-Evolution for LLM Agents**（2609.29154）：定位失败轨迹开始偏离的步骤，与教师从相同前缀继续执行的成功过程对照，再通过原有规则保留和泛化性检查筛选局部 Skill 修改。
- **Designer-RSI — Designer-RSI: Evolving Procedural Memory from User Traffic for Agentic Graphic Design**（2609.22086）：从用户设计任务的执行经验中补充和修订流程技能，通过固定上游条件的成对重放，仅保留有提升且不损害已有成功表现的修改。
- **AlgoEvo — AlgoEvo: Self-Evolving Agentic Search for Automated Algorithm Discovery**（2609.15820）：把算法搜索的执行反馈存为持久经验卡片，再将多个任务共同支持的有效模式提炼为设计 Skill，指导后续算法发现。
- **PILOT — PILOT in the Loop: Live Self-Improvement for Long-Horizon Agents**（2608.26530）：监督智能体在任务执行中纠正工作智能体的行动，并更新可复用 Skill 与记忆；成功执行产生的更新再汇入后续轮次的共享状态。
- **SkillHEX — SkillHEX: Improving Agent Skills via Hypothesis-Driven Autonomous Exploration and Exploitation**（2608.05628）：将失败原因假设转为可执行测试，在缓存输出上验证，再把证据共享给不同 Skill 修改分支，指导有限尝试预算下的测试时改进。
- **KSI — Knowledge-Centric Self-Improvement**（2607.19592）：每次任务使用新的智能体会话，通过有证据支撑的任务讨论、跨任务讨论和知识整理，持续更新供后续智能体使用的共享知识库。
- **SAGEAgent — SAGEAgent: A Self-Evolving Agent for Cost-Aware Modality Acquisition in Multimodal Survival Prediction**（2607.09521）：积累检查决策经验，根据成本与不确定性反馈周期性修订显式规则，让参数固定的智能体改进对后续诊断模态的选择。
- **HGM — Huxley-Gödel Machine: Human-Level Coding Agent Development by an Approximation of the Optimal Self-Improving Machine**（2510.21614）：根据后代版本的表现估计编码智能体的自我改进潜力，据此选择哪些历史版本继续修改自身代码、哪些版本值得追加评测。
- **RRSI — RRSI: Regularized Recursive Self-Improvement of Agent Harnesses**（2609.24972）：通过逐步收紧修改预算、利用历史证据、检查任务泄漏及约束执行成本，减少 Harness 进化对进化任务集的过拟合。
- **Procedural Graphs — Procedural Graphs: Self-Evolving Execution Structures for LLM Agents**（2609.09153）：对照成功与失败轨迹更新流程图，验证后保留有效修改，再将相关子图转为逐步行动指引，帮助智能体完成后续任务。
- **Experience Funnel — Experience Funnel: A State-Policy Alternating Loop for Self-Evolving Agents**（2609.08919）：交替更新文本经验状态和学生模型参数：先验证经验修改是否有效，再将有用行为蒸馏到模型，更新后的状态与模型继续参与下一轮。
- **NeoHorse-1 — NeoHorse-1: Towards Recursive Self-Improvement via Agentic Post-Training with Routing Harness**（2609.08183）：利用路由和验证信号整理智能体经验用于后训练，再根据更新后模型的能力短板调整下一轮训练数据配比，形成评估、选数与参数更新的闭环。
- **Ecdysis — Ecdysis: Efficient and Effective Training of Runtime Harnesses for LLM Agents**（2609.11677）：把一批任务中的失败整理为修复说明，修改可执行的运行时 Harness，并以训练任务上的总体表现决定保留修改还是回退。
- **COBRA-Skills — COBRA-Skills: Contextual Bandit-Guided Evolution for Agent Skill Optimization**（2609.11682）：用上下文 Bandit 分配 Skill 的评测预算，再依据实际任务奖励进行筛选、变异和交叉组合，持续优化 Skill 候选群体。
- **RSIAgent — RSIAgent: Autonomous Exploration for Recursive Self-improvement in New Environments**（2609.15364）：由课程生成、任务执行和验证三个角色探索新环境，依据验证后的经验更新可复用记忆，再冻结记忆用于后续任务执行。
- **ModularRSI — ModularRSI: Modular and Generalizable Recursive Harness Self-Improvement**（2609.14857）：把 Harness 拆为五个模块，分别根据执行经验自我修改，检查补丁的有效性，再将保留的模块整合为可迁移的智能体。
- **EvoOntology — EvoOntology: A Self-Evolving Ontology Layer for Data Agents**（2609.15779）：根据数据探查和任务轨迹，分别更新数据智能体的内容记忆、本体结构与可执行工具层，并通过成对验证筛选修改。
- **EvoSkill-GUI — Reflect, Revise, Reuse: Training-Free Skill Evolution for GUI Agents**（2609.17653）：在 GUI 执行过程中以及完整轨迹复盘后修改可复用 Skill 包，将改进后的操作流程和故障恢复经验留给后续相似任务。
- **EvolveTrade — EvolveTrade: Experience-Driven Policy Refinement for Self-Evolving LLM Trading Agents**（2609.17632）：周期性汇总交易决策、工具调用、分析理由和已实现收益，重写交易智能体的文本策略，让后续交易使用更新后的操作规则。
- **SkillAA — SkillAA: Attribution-Guided Skill-Graph Updating with Targeted Validation and Rollback**（2609.20455）：把任务失败归因到 Skill 图中的具体节点，提出局部修改，再通过受影响样本和完整更新集的两级验证决定保留或回退。
- **SIFT — Self Improvement via Fast Tree-search**（2609.19526）：在编码智能体的版本树上搜索，结合代码两两比较和实际任务评测挑选分支，减少筛选有效修改所需的昂贵运行次数。
- **Harness-of-Harness — Harness-of-Harness: Multi-Day Autonomous Software Development with Continual Improvement**（2609.01481）：通过跨多天的规划、开发和 QA 循环，持续保留项目状态与验证证据，让后续迭代在已有成果和反馈上继续改进软件。
- **SoL-Pi — SoL-Pi: Recursively Scaling Auto-Research Loops for Efficient Agent Harness**（2609.20519）：并行运行多条 Harness 改进循环，在维持任务能力的约束下验证效率收益，再组合保留的机制，降低智能体的执行成本。
- **RISE — RISE: Recursive Improvement via Self-Extrapolating Policy Distillation**（2609.05295）：交替进行可验证奖励训练和自蒸馏，用自身检查点的变化方向外推构造教师，并随学生更新不断刷新教师。
- **CHIME — CHIME: Credit-Aware Hierarchical Memory Evolution for Long-Horizon Agentic Planning**（2609.02074）：分开维护规划记忆和执行记忆，先判断任务成败的原因，再更新对应记忆库以指导后续任务，全程不修改模型参数。
- **AutoTTS — LLMs Improving LLMs: Agentic Discovery for Test-Time Scaling**（2605.08083）：让 LLM 智能体在由预先采集的推理轨迹和探测信号构成的环境中，为其他 LLM 自动发现测试时扩展控制器，并利用执行轨迹反馈修改控制程序，发现的策略可迁移到未见基准和其他模型规模。
- **EnvHarness — EnvHarness: Awakening Static Worlds for Agent Learning**（2608.19880）：根据策略轨迹设计并验证环境插件，将新经验提炼为可复用的 Skill 记忆，再针对已积累 Skill 的策略继续改造环境；另有实验在改造后的环境中训练模型参数。
- **TTCS — TTCS: Test-Time Curriculum Synthesis for Self-Evolving**（2601.22628）：在测试时训练中让问题合成器与求解器协同演化：合成器依据求解器反馈生成逐步变难的测试题变体，求解器在原题和合成题上用自洽性奖励更新参数。
- **VisPlay — VisPlay: Self-Evolving Vision-Language Models from Images**（2511.15661）：让同一基座 VLM 分别扮演基于图像提问的 Questioner 和多模态 Reasoner，用带多样性与难度奖励的 GRPO 联合训练，仅凭无标注图像持续提升视觉推理能力。
- **MM-Zero — MM-Zero: Self-Evolving Multi-Model Vision Language Models From Zero Data**（2603.09206）：从同一基座 VLM 训练 Proposer、Coder、Solver 三个角色：Proposer 生成视觉概念和问题，Coder 将其转为可执行代码渲染成图像，Solver 在生成的图像上推理，从零种子图像出发自行生产多模态训练数据。
- **G-Zero — G-Zero: Self-Play for Open-Ended Generation from Zero Data**（2605.09959）：面向开放式生成的 Proposer 与 Generator 协同演化：Proposer 通过 GRPO 学习寻找能让 Generator 在提示条件下回答变化最大的问题和提示，Generator 通过 DPO 内化这些提示带来的改进，全程不依赖外部评判模型。
- **R-Zero — R-Zero: Self-Evolving Reasoning LLM from Zero Data**（2508.05004）：从同一基座模型初始化 Challenger 与 Solver：Challenger 因提出处于 Solver 能力边界的问题而获得奖励，Solver 用多数投票伪标签训练，课程随轮次跟随 Solver 的能力变化，全程不依赖外部数据。
- **Dream-RSI — Dream-RSI: Recursive Self-Improvement through Evolving Worlds**（dream-rsi）：把历史搜索树作为回放环境，以较低成本评估和修改探索策略代码，再将选出的策略投入新一轮真实搜索，持续积累后续改进可用的经验。
- **SkillAdam — SkillAdam: Stable and Efficient Skill Evolution for Agents**（2609.08944）：用持续更新的问题记录指导 Skill 修改，根据近期改进的波动控制改动幅度，并通过批量评测保留有效且未明显损害已有表现的版本。
- **SkillGLoW — SkillGLoW: Procedural-Family Skill Consolidation for Self-Improving Agents on Long-Horizon Task Streams**（2609.02217）：按共同的解题流程归纳任务中的局部经验，整理为可复用的 Skill，通过实际执行检验技能库更新，再与当前任务新生成的局部 Skill 配合使用。
- **ACE — Agentic Context Engineering: Evolving Contexts for Self-Improving Language Models**（2510.04618）：根据执行反馈增量更新结构化策略手册，保留有效策略、修订已有经验并清理重复内容，让后续任务继续使用。
- **GEPA — GEPA: Reflective Prompt Evolution Can Outperform Reinforcement Learning**（2507.19457）：读取执行轨迹和任务反馈来反思、修改 Prompt，再通过评测和 Pareto 搜索保留候选，并组合不同版本的互补改进。
- **Dynamic Cheatsheet — Dynamic Cheatsheet: Test-Time Learning with Adaptive Memory**（2504.07952）：跨问题维护并更新一份包含策略和代码片段的经验小抄，从既往尝试中整理经验，供后续问题复用。
- **Hyperagents — Hyperagents**（2603.19461）：把任务 Agent 和负责修改它的 Meta-Agent 放进同一个可编辑程序，让历史版本既能改进解题代码，也能修改生成后续改进的方法。
- **GEA — Group-Evolving Agents: Open-Ended Self-Improvement via Experience Sharing**（2602.04837）：汇集一组历史 Agent 的代码修改、执行轨迹和任务结果，再用共享证据分别改进各自的 Harness，让不同分支能互相借鉴经验。
- **PANDO — PANDO: Efficient Multimodal AI Agents via Online Skill Distillation**（2605.24785）：从已完成的网页交互中提炼规则和可执行流程，在后续使用中更新置信度、合并重复 Skill，并淘汰反复失效的 Skill。
- **DIVE — DIVE: Unlocking Self-Improvement in Frozen Language Models Through Diversity-Driven Skill Evolution**（2608.12486）：用固定参数的模型演化多组 Skill，组合不同父代的有效做法，并根据实测收益调整生成新 Skill 的操作策略。
- **EvolveNet — EvolveNet: Collaborative Harness Evolution for Agent Self-Improvement**（2608.04968）：让多个节点在各自的任务上改进同一 Harness，再按适用范围整合有证据支持的修改，通过回归检查后发布下一版。
- **DarwinX — DarwinX: Evolving Agent Harnesses Through Natural Selection**（2608.07545）：对 Harness 版本进行分支演化和重组，保留不同版本的互补能力，并通过重复评测与回归检查筛掉不稳定的提升。
- **MOSS — MOSS: Self-Evolution through Source-Level Rewriting in Autonomous Agent Systems**（2605.22794）：根据部署中的失败修改 Agent 源码，重建后回放相关任务，再通过用户确认和健康检查将修复应用到后续运行。
- **SkillRevise — SkillRevise: Improving LLM-Authored Agent Skills via Trace-Conditioned Skill Revision**（2606.01139）：根据执行轨迹和验证反馈诊断 Skill 的问题，借助修订原则改写 Skill，并在有限预算内保留实测表现最好的候选版本。
- **ISM — ISM: Self-Improving Strategy Memory for Continual Mathematical Reasoning**（2606.31191）：维护经过验证的数学策略库，根据成功与失败持续修订、合并、强化或删除记忆，让不同任务之间通过显式策略积累经验。
- **ExpGraph — ExpGraph: Model-Agnostic Experience Learning with Graph-Structured Memory for LLM Agents**（2605.30712）：把任务历史整理为持续维护的经验图谱，通过使用记忆与不使用记忆的实测差异学习检索策略，任务执行模型保持固定。
- **DemoEvolve — DemoEvolve: Overcoming Sparse Feedback in Agentic Harness Evolution with Demonstrations**（2605.24539）：用高质量人类轨迹作为参照，帮助 Coding Proposer 在长程环境中诊断稀疏且嘈杂的失败信号，并生成更稳定的 Harness 修改。
- **HarnessX — HarnessX: A Composable, Adaptive, and Evolvable Agent Harness Foundry**（2606.14249）：把提示词、工具、记忆和控制流组织为可组合的类型化 Harness 组件，根据执行轨迹持续改写，并可进一步把轨迹转化为模型训练信号。
- **HarnessBank — HarnessBank: Semantic Gene-Bank Search with Gated Verification for Agent-Harness Self-Evolution**（2607.13683）：维护语义上多样的高性能 Harness 基因库，对其中的机制进行重新设计或组合，并只让通过门控验证的后代进入基因库。
- **RHI — Recursive Harness Self-Improvement**（2607.15524）：把 Agent Loop 表示为提示级 Harness，并利用相邻版本输出之间逐轮积累的成对反馈反复修改它。
- **Gödel Agent — Gödel Agent: A Self-Referential Agent Framework for Recursive Self-Improvement**（2410.04444）：让智能体读取并重写自己的可执行逻辑，其中也包括后续用于自我修改的逻辑，再通过实证评测选择更好的后代版本。
- **SEAL — Self-Adapting Language Models**（2506.10943）：模型自行生成用于微调的数据和更新指令，并根据更新后模型的下游表现，学习哪些 self-edit 能带来有效的权重变化。
- **DGM — Darwin Gödel Machine: Open-Ended Evolution of Self-Improving Agents**（2505.22954）：维护多个编程智能体版本，从档案中选择父代并重写其 Harness 代码，再把经实证验证的后代作为后续演化的踏脚石。
- **AWM — Agent Workflow Memory**（2409.07429）：从示范轨迹或智能体已经完成的网页任务中提炼可复用工作流，并在后续任务中检索这些流程来指导行动。
- **A-MEM — A-MEM: Agentic Memory for LLM Agents**（2502.12110）：把新记忆整理成结构化卡片，并让它更新相关历史记忆的摘要、属性和链接，逐步形成类似卡片盒笔记法的动态知识网络。
- **Cradle — Cradle: Empowering Foundation Agents Towards General Computer Control**（2403.03186）：面向长程电脑操作持续记录观察与反思，在出现可复用流程时创建可执行技能，并在后续交互中检索和调用。
- **R-Few — Guided Self-Evolving LLMs with Minimal Human Supervision**（2512.02472）：用少量人工监督引导 Challenger–Solver 自博弈：Challenger 抽取少量人工标注样例来约束出题，Solver 在人工与合成数据混合的在线难度课程上训练，从而缓解概念漂移和多样性坍缩。
- **ReasoningBank — ReasoningBank: Scaling Agent Self-Evolving with Reasoning Memory**（2509.25140）：从自行判断的成功和失败轨迹中提炼可泛化的推理策略，供后续任务检索，并通过增加测试时 rollout 持续丰富和改进记忆库。
- **Mem²Evolve — Mem²Evolve: Towards Self-Evolving Agents via Co-Evolutionary Capability Expansion and Experience Distillation**（2604.10923）：让经验记忆与能力资产共同演化：历史经验指导新工具或专家智能体的创建，新能力在执行中又产生下一轮可复用的经验。
- **When Rules Learn — When Rules Learn: A Self-Evolving Agent for Legal Case Retrieval**（2606.17220）：智能体自行生成查询改写规则、规划规则组合实验，并依据法律案例检索指标淘汰没有效果的规则。
- **HeLa-Mem — HeLa-Mem: Hebbian Learning and Associative Memory for LLM Agents**（2604.16839）：通过 Hebbian 共激活持续调整情景记忆图，再由反思模块把连接密集的记忆枢纽蒸馏为可复用的语义知识。
- **Memp — Memp: Exploring Agent Procedural Memory**（2508.06433）：把历史轨迹蒸馏为细粒度步骤说明和脚本式流程，并随着经验积累持续新增、纠错和淘汰程序记忆。
- **Meta-Harness — Meta-Harness: End-to-End Optimization of Model Harnesses**（2603.28052）：让 Agentic Proposer 通过文件系统查看所有历史候选方案的代码、分数和执行轨迹，再搜索表现更好的任务专用 Harness 代码。
- **Escher-Loop — Escher-Loop: Mutual Evolution by Closed-Loop Self-Referential Optimization**（2604.23472）：同时维护任务智能体与优化器智能体两个群体；优化器既修改任务程序也修改自身，而任务智能体的得分又反过来驱动优化器演化。
- **AHE — Agentic Harness Engineering: Observability-Driven Automatic Evolution of Coding-Agent Harnesses**（2604.25850）：把成批的编程智能体轨迹提炼为分层诊断，修改文件级 Harness 组件，再用下一轮任务结果验证或撤销每项预期改动。
- **Continual Harness — Continual Harness: Online Adaptation for Self-Improving Foundation Agents**（2605.09998）：在不重置环境的情况下，每隔若干步根据近期轨迹更新 Prompt、子智能体、技能和记忆，并可利用过程奖励标注的轨迹继续更新模型参数。
- **SkillSmith — SkillSmith: Co-Evolving Skills and Tools for Self-Improving Agent Systems**（2606.01314）：根据失败证据联合修改技能与可执行工具，通过逐级测试验证整组改动，并用反模式记忆阻止系统重复已知错误。
- **SePO — SePO: Self-Evolving Prompt Agent for System Prompt Optimization**（2606.04465）：先在多任务池上进化 Prompt Agent 自己的系统提示词，再用改进后的提示词优化器为目标任务进化 Task Agent 的提示词。
- **HarnessFix — From Failed Trajectories to Reliable LLM Agents: Diagnosing and Repairing Harness Flaws**（2606.06324）：把失败轨迹编译为 Harness 感知的中间表示，将故障归因到具体步骤和组件，再生成局部补丁并通过回归验证决定是否保留。
- **Self-Harness — Self-Harness: Harnesses That Improve Themselves**（2606.09498）：由同一个固定模型归纳反复出现的失败，提出对自身 Harness 的局部修改，并只合并通过 held-in 与 held-out 回归测试的候选方案。
- **Red Queen Gödel Machine — The Red Queen Gödel Machine: Co-Evolving Agents and Their Evaluators**（2606.26294）：把档案式自我改进扩展为智能体与效用函数或评价器的共同演化，同时在每个评测 epoch 内保持选择标准稳定。
- **Mendel Gödel Machine — Mendel Gödel Machine: Recursive Self-Improving Coding Agents via Comparative Evolution**（2608.07645）：利用多项任务证据或另一条谱系的轨迹改进编程智能体后代，在档案搜索中加入反应规范变异和跨谱系杂交。
- **Recuris — Recursive Experiential-Working Memory Evolution for Long-Horizon Agent Harnesses**（2608.24876）：用工作记忆与经验记忆的耦合定位长程执行中的记忆故障，再由固定 Meta-Agent 对技能记忆进行经过验证的局部更新。
- **TRACE — TRACE: A Self-Evolving Skill Bank for Consistent, Limit-Aware LLM Agents**（2608.22793）：按照被调用的技能对轨迹分组，在每轮评测后对比成功与失败行为，从而重写可复用的行为技能库。
- **Evo-Harness — Evo-Harness: Context-to-Harness Skill Compilation for Self-Evolving Agents**（2608.15071）：每个一次性任务结束后，Solver 提供候选经验，再由独立 Evolver 把有效上下文编译成供后续任务复用的结构化 Harness 技能。
- **HyperSkill — HyperSkill: Self-Evolving LLM Agents via Hypergraph-Structured Skill Memory**（2608.16114）：把子任务和可复用技能组织成轨迹超图，通过两条结构路径进行检索，并根据实际效用定期剪枝或合并技能。
- **MediSkill-Evo — MediSkill-Evo: Process-Constrained Self-Evolution for Evidence-Grounded Clinical Interaction**（2608.23397）：临床交互经验只有通过来源、作用范围和流程约束检查后，才会写入四类知识库，并用于约束后续行动。
- **Prime Agent — Prime Agent: A Self-Improving RLM Harness**（2608.23552）：一个持久化的 RLM 风格 Harness，跨轨迹保存历史、记忆、技能、提示词和子智能体配置，让后续工作能够继续利用此前形成的上下文。
- **P²O — P²O: Joint Policy and Prompt Optimization**（2603.21877）：一个纯自我改进闭环：交替进行策略优化与提示词优化，由演化提示词为策略学习提供更优探索模板，再把策略不断提升后发现的更难样本作为下一轮提示词演化的高价值 seed，并将提示词带来的增益蒸馏进模型参数。
- **WikiSkill — WikiSkill: Compiling Agent Experience into Persistent Knowledge for Skill Evolution**（2608.27454）：用不可变的原始轨迹和持续更新的 Wiki 保存跨轮经验，即使候选 Skill 被拒，后续提案仍能利用这些证据继续改进。
- **HarnessEvolve — HarnessEvolve: Learning from Reference Trajectories for Reliable Agent Self-Evolution**（2609.00829）：把失败轨迹与已验证的参考轨迹对照以定位根因，再让 Harness 修改依次通过质量检查和近期性能门槛。

## Benchmark 目录

| Benchmark／原文 | 原索引模式 | 本次证据 | FDE 使用方式 |
| --- | --- | --- | --- |
| [Aspire · 2608.31111](https://arxiv.org/abs/2608.31111) | Online, Repeated / iterative, Offline | 索引 | 条件候选；选 harness 分支及 final-only 反馈协议。 |
| [MLS-Bench · 2605.08678](https://arxiv.org/abs/2605.08678) | Online, Repeated / iterative | 索引 | 候选保留：核对原始划分；在线序列需事先确定训练段与冻结测试段。 |
| [SEAGym · 2606.17546](https://arxiv.org/abs/2606.17546) | Offline | 索引 | 优先补读；快照、迁移、保留能力的分离评测。 |
| [S3Gym · 2608.31100](https://arxiv.org/abs/2608.31100) | Offline | 索引 | 优先补读；探索与评测 seed 分离，非参数分支可用。 |
| [VeRO · 2602.22480](https://arxiv.org/abs/2602.22480) | Offline | 索引 | 候选保留：核对原始划分；在线序列需事先确定训练段与冻结测试段。 |
| [HarnessDev · 2609.01437](https://arxiv.org/abs/2609.01437) | Offline | 索引 | 优先补读；区分 Creation 与 Evolution 的增益。 |
| [Evo-Bench · 2608.09096](https://arxiv.org/abs/2608.09096) | Offline | 索引 | 候选保留：核对原始划分；在线序列需事先确定训练段与冻结测试段。 |
| [FinEvo-Bench · 2608.06144](https://arxiv.org/abs/2608.06144) | Online, Random order, Streaming | 全文 | 金融候选；长期在线流需改为场景内训练后冻结。 |
| [HarnessOpt-Bench · 2608.06301](https://arxiv.org/abs/2608.06301) | Offline | 索引 | 优先补读；索引描述隐藏 test 与预算受控的代码优化。 |
| [GDPevo · 2608.03764](https://arxiv.org/abs/2608.03764) | Offline | 全文 | 首选；使用原始 5 train / 5 test，按企业分别训练。 |
| [PAST-Bench · 2608.04003](https://arxiv.org/abs/2608.04003) | Online, Repeated / iterative | 索引 | 候选保留：核对原始划分；在线序列需事先确定训练段与冻结测试段。 |
| [ContinualSkillBench · 2608.03874](https://arxiv.org/abs/2608.03874) | Online, Curriculum, Streaming | 索引 | 候选保留：核对原始划分；在线序列需事先确定训练段与冻结测试段。 |
| [PATH-Bench · 2608.01149](https://arxiv.org/abs/2608.01149) | Online, Streaming | 索引 | 候选保留：核对原始划分；在线序列需事先确定训练段与冻结测试段。 |
| [AgentStream · 2608.00155](https://arxiv.org/abs/2608.00155) | Online, Random order, Streaming | 索引 | 候选保留：核对原始划分；在线序列需事先确定训练段与冻结测试段。 |
| [RSIBench-Data · 2607.25886](https://arxiv.org/abs/2607.25886) | Online, Repeated / iterative | 索引 | 范围外方法评估：用于权重训练／数据研发；保留预算与隐藏测试设计参考。 |
| [EvoAgentBench · 2607.05202](https://arxiv.org/abs/2607.05202) | Offline | 索引 | 候选保留：核对原始划分；在线序列需事先确定训练段与冻结测试段。 |
| [EdgeBench · 2607.05155](https://arxiv.org/abs/2607.05155) | Online, Repeated / iterative | 索引 | 候选保留：核对原始划分；在线序列需事先确定训练段与冻结测试段。 |
| [CL-Bench · 2606.05661](https://arxiv.org/abs/2606.05661) | Online, Streaming | 索引 | 候选保留：核对原始划分；在线序列需事先确定训练段与冻结测试段。 |
| [AutoLab · 2606.05080](https://arxiv.org/abs/2606.05080) | Online, Repeated / iterative | 索引 | 候选保留：核对原始划分；在线序列需事先确定训练段与冻结测试段。 |
| [Meta-Agent Challenge · 2606.04455](https://arxiv.org/abs/2606.04455) | Offline | 索引 | 候选保留：核对原始划分；在线序列需事先确定训练段与冻结测试段。 |
| [Curation-Bench · 2606.04261](https://arxiv.org/abs/2606.04261) | Online, Repeated / iterative | 索引 | 范围外方法评估：用于权重训练／数据研发；保留预算与隐藏测试设计参考。 |
| [EvoMemBench · 2605.18421](https://arxiv.org/abs/2605.18421) | Online, Streaming | 索引 | 候选保留：核对原始划分；在线序列需事先确定训练段与冻结测试段。 |
| [SkillLearnBench · 2604.20087](https://arxiv.org/abs/2604.20087) | Online, Streaming | 索引 | 优先补读；确认多层指标与跨案例迁移。 |
| [SkillFlow · 2604.17308](https://arxiv.org/abs/2604.17308) | Online, Offline, Offline → Online, Repeated / iterative | 索引 | 优先补读；确认任务家族与实际训练／测试关系。 |
| [Agent² RL-Bench · 2604.10547](https://arxiv.org/abs/2604.10547) | Online, Repeated / iterative | 索引 | 范围外方法评估：用于权重训练／数据研发；保留预算与隐藏测试设计参考。 |
| [PostTrainBench · 2603.08640](https://arxiv.org/abs/2603.08640) | Online, Repeated / iterative | 摘要 | 范围外方法评估：用于权重训练／数据研发；保留预算与隐藏测试设计参考。 |
| [Evo-Memory · 2511.20857](https://arxiv.org/abs/2511.20857) | Online, Streaming | 索引 | 候选保留：核对原始划分；在线序列需事先确定训练段与冻结测试段。 |
| [MemoryBench · 2510.17281](https://arxiv.org/abs/2510.17281) | Offline | 索引 | 候选保留：核对原始划分；在线序列需事先确定训练段与冻结测试段。 |
| [StuLife · 2508.19005](https://arxiv.org/abs/2508.19005) | Online, Curriculum, Streaming | 索引 | 候选保留：核对原始划分；在线序列需事先确定训练段与冻结测试段。 |
| [MemoryAgentBench · 2507.05257](https://arxiv.org/abs/2507.05257) | Offline | 索引 | 候选保留：核对原始划分；在线序列需事先确定训练段与冻结测试段。 |
| [LifelongAgentBench · 2505.11942](https://arxiv.org/abs/2505.11942) | Online, Streaming | 索引 | 候选保留：核对原始划分；在线序列需事先确定训练段与冻结测试段。 |

## Benchmark 完整标题

- **Aspire**（2608.31111）：Aspire: Can Models Self-Evolve from Vague Goals?
- **MLS-Bench**（2605.08678）：MLS-Bench: A Holistic and Rigorous Assessment of AI Systems on Building Better AI
- **SEAGym**（2606.17546）：SEAGym: An Evaluation Environment for Self-Evolving LLM Agents
- **S3Gym**（2608.31100）：S3Gym: Can LLMs Turn Self-Testing and Self-Judging into Self-Improvement?
- **VeRO**（2602.22480）：VeRO: A Harness for Agents to Optimize Agents
- **HarnessDev**（2609.01437）：HarnessDev: Can LLMs Create and Evolve Their Own Agent Harness?
- **Evo-Bench**（2608.09096）：Evo-Bench: Can Language Models Improve Agent Harness?
- **FinEvo-Bench**（2608.06144）：FinEvo-Bench: A Longitudinal Benchmark for Self-Evolving Agents in Professional Financial Workflows
- **HarnessOpt-Bench**（2608.06301）：HarnessOpt-Bench: Evaluating LLMs at Harness Optimization
- **GDPevo**（2608.03764）：GDPevo: Evaluating Agent Self-Evolution on Real Business Tasks
- **PAST-Bench**（2608.04003）：PAST-Bench: Benchmarking the Foundations of Recursive Self-Improvement in Personal Agents
- **ContinualSkillBench**（2608.03874）：ContinualSkillBench: Can LLM Agents Truly Evolve Their Capabilities?
- **PATH-Bench**（2608.01149）：PATH-Bench: Path-Dependent Evaluation of Lifelong Agents
- **AgentStream**（2608.00155）：AgentStream: How Well Do Self-Evolving LLM Agents Perform Under Streaming Tasks?
- **RSIBench-Data**（2607.25886）：RSIBench-Data: Benchmarking Data-Centric Research for Recursive Self-Improvement
- **EvoAgentBench**（2607.05202）：EvoAgentBench: Benchmarking Agent Self-Evolution via Ability Transfer
- **EdgeBench**（2607.05155）：EdgeBench: Unveiling Scaling Laws of Learning from Real-World Environments
- **CL-Bench**（2606.05661）：Continual Learning Bench: Evaluating Frontier AI Systems in Real-World Stateful Environments
- **AutoLab**（2606.05080）：AutoLab: Can Frontier Models Solve Long-Horizon Auto Research and Engineering Tasks?
- **Meta-Agent Challenge**（2606.04455）：The Meta-Agent Challenge: Are Current Agents Capable of Autonomous Agent Development?
- **Curation-Bench**（2606.04261）：Can Generalist Agents Automate Data Curation?
- **EvoMemBench**（2605.18421）：EvoMemBench: Benchmarking Agent Memory from a Self-Evolving Perspective
- **SkillLearnBench**（2604.20087）：SkillLearnBench: Benchmarking Continual Learning Methods for Agent Skill Generation on Real-World Tasks
- **SkillFlow**（2604.17308）：SkillFlow: Benchmarking Lifelong Skill Discovery and Evolution for Autonomous Agents
- **Agent² RL-Bench**（2604.10547）：Agent² RL-Bench: Can LLM Agents Engineer Agentic RL Post-Training?
- **PostTrainBench**（2603.08640）：PostTrainBench: Can LLM Agents Automate LLM Post-Training?
- **Evo-Memory**（2511.20857）：Evo-Memory: Benchmarking LLM Agent Test-time Learning with Self-Evolving Memory
- **MemoryBench**（2510.17281）：MemoryBench: A Benchmark for Memory and Continual Learning in LLM Systems
- **StuLife**（2508.19005）：Building Self-Evolving Agents via Experience-Driven Lifelong Learning: A Framework and Benchmark
- **MemoryAgentBench**（2507.05257）：Evaluating Memory in LLM Agents via Incremental Multi-Turn Interactions
- **LifelongAgentBench**（2505.11942）：LifelongAgentBench: Evaluating LLM Agents as Lifelong Learners

## 系统目录

| 系统 | 本次证据 | 可复用方向 |
| --- | --- | --- |
| [ReMe](https://github.com/agentscope-ai/ReMe) | 索引 | 一个开源、文件原生的记忆系统，将对话和资源转化为可跨 Agent 共享的持久化 Markdown 记忆。其 Auto Dream 流程会增量地把发生变化的每日笔记沉淀为相互链接的长期知识，创建、佐证、完善或纠正 digest 节点，同时确保持久状态可由用户编辑、派生索引可随时重建。 |
| [Proteus](https://github.com/proteus-evolve/Proteus) | 索引 | 一个与具体 Harness 解耦的开源自我演化框架，用于运行和测量迭代式自我改进。每个 episode 都使用全新的模型上下文，Agent 可以修改预先声明的 Harness 区域；代码改动通过验证后才会启用，版本化快照则保留完整的演化历史。 |
| [Reef](https://github.com/Human-Agent-Society/reef) | 索引 | 开源的服务层，在真实流量上运行改进循环。它在兼容 OpenAI 与 Anthropic 的推理端点后记录每次交互，将后续反馈回匹到对应回执，并构建针对模型权重或 harness 树（规则、技能、提示词、配置与扩展）的候选更新。harness 配方会在配置任务上对比当前版本与候选版本，仅当候选胜出时才发布，并在服务不中断的前提下保留版本历史。 |

## 本次补充的工作

| 工作／原文 | 本次证据 | 处置 |
| --- | --- | --- |
| [APE · 2211.01910](https://arxiv.org/abs/2211.01910) | 全文 | 指令生成与选择；缺少显式 trace 诊断，但适合简单基线。 |
| [ProTeGi · 2305.03495](https://arxiv.org/abs/2305.03495) | 全文 | 文字反馈、beam、bandit；开发集可对应 training，修正 test 选 beam 的边界。 |
| [OPRO · 2309.03409](https://arxiv.org/abs/2309.03409) | 摘要 | 候选和分数历史；补核搜索／最终选择数据。 |
| [TextGrad · 2406.07496](https://arxiv.org/abs/2406.07496) | 摘要 | 区分全局 prompt 训练与同题答案优化。 |
| [Reflexion · 2303.11366](https://arxiv.org/abs/2303.11366) | 全文 | 同题反思需改为训练跨题经验。 |
| [Self-Refine · 2303.17651](https://arxiv.org/abs/2303.17651) | 待补原文 | 保留迭代反馈基线；同题改答案本身不满足 FDE。 |
| [Voyager · 2305.16291](https://arxiv.org/abs/2305.16291) | 作者项目资料 | 保留技能库与课程探索；需设计冻结测试。 |
| [ExpeL · 2308.10144](https://arxiv.org/abs/2308.10144) | 待补原文 | 保留经验归纳方向；具体切分待核。 |
| [AutoGuide · 2403.08978](https://arxiv.org/abs/2403.08978) | 待补原文 | 保留条件化经验指导；具体切分待核。 |
| [AutoManual · 2405.16247](https://arxiv.org/abs/2405.16247) | 全文 | 建 manual 后测新环境；优先候选。 |
| [AgentOptimizer · 2402.11359](https://arxiv.org/abs/2402.11359) | 全文 | 训练 trace 与答案更新函数；train/test 清晰，适合工具方向。 |
| [LearnAct · 2402.15809](https://arxiv.org/abs/2402.15809) | 摘要 | action 学习；评测划分待核。 |
| [SkillWeaver · 2504.07079](https://arxiv.org/abs/2504.07079) | 题名／来源 | web 技能程序；补读训练与探索任务边界。 |
| [AFlow · 2410.10762](https://arxiv.org/abs/2410.10762) | 全文 | 工作流搜索；开发／测试分离，工程成本较高。 |
| [ADAS · 2408.08435](https://arxiv.org/abs/2408.08435) | 待补原文 | Meta Agent Search；补核任务划分。 |
| [SkillOpt · 2605.23904](https://arxiv.org/abs/2605.23904) | 全文 | 完整训练／selection／test 与多项训练机制。 |
| [SkillOpt-Lite · 2607.03451](https://arxiv.org/abs/2607.03451) | 全文 | 文件 trace、共性、最小编辑和独立验证；后者不能默默删除。 |
| [SkillsBench · 2602.12670](https://arxiv.org/abs/2602.12670) | 全文＋官方 repo | 测 Skill 效果；需另设学习与冻结测试协议。 |
| [Skill Issue · 2609.12742](https://arxiv.org/abs/2609.12742) | 摘要 | 仓库任务与小样本波动，提醒区分真实增益与噪声。 |
| [OEO · 2608.09629](https://arxiv.org/abs/2608.09629) | 摘要 | 开放优化流程；算法自由度仍受数据、接口和预算约束。 |
| [Promptbreeder · 2309.16797](https://arxiv.org/abs/2309.16797) | 待补原文 | 任务 prompt 与 mutation prompt 进化；Teacher 自优化方向。 |
| [DSPy · 2310.03714](https://arxiv.org/abs/2310.03714) | 摘要 | 模块化 LM 程序与优化器基础设施；具体优化器分别评估。 |
| [MIPRO · 2406.11695](https://arxiv.org/abs/2406.11695) | 摘要 | 联合优化指令与示例；补核选择数据，与后续 MIPROv2 区分。 |
| [MemGPT · 2310.08560](https://arxiv.org/abs/2310.08560) | 摘要 | memory 管理基础能力；内容记忆与 harness 自改分别测量。 |
| [Toolformer · 2302.04761](https://arxiv.org/abs/2302.04761) | 摘要 | 更新模型学习工具使用；冻结权重范围外，保留工具数据思路。 |
| [AutoPrompt · 2010.15980](https://arxiv.org/abs/2010.15980) | 待补原文 | 梯度辅助离散提示优化方向；核实模型访问要求后判断 API 适配。 |
| [Eureka · 2310.12931](https://arxiv.org/abs/2310.12931) | 待补原文 | 奖励代码生成与策略训练方向；与固定模型的业务 harness 区分。 |

以下仅为检索中出现、尚未核实题名与正文的线索，不计入已核查论文：SkillSpec（2610.00704）、Mara Chain（2609.35855）、Coding Agents Strong Prompt Optimizers（2609.26261）、GraphSkillEvo（2609.21749）、Branch2Skill（2608.08677）、BONSAI（2608.07056）、KV-Skill（2608.05475）、DecoEvo（2607.25675）。实现前应核实原文和发布日期，不能按名称推断算法。
