# 评估中心可以创建与优化 Benchmark

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `web`, `server`, `docs`
- **PR:** [#596](https://github.com/Prism-Shadow/penguin-harness/pull/596)

[English](2026-09-02-evaluation-center.md)

评估中心围绕新手需要的闭环重做：为某个 Agent 出一套 Benchmark、看它的分数、交给优化者——每一步都只需一次点击，提示词替人写好。Benchmark 按被测 Agent 分组列出，每行带最新分数与增减、评分板的分数走势小折线，以及真正要用的动作。

## 细节

- 页面：标题与一行副标题，其下折叠的三步指南点名每一步背后的 Skill；按标题、描述与 Agent 过滤的搜索框；可折叠的按 Agent 分组（组头为头像与数量）；每行显示题数与运行次数、最近评估时间、最新分数与增减、分数走势小折线。**查看**在宽屏的右侧窗格、窄屏的列表位置打开原有的详情（图表、评估明细表、题目浏览器）。空态带指南与「用 AI 创建」「手动创建」两个按钮。`?benchmark=<agent>/<id>` 直接打开某个 Benchmark，选中也会回写该参数；`?agentId=` 仍只展开该 Agent。
- **用 AI 创建**与**手动创建**是套件提供的两个并排按钮，各自打开一条路径。「用 AI 创建」在提示词上方加了被测 Agent 选择、四个场景示例，以及一段固定尾部——把 Agent id、期望基线分、Pilot 迭代上限与要写出的目录结构交给 `benchmark-design` 技能；写好的提示词预填进新对话，发送由用户决定。「手动创建」是一张表单——标题、随标题拟定的 id、描述、每题运行次数，以及每道题的目录名后缀、标题、题干与评分细则，格式提示常驻、「什么样的评分细则有区分度」折叠在旁——提交到新的创建接口。
- 详情头部的**用 AI 优化**与**手动优化**是同样的一对按钮，共用一份面向 `agent-optimization` 技能的参数尾部：「手动优化」是表单（执行优化的 Agent，未装该技能时提示；优化会话自身的模型；每题运行次数；最多轮数；缺省比基线高 10 分的目标分数；可选的优化重点），「用 AI 优化」是带示例的自由提示词。一行里放不下一对按钮，所以行内的**优化**只开表单。两条路径都只有一个出口：把完整提示词预填进新对话，交由用户过目后发送。没有基线的 Benchmark 会先说明这一点。
- 行的溢出菜单可复制 Benchmark 的目录路径；owner 确认后可删除。
- 服务端：`POST /api/projects/:p/agents/:a/benchmarks`（仅 owner）写入 `benchmark_config.toml`、内容为 `evaluations: []` 的 `scoreboard.yaml`，以及每道题的 `statement/README.md`（标题为其一级标题）与 `rubric/README.md`，id 已被占用时返回 409 `benchmark_exists`；`DELETE …/benchmarks/:id` 整目录删除。
- 列表只返回带 `benchmark_config.toml` 的目录。在评测运行期间删除 Benchmark 会留下一个目录——该次运行仍在向被删除的路径写入——这类残留不再以占位标题出现在列表中。从未评测过的 Benchmark 带有配置文件，照常列出。
- 「用 AI 创建」桥接接受 `modelRef`，优化弹窗用它固定优化会话的模型。
- Web App、服务端 API 与自我进化文档以两种语言描述了新页面与接口。
