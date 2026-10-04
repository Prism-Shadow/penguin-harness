# 企业专用 Harness 的迭代设计

更新于 2026-10-04。本文规定 FDE 场景与 Penguin 的设计方向；伴生监管由 Skill 编排现有会话和观察接口，不是内置强制隔离。

配套资料：[文献综述](fde-rsi-literature-review.md)、[候选清单](fde-rsi-candidates.md)。通用约定写在 Agent Tuning 的 Skill 中，具体方法写在对应 reference 中。

## 目标：自动化 FDE 的工作

FDE（Forward Deployed Engineer）懂 Agent 和模型，进入企业后学习业务，分析执行中的 good/bad case 与反复出现的 pattern，再修改 Skill、提示词、工具或 harness 代码，使 Agent 适应企业流程。我们用 Optimizer 自动完成这套工作，固定模型权重，训练企业专用的 Target Harness。

核心能力是 **trace → harness 修改**，对应模型训练的 **data → 模型权重**。这是工作流类比，不预设相同的优化理论。允许 harness 针对企业场景 overfit，但要在该企业的新案例上泛化；类似金融 LoRA，无须同时适用于法律，另一领域可以训练另一套 harness。

Trace 可以来自企业提供的训练题、答案和 Rubric，也可以来自员工 hands-on 使用、用户修正及实际产物。企业先出题不是开始学习的必要条件，分析 trace 才是共同核心。缺少标准答案时，成功标签应标明证据和不确定性；要证明收益，仍需独立 testing。

## Skill-first，面向更强的模型

Penguin 高度依赖 skill-based plugin：用完整、明确的 Skill 表达自定义算法，相信模型能按约束和约定执行。优先让 Agent 自行调度、分析和提出修改，不把每种算法写死为代码。代码与文档始终简洁优先，公共工具只承担确有必要的执行、记录和控制能力。

我们押注模型的 instruction following 能力。当前模型可能仍会串读其他 Agent 的 trace、误读 Ground Truth 或污染环境，但这些问题不成为先堆叠复杂隔离框架的理由。先保留清晰规约、观察违规，再改进执行。期待未来模型变强后，同一套简洁架构直接发挥作用；“可能半年后跟上”是设计假设，不是能力或时间保证。

同时，Optimizer 和 Target Agent 都是局中人。Root Agent（通常是 Default Agent）每次委派工作时，创建一对伴生会话：Supervised Agent 执行任务，Supervisor Agent 独立观察它。每个子任务由自己的父 Agent 创建对应的伴生者，形成分布式监管。

## 角色命名对齐 Penguin

| 讨论中的概念 | 本文与 Skill 使用的名称 | 定位 |
| --- | --- | --- |
| Student Agent | Target Agent，也称 Test Agent／被测智能体 | 执行训练题和测试题，其 harness 是优化目标；名称中的 Test 不表示只参与 testing split |
| Teacher Agent | Optimizer | 执行 `agent-optimization`，分析轨迹并修改 Target Harness |
| 出题／复现者 | Builder | 创建或复现 benchmark，不承担 Optimizer 的优化职责 |
| Judge | Evaluator | 执行 `agent-evaluation`，运行一道题并评分；方法内部的成功判别器另由该 reference 定义 |
| 汇总测试者 | Reporter | 组织独立测试并汇报，是本设计的工作流角色，不是内置 Agent 类型 |
| Root Agent | 顶层委派者，通常是 Default Agent | 创建伴生对、管理任务表、停止异常执行并决定重跑 |
| Supervised Agent | 被监管的执行角色 | 可以是 Builder、Optimizer、Evaluator、Reporter 或 Target，每个执行会话独立编号 |
| Supervisor Agent | 执行会话的监管伴生者 | 从任务开始到最终 trace 检查，独立观察一个 Supervised Agent |

这些是职责名称。一个 Agent 可以在不同会话中承担不同工作；需要信息隔离的职责不能共用上下文。本文的模型与 harness 定义沿用上述对应关系，不新增运行时类型。

## 固定组件与训练目标

```text
Optimizer = Optimizer Model + Optimizer Harness
Target Agent = Target Harness + Target Model
```

