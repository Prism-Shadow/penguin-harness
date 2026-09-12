# 评估中心可以创建与优化 Benchmark

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `skills`, `docs`
- **PR:** [#596](https://github.com/Prism-Shadow/penguin-harness/pull/596)

[English](2026-09-02-evaluation-center.md)

Benchmark 从属于 Agent 变成与 Agent 平级：它移到 Project 层级，一个 Benchmark 可以评测多个 Agent，被测 Agent 记录在每条 evaluation 上。评估中心围绕这一点、也围绕新手需要的闭环重做——出一套 Benchmark、看它的分数、交给优化者——每一步都只需一次点击，提示词替人写好。

## 细节

- Benchmark 从 `agents/<agent>/benchmarks/<id>/` 移到 Project 的 `benchmarks/<id>/`，与 `agents/` 平级。`benchmark_config.toml`（title、description、runs）不记录任何 Agent；`scoreboard.yaml` 的每条 evaluation 以 `agent_id` 记录本轮被测的 Agent，位置紧接 `time`。磁盘文件仍是唯一真相来源。
- `agent_id`、Agent State `version`、`(provider, model_id)` 成对值与 `thinking_level` 合成一条 evaluation 的**标签**。Benchmark 曲线以时间为横轴、分数为纵轴，按标签分系列，只有可比的分数才落在同一条线上；没有标签的记录归入灰色系列。评估明细表另有一列写明被测 Agent，卡片上的分数增减也以同标签的上一条评估为基准。
- 页面：单层平铺列表，不再按 Agent 分组。标题旁并排搜索框（按标题、描述与评测过的 Agent 过滤）与两个创建按钮，其下折叠的三步指南点名每一步背后的 Skill；每个 Benchmark 一张卡片，显示标题与目录名、题数与运行次数、最近评估时间、评测过的 Agent、最新分数与增减、分数走势小折线——列宽、页头与卡片都取智能体页面的形制。
- 打开 Benchmark 是**进入**它。点击卡片或其**查看**按钮进入该 Benchmark 自己的页面 `/benchmark/:benchmarkId`——原有的详情（图表、评估明细表、题目浏览器）与一个返回列表的按钮——不再在列表旁展开第二个窗格。地址里的 id 指不到东西时（Benchmark 已删除、链接过期）页面说明情况并留着返回的路。空态带指南与同样的两个按钮；`?agentId=` 把列表收窄为评测过该 Agent 的 Benchmark。
- **用 AI 创建**与**手动创建**是套件提供的两个并排按钮，与定时任务页是同一对，各自打开一条路径。「用 AI 创建」在提示词上方加了被测 Agent 选择、四个场景示例，以及一段固定尾部——把 Agent id、期望基线分、Pilot 迭代上限与要写出的目录结构交给 `benchmark-design` 技能；写好的提示词预填进新对话，发送由用户决定。「手动创建」是一张表单——标题、随标题拟定的 id、描述、每题运行次数，以及每道题的目录名后缀、标题、题干与评分细则，格式提示常驻、「什么样的评分细则有区分度」折叠在旁——不再询问 Benchmark 属于哪个 Agent。
- Benchmark 页面头部的**用 AI 优化**与**手动优化**是同样的一对按钮，共用一份面向 `agent-optimization` 技能的参数尾部：「手动优化」是表单（执行优化的 Agent，未装该技能时提示；被测 Agent，缺省为最近一条评估的那个；优化会话自身的模型；每题运行次数；最多轮数；缺省比该 Agent 基线高 10 分的目标分数；可选的优化重点），「用 AI 优化」是带示例的自由提示词。一张卡片里放不下一对按钮，所以卡片上的**优化**只开表单。两条路径都只有一个出口：把完整提示词预填进新对话，交由用户过目后发送。所选被测 Agent 在该 Benchmark 尚无基线时会先说明这一点。
- 卡片的溢出菜单可复制 Benchmark 的目录路径；owner 确认后可删除。
- 服务端：Benchmark 接口移到 `/api/projects/:projectId/benchmarks`，去掉了 `agentId` 段，成员与 owner 校验都在 Project 层级进行。`POST`（仅 owner）写入 `benchmark_config.toml`、内容为 `evaluations: []` 的 `scoreboard.yaml`，以及每道题的 `statement/README.md`（标题为其一级标题）与 `rubric/README.md`，id 已被占用时返回 409 `benchmark_exists`；`DELETE …/benchmarks/:id` 整目录删除。列表中的每个 Benchmark 带 `agentIds`，即其 evaluations 按首次出现顺序去重后的被测 Agent；每条 evaluation 带 `agentId`（记录中没有时为 `null`）。
- 列表只返回带 `benchmark_config.toml` 的目录。在评测运行期间删除 Benchmark 会留下一个目录——该次运行仍在向被删除的路径写入——这类残留不再以占位标题出现在列表中。从未评测过的 Benchmark 带有配置文件，照常列出。
- `benchmark-design`、`agent-evaluation` 与 `agent-optimization` 三个技能改读写 Project 层级的路径，写明一个 Benchmark 可以评测多个 Agent、`test_agent_id` 指的是本次请求评测的那一个，在评测协议中返回 `agent_id`，并把它写进每条追加的记分条目。`agent-tuning` 插件版本更新为 `2026.09.12.1`。
- 初始化 Project 的 `default_agent` 时在 Project 层级预置示例 Benchmark，三条示例评估都标注 `agent_id: default_agent`。
- 「用 AI 创建」桥接接受 `modelRef`，优化弹窗用它固定优化会话的模型。
- 早先版本留在 Agent 目录下的 `benchmarks/` 不被本版本读取，也不迁移、不删除。
- Web App、服务端 API 与自我进化文档以两种语言描述了新页面、接口与存储结构。
