# 评估中心可以创建与优化 Benchmark

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `skills`, `docs`
- **PR:** [#596](https://github.com/Prism-Shadow/penguin-harness/pull/596)

[English](2026-09-02-evaluation-center.md)

Benchmark 从属于 Agent 变成与 Agent 平级：它移到 Project 层级，一个 Benchmark 可以评测多个 Agent，被测 Agent 记录在每条 evaluation 上。评估中心围绕这一点、也围绕新手需要的闭环重做——出一套 Benchmark、看它的分数、交给优化者——每一步都只需一次点击，提示词替人写好。

## 细节

- Benchmark 从 `agents/<agent>/benchmarks/<id>/` 移到 Project 的 `benchmarks/<id>/`，与 `agents/` 平级。`benchmark_config.toml`（title、description、runs）不记录任何 Agent；`scoreboard.yaml` 的每条 evaluation 以 `agent_id` 记录本轮被测的 Agent，位置紧接 `time`。磁盘文件仍是唯一真相来源。
- `agent_id`、`model_id` 与 `thinking_level` 合成一条 evaluation 的**标签**：三者，写出来就是图例用以辨认系列的那行文字（`<agent_id> · <model_id> · <thinking_level>`）。Benchmark 曲线以时间为横轴、分数为纵轴，按标签分系列，只有可比的分数才落在同一条线上；没有标签的记录归入灰色系列。Agent State `version` 与 `provider` 都不进标签：同一被测 Agent 在同一 Runtime 下的历次版本正是这套闭环要显示的走势，本该连成一条线（示例 Benchmark 的三条评估现在就是一条连续的线）；而系列必须能从图例那行文字认出来，那行文字写的是模型 id，不是它由哪个 provider 提供。版本号标在每个点的悬停提示里，评估明细表自带一列版本号，卡片上的分数增减仍以同标签的上一条评估为基准。
- 评估明细表的行不再在表内展开。点击一行打开**评估详情弹窗**，与旁边的题目详情弹窗同一形制：顶部是系列标签、被测 Agent 头像与本次的版本号，其下为记录中的 Score、成本与耗时，再下是这次评估的说明（标题与正文分开展示）与单题得分表，题目行仍可展开逐次 run 的原始结果及其 Session id。在其中点开某道题，题目详情弹窗叠在它之上。
- 两个详情弹窗的页脚都有**问 AI**：它把「用 AI 创建」弹窗改成提问而非下单——提示词框已经填好（这次评估为什么是这个结果 / 这道题考什么），三个示例可以替换它，固定尾部把屏幕上的事实一并交出去。评估这一侧是 Benchmark id 与目录、评估时间、系列标签、版本、provider / 模型 / 思考等级、总分与逐题得分、逐次 run 的 Session id 与评估说明，并要求读取 `scoreboard.yaml` 与上列 Trace 后解释分数从何而来、指出薄弱题目、给出下一步建议。题目这一侧是 Benchmark id 与题目 id、`statement/README.md` 与 `rubric/README.md` 的路径，以及最近一次评估在这道题上的逐次结果，并要求解释这道题考什么、怎样才算答好、评分细则如何区分优劣。两者都不要求任何改动——题目已冻结，被测 Agent 也不是提问的对象——出口同为套件唯一的那个：预填进与 Project 默认 Agent 的新对话。
- 页面：单层平铺列表，不再按 Agent 分组。标题旁并排搜索框（按标题、描述与评测过的 Agent 过滤）与两个创建按钮，其下是常驻的引言块与三张步骤卡片；每个 Benchmark 一张卡片，显示标题与目录名、题数与运行次数、最近评估时间、评测过的 Agent、最新分数与增减、分数走势小折线——列宽、页头与卡片都取智能体页面的形制。
- 打开 Benchmark 是**进入**它。点击卡片或其**查看**按钮进入该 Benchmark 自己的页面 `/benchmark/:benchmarkId`——原有的详情（图表、评估明细表、题目浏览器）与一个返回列表的按钮——不再在列表旁展开第二个窗格。地址里的 id 指不到东西时（Benchmark 已删除、链接过期）页面说明情况并留着返回的路。空态带指南与同样的两个按钮；`?agentId=` 把列表收窄为评测过该 Agent 的 Benchmark。
- **用 AI 创建**与**手动创建**是套件提供的两个并排按钮，与定时任务页是同一对，各自打开一条路径。「用 AI 创建」在提示词上方加了被测 Agent 选择、四个场景示例，以及一段固定尾部——把 Agent id、期望基线分、Pilot 迭代上限与要写出的目录结构交给 `benchmark-design` 技能；写好的提示词预填进新对话，发送由用户决定。「手动创建」是一张表单——标题、随标题拟定的 id、描述、每题运行次数，以及每道题的目录名后缀、标题、题干与评分细则，格式提示常驻、「什么样的评分细则有区分度」折叠在旁——不再询问 Benchmark 属于哪个 Agent。
- 标题下是一个不折叠、也不可关闭的引言块，只有两行：走的顺序，以及三个技能都在 agent-tuning 插件里、默认 Agent 已自带。其下是三张独立的步骤卡片——宽屏三列并排，窄屏纵向堆叠——每张写出序号、标题、所依赖的技能（`benchmark-design`、`agent-evaluation`、`agent-optimization`）与一句话说明；卡片之间不画任何东西，顺序由序号交代。
- 卡片与 Benchmark 页头的**使用**打开同一个弹窗：顶部分段控件，「评估」tab 与「优化」tab 并列。「评估」是表单（被测 Agent，缺省为最近一条评估的那个；执行评估的 Agent，未装 `agent-evaluation` 技能时提示；评估会话使用的模型；每题运行次数；可选说明），其新增的提示词尾部要求经自调用的 `agent-evaluation` 子会话跑完整的 Case × runs 矩阵，校验每条结果的 `agent_id` / `provider` / `model_id` / `thinking_level` 一致，按记分契约求各题与整体平均，并只向 `scoreboard.yaml` 追加一条带标签的 evaluation，不修改被测 Agent 与 Benchmark。「优化」保留原有的表单与尾部，所选被测 Agent 尚无基线时改为提示先到「评估」取得。两个 tab 都可折叠展开完整提示词，并共用一个出口——预填进新对话，交由用户过目后发送。
- 两个 tab 都只有表单，没有并列的「用 AI」自由文本形态：唯一的出口本就把拼好的提示词开在可编辑的输入框里，再加一条参数相同的自由提示词路径只会把入口劈成两半。
- 卡片上的动作是**使用**、**查看**，以及 owner 才有的、与智能体列表相同的删除图标——确认后整目录删除。卡片没有溢出菜单：本该放在其中的目录路径改列在 Benchmark 自己页面的标题旁，以等宽字体显示并附一个复制按钮。
- 服务端：Benchmark 接口移到 `/api/projects/:projectId/benchmarks`，去掉了 `agentId` 段，成员与 owner 校验都在 Project 层级进行。`POST`（仅 owner）写入 `benchmark_config.toml`、内容为 `evaluations: []` 的 `scoreboard.yaml`，以及每道题的 `statement/README.md`（标题为其一级标题）与 `rubric/README.md`，id 已被占用时返回 409 `benchmark_exists`；`DELETE …/benchmarks/:id` 整目录删除。列表中的每个 Benchmark 带 `agentIds`，即其 evaluations 按首次出现顺序去重后的被测 Agent；每条 evaluation 带 `agentId`（记录中没有时为 `null`）。
- 列表只返回带 `benchmark_config.toml` 的目录。在评测运行期间删除 Benchmark 会留下一个目录——该次运行仍在向被删除的路径写入——这类残留不再以占位标题出现在列表中。从未评测过的 Benchmark 带有配置文件，照常列出。
- `benchmark-design`、`agent-evaluation` 与 `agent-optimization` 三个技能改读写 Project 层级的路径，写明一个 Benchmark 可以评测多个 Agent、`test_agent_id` 指的是本次请求评测的那一个，在评测协议中返回 `agent_id`，并把它写进每条追加的记分条目。`agent-tuning` 插件版本更新为 `2026.09.12.1`。
- 示例 Benchmark 的预置条件改为「Project 没有 `benchmarks/` 目录」——`default_agent` 初始化时预置，此后每次装载也会补，因此早于该示例的存量数据根在首次装载时同样得到它。判定在目录一级而非示例本身：`benchmarks/` 还在时删掉示例是一个会被尊重的决定。三条示例评估都标注 `agent_id: default_agent`。
- Benchmark 创建即冻结题目：Web App 与服务端接口都不能改题干或评分细则——改题会让记分板上已有的分数不再可比。要换题只能新建一个 Benchmark；AI 出题过程中的校准发生在基线确立之前，属于创建的一部分。
- 「用 AI 创建」桥接接受 `modelRef`，优化弹窗用它固定优化会话的模型。
- 早先版本留在 Agent 目录下的 `benchmarks/` 不被本版本读取，也不迁移、不删除。
- Web App、服务端 API 与自我进化文档以两种语言描述了新页面、接口与存储结构。