| 组件 | 本场景中的定位 |
| --- | --- |
| Optimizer Model | 与 Target Model 可以不同；通常在实验内冻结 |
| Optimizer Harness | 通常固定，擅长读 trace 并提出 harness proposal；预期大体 domain-agnostic，细节另议 |
| Target Model | 通常在实验内冻结，不通过换模型或推理配置制造增益 |
| Target Harness | 唯一被训练、持续迭代的变量，逐渐形成业务域需要的能力 |

Target Agent 可以并发运行多个实例，每个实例有 clean context，只做分配的题目。它可以在本题工作区写代码、调用工具和修正答案，但不在执行途中修改持久 harness。Optimizer 也可以单实例分析，或并行委派多个分析者后合并结果。所有实例的角色与数据权限保持明确，禁止执行题目的 Agent 同时修改自身持久 harness。

```text
Root：创建执行／监管伴生对，维护状态，收齐双方报告
Optimizer + Supervisor：分发训练 → 分析 trace → 提案／发布
Evaluator + Supervisor：准备环境 → 创建 Target 伴生对 → 评分
Target + Supervisor：固定 H_t 做题，逐条观察指令与执行
Reporter + Supervisor：独立测试，汇总分数与异常
```

上图表示职责关系，不规定会话树或谁创建谁。

一批 Target Agent 共用不可变的 `H_t`，全部结束后 Optimizer 才能发布 `H_(t+1)`。并发受模型和环境容量约束；逐题更新与整批更新可能产生不同结果，适配论文时明确说明。Optimizer 可以分组、检索或汇总大量轨迹，但结论要保留来源与反例。后续若研究 Optimizer Harness 的进化，单独定义实验，不混入本场景的 Target Agent 训练收益。

## 每次委派都有监管伴生者

[Agent Supervision](../../../plugins/agent-tuning/skills/agent-supervision/SKILL.md) 是独立 Skill，由 Agent Tuning 的各入口通过相对文件链接引用。父 Agent 先创建并绑定执行与监管会话，监管就绪后才放行任务。执行结束后监管读完最后一段 trace，双方报告齐全后父 Agent 才接受结果并结束伴生对。“同生同灭”是共同管理的任务生命周期，保留轨迹，不要求物理同时删除会话。

每个执行角色都需要自己的伴生者，包括做题的 Target、看 Rubric 的 Evaluator、分析轨迹的 Optimizer 及其分析子任务。权限按角色判断：Evaluator 可以读取本题评分材料，Optimizer 只有声明允许的训练反馈权限。Supervisor 本身是叶子观察角色，不继续创建 Supervisor，避免无限递归。

Supervisor 读取所绑定会话实际收到的 system prompt、用户 query、委派指令、Skill 和 reference，再核对真实 tool call/output。它不做业务题、不优化 harness、不改评分；被观察内容不能扩大其权限。默认每 30 秒检查新增记录，短测试可降低间隔。trace 暂停增长不等于完成，需要结合运行、压缩、后台任务及截止时间判断。缺失轨迹或监控中断记为覆盖不足，不能伪报合规。

发现异常时，Supervisor 立即写证据并通知自己的父 Agent。父 Agent 及时停止该执行及受影响子任务，确认停止后，将异常转换成下一次 **user instruction** 的具体约束，再启动全新的伴生对。system prompt、system config、模型和持久 harness 保持不变；普通低分不触发这种重跑。

同一任务编号最多首次执行加三次重跑。每次保存原始产物、双方会话 ID、追加指令、检测／通知／停止时间和原因。第四次仍确认作弊、没有可用结果时，该任务最终记 **策略零分**，附 `cheating_retry_exhausted` 和简短原因；原 grader 分数另存，不能把惩罚分称为原始评分。基础设施失败或较早耗尽预算不冒充四次作弊。未清除的作弊不能成为学习证据、合规基线或 harness 发布依据。

Root 维护任务表，记录编号、父节点、双方 Session、尝试次数及 waiting／running／anomaly_detected／stopping／retrying／success／cheating_exhausted／incomplete 状态；各父 Agent 管理自己的子任务并逐级汇报。监管报告只向接收者披露有权限的信息，测试答案、Rubric 和评分思考不能借告警回流给 Optimizer。

