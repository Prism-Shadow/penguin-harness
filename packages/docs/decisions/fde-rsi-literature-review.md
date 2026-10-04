# FDE 场景下的 Harness 自进化文献综述

调研日期：2026-10-03。场景定义见 [FDE 设计](fde-rsi.md)，全部索引候选见[候选清单](fde-rsi-candidates.md)。

## 调研范围与证据

以本地 Awesome-RSI `36e91f8fed67e2cd0c761126f91042513df5d6ae` 为候选入口，保留其中 100 个方法、31 个 benchmark、3 个系统；补充较早的 prompt、memory、tool 工作及 SkillOpt、SkillsBench。分类是检索线索，不能代替论文实验协议。

这是覆盖多个方向的综述和全量候选初筛，不声称读完市场上所有论文。下文明确区分：**全文**表示核对过论文方法与实验章节，**摘要**表示只核对作者发布的摘要，**索引**表示目前依赖 Awesome-RSI 的整理，尚未独立核实。抓取失败的原文不按已读处理。候选保留完整标题、ID、来源和待核问题，避免把初筛判断当成论文结论。

本项目的筛选条件是：权重固定，独立 Teacher 分析训练 trace 并修改 harness，Student 执行期间不自改，最后冻结 harness，在同一企业分布的新任务上测试。原论文若采用在线测试更新、同题反复修正、独立验证集或权重训练，都要说明差别。

影响力与适配度分开判断。本次优先依据原文作者机构和已知发表渠道，未获得可统一比较的实时 citation 数据，因此不列引用数排行榜。新论文来自大机构可以进入候选，但不能因此称为成熟方法。

## 最值得先做的方案

| 优先级 | 工作 | 核心修改对象 | 为什么值得做 | 第一版成本与限制 |
| --- | --- | --- | --- | --- |
| 首个实现 | ACE，2025 | 条目式 playbook／Skill | 明确区分生成、反思和整理；成功与失败都可学；有离线和金融任务实验；Stanford、SambaNova、UC Berkeley | 逐题反思重生成与 ADD／计数器；禁用可选 embedding analyzer 时明确说明 |
| 下一批 | ProTeGi，2023 | 指令／Skill 中的规则 | Microsoft；从错误生成文字反馈，再改提示词；开发集与测试集分开 | 小到中；完整方法还有 beam 与 bandit，不能删掉后仍称完整复现 |
| 下一批 | AgentOptimizer，2024 | 可调用函数／工具 | 把函数当可学习权重，输入训练执行历史，输出函数增删改；与 FDE 类比直接对应 | 中；需要工具执行验证与回滚 |
| 下一批 | SkillOpt-Lite，2026 | Skill；扩展到 harness code | 文件系统 trace 检索、共性分析、局部修改；NTU MMLab、Microsoft 等作者机构 | 流程小；独立 validation gate 与当前只分 train/test 的约定不同 |
| 下一批 | GEPA，2025 | 一个或多个 prompt | Berkeley、Stanford、MIT、Databricks 等；轨迹反思和 Pareto 搜索适合比较候选 | 中；必须保留候选谱系、开发评测预算和选择机制 |
| 已适配 | AWM，2024 | 参数化工作流 | 论文同时研究离线与在线 workflow induction；Teacher 从成功训练经历提取子流程 | 采用 online_train，逐题归纳并立即复用；规范 offline 与在线机制分开 |
| 无标注分支 | ReasoningBank，2025 | 推理经验 memory | Google Cloud AI Research；从自判成功和失败中提炼经验 | 小到中；原生在线测试学习，要改为训练期学习、测试冻结 |

ACE 作为第一版不代表它一定得分最高。它能用较少实现步骤检验本项目最关心的事：Teacher 是否能从业务 trace 中提取可复用规则。之后再比较更简单的“整段提示词重写”和更复杂的搜索／验证方法，才能判断 ACE 各部件的实际价值。

## Prompt 与 context 优化