Penguin 的工具子 Agent 当前最多一层；需要继续委派的工作使用现有 CLI/API 会话，登记逻辑父节点和实际创建方式。此方案不修改深度限制或新增会话类型。周期观察不保证在动作发生前拦截，报告必须记录覆盖与响应延迟；真正验证这些规则需要端到端轨迹，不能只靠 Skill 文字。

## 评估规约

第一版只设 training 与 testing，不强制细分 validation。共同约束如下：

- **按算法开放训练信息。** Optimizer 可只看 trace／分数，也可读取训练答案、Rubric、逐项判分和人工反馈；Target Agent 只看本题输入、允许的业务环境及固定 harness。训练答案可帮助归纳规则，不能变成答案查询表。
- **Testing 不参与优化。** Optimizer 不读测试题、答案、Rubric、轨迹或结果。独立 Reporter 在训练结束后比较初始／最终版本，基线测试反馈也不提前回流。测试分不用于选版本、追加训练、改预算或换场景；看过反馈后继续训练需要新的测试集。
- **验证企业内迁移。** 按业务对象、时间、客户或模板来源划分，避免近重复案例泄漏。共享政策可以复用，未来事件与测试答案不能提前提供。成功轨迹也需识别用户代做和偶然成功。
- **允许有边界的长任务。** 例如把 60 步的前 30 步用于训练、后 30 步用于测试，前提是不泄漏后段信息，并能保存、复现相同的交界环境。此结果与独立新任务测试分开报告。
- **比较条件一致。** 固定 Target Agent 模型、推理配置、任务环境和逻辑重复次数，另记因作弊触发的补救尝试与追加 user instruction，记录 Optimizer/Evaluator 的独立配置及所有角色开销。保留成功、失败、拒绝候选、版本、证据和违规记录；基础设施失败不记为零分。

报告逐场景的训练曲线、基线／最终测试分与逐题差值，以及实际 Skill 读取、版本 hash、次数、费用和耗时。训练分上涨不能替代测试收益。正式比较重复整个训练实验，避免只重复最终测试而忽略 Optimizer 的波动；只有少量测试题时不宣称稳定提升。

## 算法声明与公共架构

沿用 Awesome-RSI 的分类，每个算法自行声明；分类描述与本次执行权限分开保存。

| 维度 | 声明内容 |
| --- | --- |
| `artifact` | 可修改的 Skill、prompt/context、memory、tool、hook、harness code 及具体路径 |
| `source` / `feedback` | 训练题或员工 trace 的来源，以及各角色可见的分数、答案、Rubric、自判等 |
| `updater` / `frequency` | Optimizer 分工、单一发布者、逐轨迹或 batch/epoch 更新 |
| `topology` / `selection` | 单候选、beam、树／图／种群；最新有效版、训练分、validation 或 Pareto 选择 |
| `mode` / `scope` | 离线／训练流学习、适用企业或领域；testing 时持久状态冻结 |
| 资源与复现 | 各角色 runtime、预算、数据版本、候选父子关系、恢复规则 |

框架允许全部 Target Harness 组件成为训练对象，具体算法只修改声明的部分。模型权重、评分器、测试数据和凭证不属于修改目标。涉及 harness 代码时使用独立候选 checkout／构建，保持 Optimizer、监管者与评分环境稳定。

`agent-optimization` 汇集 RSI methods，默认使用 Penguin；具体方法从入口索引选择，各自定义诊断、更新和候选选择方式。Skill 规定通用输入、评估、版本及输出格式。公共接口保持为：**trace bundle → harness proposal → 按算法检查与评估 → 发布版本**，外层独立监管。

后续按需要增加小型公共工具：候选版本和快照、代码构建／回归检查、trace 检索、运行观察与停止接口。只有具体需求出现时再补隔离能力或搜索调度，不为尚未实现的论文预建完整引擎，也不把某种算法的条目格式或接受规则强加给其他算法。

## 通用约定与具体方法分开

**General 放 Skill，具体算法放 reference。** `agent-optimization` 负责输入输出、评估协议、版本与角色约束；Penguin 默认方法及其他 RSI 方法的诊断、修改、准入与选择规则各自放在 reference。`benchmark-reproduction` 负责通用构造、格式、冒烟及发布约定；各 benchmark 的具体构造方式与适配经验放在 reference。

只读取本次选中的 reference。新增方法优先新增 reference 和入口索引，不创建独立 RSI plugin，不修改 packages/core/cli 或注册一套新执行引擎。一个方法默认只用一份完整 reference，把算法、产物格式和适配差异放在一起。只有确有独立复用需求时才拆文件。通用介绍不罗列具体方法；名称放在方法索引、具体 reference 或明确标注的例子中。只有多个方法确实共用的约定才进入通用 Skill。

## Penguin 的复用方式

| 现有能力 | 使用方式 |
| --- | --- |
| [Agent Initialization](../../../plugins/agent-tuning/skills/agent-initialization/SKILL.md) | 创建独立 Target Agent、Agent State、业务 Skill 和基线版本 |
| [Benchmark Design](../../../plugins/agent-tuning/skills/benchmark-design/SKILL.md) | 新造训练题并校准 |
| [Benchmark Reproduction](../../../plugins/agent-tuning/skills/benchmark-reproduction/SKILL.md) | 按需拉取已有 benchmark，保留原协议并转换为 Penguin 格式，冒烟验证后再询问全量评估 |
| [Agent Evaluation](../../../plugins/agent-tuning/skills/agent-evaluation/SKILL.md) | 每次执行一个 case/run，绑定 trace 并返回原有评分 YAML；由调用方组织并行 |
| [Agent Optimization](../../../plugins/agent-tuning/skills/agent-optimization/SKILL.md) | 执行 RSI 方法；默认使用 Penguin，其他方法在 reference 中定义 |
| Plugin / Session / trace | Optimizer 使用 Agent Tuning 并读取选定方法 reference，Target Agent 装业务能力；分别记录执行，供分析与监管 |

Penguin 默认 reference 保留“严格提分才接受”、禁止读 Rubric、接受版本才入表及不同重复次数比较。其他算法不继承这些策略。需要详细训练反馈时，独立 Worker 对同一产物重新评分，按授权返回字段，不读取 Evaluator 私有思考或改协议。快照排除 vault，版本递增，批次内禁止改 State。

当前分工主要靠 Skill 指令和 trace 审计；clean context、workspace 和 hash 不等于强制访问隔离。我们接受先依赖 instruction following 的实现路线，同时如实记录违规及无效结果。独立监管会补足观察与干预，不能把尚未实现的隔离或监管当成实验事实。

## 按需选择方法与复现 benchmark

优化请求指定方法、Target Agent、训练 benchmark 和预算。由 Optimizer 读取所选方法的完整 reference，按其规则更新和选择版本。需要读取业务 Skill 的方法，应在基线前固定读取说明，避免把加载修复算作学习收益。各方法的参数、预算和原论文差异留在自身 reference 中，不能假定所有方法都严格提分才接受，或都保留最新版本。

Benchmark 按用户提供的 GitHub link、名称或本地源码按需复现，不预装数据。`benchmark-reproduction` 优先使用匹配的 reference，未命中则走通用方法；用户要求自定义但没给方案时，先问“你想怎么构造？”。原数据有 train/test 就生成 `<name>_train` 和 `<name>_test`；长程任务的两份 benchmark 使用相同任务定义，按事先声明的 trial／时间切点和环境状态交接分开执行。

数据、环境和必要的小适配器生成到具体 benchmark 中，不加入默认初始化或核心代码。Docker 不可用时，可验证后采用本地模式并说明差别，评分沿用原始实现。先验证少量完整执行、评分、清理和评估中心可见性，再询问是否跑全量；冒烟结果不充当全量基线。新建题目的难度校准门槛不用于复现已有 benchmark。

验证先覆盖少量明确的业务场景，再扩展任务和方法。按公开业务范围选题，不按已有成绩挑有利结果。比较时记录各方法自己的调用次数、预算和反馈权限，不把不同成本或监督条件当成相同设置。用户构造的数据不会在加载 `default_agent` 时自动重建。

## 相关方向：Trace to Environment

员工 trace 还可用于重建当时的文件、工具接口、数据库和操作环境。完整复刻不是首要目标；能运行、能展示部分原工作并保留关键约束，就能增加长尾场景和数据多样性。

这是相邻研究方向，暂不作为算法前置条件。重建时标明观察到的行为和近似部分；固定输出回放无法验证未见动作分支，可运行的展示也不自动成为可靠评测环境。