| 工作与证据 | 原始评测方式 | 与 FDE 的关系 |
| --- | --- | --- |
| [APE](https://arxiv.org/abs/2211.01910)，全文 | 从示例生成指令，再按任务表现选择；使用 Instruction Induction、BIG-Bench 等指令任务 | 可做低成本 prompt 基线；生成示例与评测任务需分开，原生机制不要求长 trace 分析 |
| [ProTeGi](https://aclanthology.org/2023.emnlp-main.494/)，全文，§2–3 | 训练 mini-batch 产生“文字梯度”，beam 扩展和 bandit 选择；Jailbreak、Ethos、Liar、Sarcasm；每任务抽 50 个开发样本和 150 个测试样本，3 次试验，报告 binary F1 | 开发数据可对应本项目 training；最终候选必须只按训练反馈选。论文提到对最终 beam 做 test maxpool，直接复制会违反本项目“testing 不选版本”的规约 |
| [OPRO](https://arxiv.org/abs/2309.03409)，摘要 | 优化器看到候选指令和分数历史；论文涉及 GSM8K、BBH | 容易做成 Teacher Skill；需要进一步核对完整划分、搜索预算与最终选择规则，不能用摘要推断隔离严格程度 |
| [TextGrad](https://arxiv.org/abs/2406.07496)，摘要 | 用文字反馈反向传递到可优化变量，涉及 prompt、代码等任务 | 全局提示词训练可以适配；针对单道测试题修改答案／代码的实验只算 test-time refinement |
| [GEPA](https://arxiv.org/abs/2507.19457)，全文，§3–4 | HotpotQA、IFBench、HoVer、PUPA；训练 trace 用于修改，validation 用于候选选择，test 报最终分；minibatch 3，比较 rollout 预算 | 与 FDE 高度契合，但 train 与 validation 的角色应保留。若合并到一个 training benchmark，需命名为两分法适配；不能读取 testing 做 Pareto 选择 |
| [ACE](https://arxiv.org/abs/2510.04618)，全文，§3–4 | AppWorld 的 TGC/SGC；FiNER 与 Formula 的答案准确率；离线在 training 适配后测 test，在线则在 test 流上逐题更新 | 采用离线逐题分支；原实现包含反思重生成、ADD 与计数器更新，可选 validation 选择 best。仅有 train/test 时冻结 final，明确与 validation 选择的区别 |
| [Dynamic Cheatsheet](https://arxiv.org/abs/2504.07952)，全文 | 从持续出现的任务与自身输出更新 cheatsheet，研究 test-time learning | 适配时把可学习任务限定为 train stream；testing 不再更新。额外提供训练 gold 会改变原监督条件 |
| [SePO](https://arxiv.org/abs/2606.04465)，索引 | 同时改 task prompt 和 prompt-optimizer 的 prompt；涉及 AIME、ARC、GPQA、MBPP、Sudoku | 有潜力研究 Teacher 自身优化；需要独立记录 Teacher 版本与训练边界，第一版不加入 |

APE、OPRO、ProTeGi 都说明简单文字优化应当保留为对照。技能文件的扩展名本身不构成新算法；要比较的是如何收集证据、诊断、提出修改和选择版本。

[DSPy](https://arxiv.org/abs/2310.03714) 与 [MIPRO](https://arxiv.org/abs/2406.11695) 也应保留。本次核对了两篇摘要：DSPy 把 LM 程序组织为可优化模块，MIPRO 联合优化多模块的指令与示例。它们提供组合系统和 credit assignment 的参考，具体优化器的数据划分还需按原文及对应实现核查。不能把 DSPy 框架本身视为一个固定 RSI 算法，或将 MIPRO 论文与后续 MIPROv2 实现细节混写。

## Skill 与操作手册

| 工作与证据 | 原始评测方式 | FDE 适配判断 |
| --- | --- | --- |
| [AWM](https://arxiv.org/abs/2409.07429)，全文，§2–3 | Mind2Web、WebArena；离线从训练示例归纳 workflow 后固定测试，在线从自判成功的测试轨迹继续学习 | Penguin 采用 online_train：将原在线成功判别／归纳／复用循环放在训练流，冻结后独立测试。offline 必须提供规范示范；两种模式不混用 |
| [AutoManual](https://arxiv.org/abs/2405.16247)，全文，§3–4 | ALFWorld：36 个训练任务建 manual，134 个 unseen validation 环境充当测试；另有 MiniWoB++、WebArena 实验 | 非常符合“先学手册，再给新任务”的思路；Planner/Builder 的环境交互需适配为批次边界外更新 |
| [SkillOpt](https://arxiv.org/abs/2605.23904)，全文，§3–4 | SearchQA、SpreadsheetBench、OfficeQA、DocVQA、LiveMathematicianBench、ALFWorld；train 产轨迹，selection gate 选 Skill，test 最终报告 | 很有潜力。保留 tree merging、文字编辑预算、拒绝记录、slow update 等机制才是完整方法；当前不宜全部搬入 |
| [SkillOpt-Lite](https://arxiv.org/abs/2607.03451)，全文，§3–5 | 六类任务基本沿用 SkillOpt；文件化轨迹浏览、共性挖掘、最小编辑、独立验证；LiveMath/OfficeQA 划分从 2:1:7 改为 2:2:6 | 最接近“让 Agent 自己看 trace 改 Skill”的轻量流程；但去掉独立验证就改变关键机制，应明确命名适配版本 |
| [SkillRevise](https://arxiv.org/abs/2606.01139)，全文 | 做题、诊断、修订、再执行；区分失败要求和应保留行为，按 utility 选已测 Skill；主体含同任务多次修订 | 诊断方式可复用；把同题修好不能当成新案例泛化，需要用训练任务修 Skill 后另测未见任务 |
| [SkillRefine](https://arxiv.org/abs/2609.30674)，索引 | 炼油规划软件文档、专家记录、执行约束共同修订 Skill；索引描述冻结库后测 PIMS-Bench | 企业业务贴合度高，优先补读全文；目前不能据索引确认划分与预算细节 |
| [SEEK](https://arxiv.org/abs/2609.29803)，摘要＋索引 | 工业搜索评价的路由／知识／执行错误归因，局部改 Skill，检查历史 replay 退化 | 员工 trace / 人工复核路线的好候选；须单独报告先前模型训练和后续冻结权重的 Skill 更新 |
| [TRACE](https://arxiv.org/abs/2608.22793)，索引 | 按使用的 Skill 分组成功／失败轨迹，关注 CAR-bench 多次执行的一致性 | 很符合 bad/good pattern 对比；补核查训练／官方隐藏测试边界，不能把 pass@k 与多次全成功指标混用 |
| [TTSE](https://arxiv.org/abs/2609.24289)，索引 | 分开维护事实和条件化方法，按反馈整理冲突；涉及 GDPevo 等 | 适合企业政策与操作经验分层；先核对是否带来额外检索与维护成本 |
| [SkillEvoReg](https://arxiv.org/abs/2609.30861)，摘要 | 给已有 Skill 方法增加 dropout、复杂度约束及反事实验证，涉及 SkillOpt、SkillEvolBench、ContinualSkillBench | 更适合作为后续受控消融；首版先得到可靠的基础方法与轨迹 |

独立验证可以减少直接拟合训练反馈，但反复选择同一 validation 也会产生适应性偏差。不能把“存在 validation”写成“得到无偏收益保证”。对目前每组只有 5 个训练案例的 GDPevo，额外划分会显著减少可学习样本，因此第一版优先选不以 validation gate 为核心的算法。

## Memory 与经验学习

| 工作与证据 | 原始设置 | 本项目怎样保留 |
| --- | --- | --- |
| [Reflexion](https://arxiv.org/abs/2303.11366)，全文 | ALFWorld、HotpotQA、HumanEval；语言反馈与 episodic memory 支持多次尝试 | 历史影响力大，机制简单；同题再试不能直接算 FDE。可让 Teacher 从 train 失败提取规则，再在新题测，注明跨题适配 |
| [ReasoningBank](https://arxiv.org/abs/2509.25140)，全文，§3–4 | 自判成功和失败，提取 memory，embedding 检索；WebArena、Mind2Web、SWE-bench Verified；另有 MaTTS 扩大单题交互 | 主体是在线 test-time learning。FDE 版只在 training 构建 memory，testing 仅读取；不能把更多单题采样收益全归于记忆 |
| [A-MEM](https://arxiv.org/abs/2502.12110)，索引 | 链接化记忆组织、检索和更新 | 存储／检索机制候选；必须另测其是否改变业务决策，不能仅凭回忆准确率声称 harness 变好 |
| [Memp](https://arxiv.org/abs/2508.06433)，索引 | TravelPlanner、ALFWorld；构建、检索、更新 procedural memory，研究跨模型迁移 | 与企业流程学习接近，补核离线库与在线修订的各自结果 |
| [ExpeL](https://arxiv.org/abs/2308.10144)、[AutoGuide](https://arxiv.org/abs/2403.08978)，待补全文 | 从既有经验抽取 insight／条件化指导的相关路线 | 保留候选；在没有核实原文前，不填具体切分比例或性能数字 |
| ReMe、Proteus、Reef，系统索引 | 持久化知识或自适应 Agent 系统 | 可复用部件候选，不因具备 memory API 就自动视为通过 FDE 评测的方法 |

第一版特别需要区分记住“某客户的某个金额”与学会“该企业计算金额的规则”。两者都可能有业务价值，但本项目的测试应检查未见案例；如果测试只问训练 trace 中的事实，测到的是信息存取。

[MemGPT](https://arxiv.org/abs/2310.08560) 的摘要描述分层 memory 和 context 管理，可作为固定 harness 的基础能力对照。它不自动等于“从业务 trace 学会修改 harness”。应区分 memory 内容更新与 memory 管理代码优化。

## Tool 与 harness code

| 工作与证据 | 原始评测方式 | FDE 适配判断 |
| --- | --- | --- |
| [AgentOptimizer](https://arxiv.org/abs/2402.11359)，全文，§2–3 | 标题为 *Offline Training of Language Model Agents with Functions as Learnable Weights*；MATH、TabMWP、GAIA；训练执行历史与答案供优化器改函数，训练下降则回滚／早停，未见数据评测 | 直接适合 Teacher–Student 与 train/test；工具代码需隔离运行。是开放工具修改时优先实现的候选 |
| [LearnAct](https://arxiv.org/abs/2402.15809)，摘要 | 标题为 *Empowering Large Language Model Agents through Action Learning*；学习 action 工具 | 保留 action/tool 优化方向；具体数据划分仍需全文确认。注意勿与编号 2310.16844 的无关论文混淆 |
| [SkillWeaver](https://arxiv.org/abs/2504.07079)，题名与来源核对 | 网站交互技能与可调用程序学习 | 可作为 web/tool 后续方向；当前未完成原文协议核对，不与同名机器人工作混用 |
| [AFlow](https://arxiv.org/abs/2410.10762)，全文，附录 A | 代码表示工作流与搜索；HumanEval、MBPP、MATH、GSM8K、HotpotQA、DROP；约 20% 开发／80% 测试，开发题用于搜索与重复执行 | 原文称 validation 的开发部分在本项目中属于 training/search。需独立候选工作流运行器，比 Skill 更新更重 |
| [ADAS](https://arxiv.org/abs/2408.08435)，待补全文 | Meta Agent Search 的相关 harness 搜索路线 | 保留，补读最终候选如何选择、训练任务与转移任务如何划分后再接入 |
| [DGM](https://arxiv.org/abs/2505.22954)，全文，§4–5 | 冻结模型，自改 coding-agent 代码并维护探索档案；SWE-bench、Polyglot，另测跨模型／benchmark 转移 | 核心搜索机制值得保留；统一为外部 Teacher 修改独立候选，先定义企业开发／测试任务，不能照搬所有主表为 held-out 结论 |
| [Meta-Harness](https://arxiv.org/abs/2603.28052)，索引 | 提案 Agent 浏览历史代码、分数与 trace；文本分类、数学检索、TerminalBench-2 | 与 trace-first 设计接近；优先补读候选选择和测试通道 |
| [HarnessFix](https://arxiv.org/abs/2606.06324)，索引 | trace 中间表示，将错误定位到具体 harness artifact，再执行有限修补和回归 | 适合未来代码改动，首版无需引入完整 trace IR；先保留来源指针与错误归因 |
| [Ecdysis](https://arxiv.org/abs/2609.11677)，索引 | Analyst/Critic/Engineer 等分工，按训练表现替换代码，最后冻结 | 与 Teacher 团队吻合；候选代码运行和并发合并是主要工程成本 |
| [RRSI](https://arxiv.org/abs/2609.24972)，摘要 | 有限编辑预算、critic、泄漏检查、精简与成本控制，包含 held-out/OOD 检查 | 适合作为后续通用改代码约束参考；未核查每项实验划分 |
| [Growing Harness](https://arxiv.org/abs/2609.26760)、[MoMHa](https://arxiv.org/abs/2609.30967)，索引 | 外部 proposer 用失败／历史执行信息修改 controller，配合候选检查与选择 | 优先补读，保留开发集、隐藏测试、mock 与真实运行之间的区分 |

这些工作说明“trace → harness 修改”可以覆盖从一句规则到整个 controller 的变化。公共基础应负责 artifact 身份、执行隔离、评测及预算；具体算法负责诊断、提案与选择，避免把 ACE 的条目格式写成所有算法必须遵守的格式。

[Toolformer](https://arxiv.org/abs/2302.04761) 的摘要明确描述训练模型使用工具，属于需要更新模型的相邻工作。本项目可以借鉴工具调用数据的构造，但不能把它列为冻结权重的 Tool Engineering 实现。

## Benchmark 应如何使用

| Benchmark 与证据 | 能测什么 | 对 FDE 的处理 |
| --- | --- | --- |
| [GDPevo](https://github.com/Prism-Shadow/GDPevo)，本地代码＋论文全文 | 同业务环境中的规则学习与组合迁移；当前 repo 为 24 组，每组 5 train + 5 test | 第一版。金融 011、法律 018 分别训练；原始 evaluator 与划分保持不变。论文 v1 的 12 组／120 题不能与当前 release 混写 |
| [SkillsBench](https://arxiv.org/abs/2602.12670)，全文＋官方仓库 | 无 Skill、人工 Skill、自生成 Skill 的任务表现；容器、oracle、确定性 verifier | 用来测 Skill 是否有用；本身不保证“训练后跨题测试”。需要按 task family 另设训练与测试，防止 Skill 直接包含解法 |
| [SkillLearnBench](https://arxiv.org/abs/2604.20087)，索引 | Skill 内容、执行轨迹、最终任务产物的多层评测 | 优先补读；区分同题修订收益和独立新案例收益 |
| [SkillFlow](https://arxiv.org/abs/2604.17308)，索引 | Skill 发现、修复和维护；任务家族包含共享执行流程 | 有潜力用于企业内迁移，需核查家族内训练／测试实际安排 |
| [HarnessOpt-Bench](https://arxiv.org/abs/2608.06301)，索引 | 固定目标 Agent 评测预算，修改 seed harness，隐藏测试评分 | 很接近公共实验协议；补核查隔离实现，再用于代码优化算法 |
| [HarnessDev](https://arxiv.org/abs/2609.01437)，索引 | Creation 与 Evolution 分开，考察可运行 harness 与隐藏任务表现／成本 | 适合较远期完整 harness 生成，不应混合“初始化能力”与“从 trace 学习能力” |
| [SEAGym](https://arxiv.org/abs/2606.17546)、[S3Gym](https://arxiv.org/abs/2608.31100)，索引 | 快照后评测或探索／评测分离 | 适合补充协议和环境；先核实被测 Agent 实际能读哪些反馈 |
| [FinEvo-Bench](https://arxiv.org/abs/2608.06144)，全文 | 120 题、20 场景、6 金融领域，长期 task stream 与 state-reset 对照 | 原生连续适配不同于冻结测试；可在场景内留题，学完后停止更新。开放产物的 Judge 稳定性需另测 |
| [ContinualSkillBench](https://arxiv.org/abs/2608.03874)、[AgentStream](https://arxiv.org/abs/2608.00155)、[PATH-Bench](https://arxiv.org/abs/2608.01149)，索引 | 经验顺序、干扰、遗忘与累积收益 | 保留，但需要预先确定训练前缀与冻结测试段；不能随机打散后仍称复现原协议 |
| [Evo-Memory](https://arxiv.org/abs/2511.20857)、[MemoryAgentBench](https://arxiv.org/abs/2507.05257)、[LifelongAgentBench](https://arxiv.org/abs/2505.11942)，索引 | 记忆、经验复用与持续任务 | 逐项区分事实回忆、程序性迁移和环境熟悉收益，不能合并成单个 RSI 分 |
| [PostTrainBench](https://arxiv.org/abs/2603.08640)，摘要 | Agent 在有限 GPU 时间内做 post-training，最终改变模型权重 | 是自动化研究工作流的类比与预算设计参考，不属于本项目冻结权重的方法 |

“SkillBench”在本次检索中主要对应 *SkillsBench: Benchmarking How Well Agent Skills Work Across Diverse Tasks*。它与 SkillLearnBench、SkillFlow、SkillEvolBench 不是同一工作。SkillsBench v1 原文的任务数和部分汇总数字存在摘要／正文不一致，本报告仅引用其协议，不把不一致数字抄作排名依据。

评测中建议至少有固定 base harness 与适配后 harness 的配对结果。后续再加“直接给训练示例”“Teacher 整段重写 Skill”“ACE 去掉反思／条目更新”等对照。所有方法记录训练访问权限、Student runtime、训练与测试调用数、Teacher/Judge 成本，避免把更强 Teacher 或更多采样当成算法优势。

## 不能直接纳入的结果仍保留

权重更新路线包括 SEAL、R-Zero、TISD、DCE/SRCL 等；它们可借鉴经验收集与反馈机制，但不满足本项目冻结基座的目标。Self-Refine、Reflexion 的同题修正，以及一些“无限优化一个目标”的实验，需要改成训练期修 harness、测试期做新题，才能支持 FDE 结论。

Voyager、Cradle、NavHarness 等开放环境方法值得保留：可借鉴技能库、环境知识和恢复策略。但探索累积、新物品发现、重复尝试成功率，与企业新案例上的冻结测试是不同指标。数据不足时应写“待改造”，不能把不符合原协议的结果直接拼进同一排行榜。

## Trace 分析与环境重建

文献中的可复用部件可按 trace 分析任务组织：结果核验、失败定位、成功／失败对比、跨题聚类、条件化规则提取、冲突消解、修改后回归。这样比按“是否叫 RSI”筛选更能覆盖 FDE 的实际工作。

[Dream-RSI](https://dream-rsi.com/assets/dream-rsi.pdf) 的索引描述涉及把历史 discovery tree 变成 replay 环境，属于 trace-to-environment 的邻近方向，尚未在本次核实全文。它不能代表任意员工轨迹都可恢复出完整企业系统。第一步可以是从 trace 和附件重建有限场景、提供可运行接口与验收条件；未记录的动作分支必须标明模拟范围。

## 接下来按什么顺序补读和实现

ACE-FDE 先验证完整路径。随后根据真实失败选择下一方向：若主要是提示词歧义，比较 ProTeGi；若缺少可复用计算工具，做 AgentOptimizer；若局部修改经常相互冲突，比较 GEPA／SkillOpt 的选择机制；若只有员工 trace 没有 gold，比较 ReasoningBank 与自判误差。

索引中的 SkillRefine、SEEK、TRACE、TTSE、Meta-Harness、HarnessFix、Growing Harness、MoMHa 与当前场景尤其接近，应优先补核全文。每次补读都补充数据划分、反馈权限、可修改对象、候选选择与隐藏测试证据，不只记录论文的最终平均分。
