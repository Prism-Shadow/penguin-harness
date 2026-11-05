# RSI 工具包：`agent-tuning` 拆为 `default-rsi-toolkit` 与 Agent Evaluation，OPRO、APE、ACE 与 AWM 加入

- **Date:** 2026-10-10
- **Type:** feature
- **Scope:** `plugins`, `core`, `server`, `web`, `docs`
- **PR:** [#1030](https://github.com/Prism-Shadow/penguin-harness/pull/1030)
- **Breaking:** yes — `agent-tuning` 插件拆分到 `default-rsi-toolkit`、新的 `agent-evaluation` 与 `agent-development`，指名 `agent-tuning` 的安装请求会被拒绝

[English](2026-10-10-rsi-toolkits.md)

插件库新增排在首位的分类 `rsi`（Agent 自进化），收纳 RSI 工具包：每种自进化算法一个插件。`agent-tuning` 一拆为三，四个 Skill 名称不变：循环本身 `agent-optimization` 成为 `default-rsi-toolkit`，即 Default RSI Toolkit；`benchmark-design` 与 `agent-evaluation` 自成一个插件 `agent-evaluation`（Agent Evaluation），归入 AI 应用开发；`agent-initialization` 并入 `agent-development`，后者还新增了 `penguin-plugin`，即从 `penguin-sdk` 拆出的 Workflow 部分。四个算法工具包 `opro-rsi-toolkit`、`ape-rsi-toolkit`、`ace-rsi-toolkit` 与 `awm-rsi-toolkit` 随之加入，各用一个 Skill 运行一篇论文的算法。工具包名以 `-rsi-toolkit` 结尾，算法工具包唯一的 Skill 与插件同名。评估中心的「优化」标签页新增覆盖这五个工具包的**方法**字段。OPRO、APE、ACE 与 AWM 的配方来自 Junhao Hu 的 [#985](https://github.com/Prism-Shadow/penguin-harness/pull/985)，改写为互相独立的工具包。

## 细节

- **分类。** `PLUGIN_CATEGORIES` 新增排在首位的 `rsi`，标题为 Agent Self-Evolution / Agent 自进化。`ai-app-development` 在 `agent-development`、`model-development` 与 `skill-porting` 之外新增 `agent-evaluation`。
- **`default-rsi-toolkit`。** `plugins/agent-tuning` 改为 `plugins/default-rsi-toolkit`（`@penguinharness/default-rsi-toolkit`，分类 `rsi`），只含一个 Skill `agent-optimization`，正文与版本不变。图标改为绕圆互相追逐的两段弧，快速开始改为列出本 Project 的 Benchmark 并提议一次优化，用户同意前什么都不启动。
- **`agent-evaluation`。** 新插件 `plugins/agent-evaluation`（`@penguinharness/agent-evaluation`，Agent Evaluation，分类 `ai-app-development`，预装）接收 `benchmark-design` 与 `agent-evaluation`，名称不变，沿用 `agent-tuning` 原来的仪表盘图标。`agent-evaluation` 正文与版本不变，`benchmark-design` 升至 `2026.10.11.1`（见 **Benchmark 导入**）。它的快速开始列出 penguin-harness-benchmark 里的包，用户选定之前不导入。Default RSI Toolkit 经由它测量；评估中心「评估者缺少 Skill」的提示改为指向它。
- **`agent-development`。** 接收 `agent-initialization`（`2026.10.12.1`），后者不再重复「程序以哪种方式接入智能体」的选择与 Agent API 的负责人操作步骤，改为交给 `penguin-sdk` Skill。Workflow（Agent 在对话旁自己维护的页面与服务端代码）从 `penguin-sdk`（`2026.10.12.1`）移到新 Skill `penguin-plugin`（`2026.10.12.1`），契约不变，按小节重新分段。
- **包。** `core`、`cli` 与 `desktop` 改为依赖五个 `@penguinharness/*-rsi-toolkit` 包与 `@penguinharness/agent-evaluation`，不再依赖 `@penguinharness/agent-tuning`。`company-hr` Skill（`2026.10.12.1`）改为：循环用 `default-rsi-toolkit`，Benchmark 用 `agent-evaluation`。
- **算法工具包。** `opro-rsi-toolkit`（OPRO，Yang 等，2023）、`ape-rsi-toolkit`（APE，Zhou 等，2022）、`ace-rsi-toolkit`（ACE，Zhang 等，2025）与 `awm-rsi-toolkit`（AWM，Wang 等，2024），均预装，各自唯一的 Skill 版本为 `2026.10.11.1`。每个 Skill 都以论文的默认参数与一档冒烟预算运行该算法，在 Target Agent 里初始化学习槽（一个 Target 自有的 Skill，加上其 `AGENTS.md` 里的一行固定指令），给每个被测量的候选一个新的、留有快照的 Agent State 版本，最后连同来源链接报告基线分与最终分。每个插件的描述都写明论文及其 arXiv 链接，插件详情弹窗把它显示为在新标签页打开的链接（插件描述里的任何网址现在都会这样显示）。`opro-rsi-toolkit` 与 `ape-rsi-toolkit` 各带一个演示任务（`precise-summary`、`house-style-brief`），用户提出时由 Skill 连同一个新建的 Target Agent 一起搭好。
- **评测契约。** 工具包之间互不依赖。每个算法工具包自带一份 `references/evaluation.md`：沿用 `agent-evaluation` 的单格协议（发给 `run_subagent` worker 的八字段请求、纯 YAML 结果、四个失败码），写入同样的 `scoreboard.yaml` 记录，内置的 Harbor 题按题干运行。四份副本逐字节相同，由 core 测试钉住。
- **方法。** 评估中心**使用** → **优化**标签页新增**方法**：Default、OPRO、APE、ACE 或 AWM。选 Default 以外的方法时，隐藏**最多轮数**与**目标分数**，把被测智能体、Benchmark 与每题运行次数交给该方法的 Skill，并预选这个 Skill。Web 测试把这份列表钉在插件库的 `rsi` 插件上。
- **Benchmark 导入。** `benchmark-design` 把导入流程收为自己的一个分支：`reference/package.md` 解析来源（单个文件夹、一个包目录、一个名字）、固定提交、把配对的 train / test 包一并导入、核对写入的副本，并提议一题的冒烟探测——从不自行启动。评估中心的导入 Prompt 以该 Skill 开头并预选它。
- **草稿页。** 草稿页的自进化算法计数取自插件库（`GET /api/plugins`）`rsi` 分类的工具包数（见[定位调整](2026-10-10-rsi-positioning.zh.md)）。
- **文档。** 「技能与插件」列出新分类与各工具包，「自我进化」新增「RSI 工具包」与「复现的 Benchmark」两节，「评估中心」介绍**方法**字段。
- [#985](https://github.com/Prism-Shadow/penguin-harness/pull/985) 中对四个 `agent-tuning` Skill 的改写、`agent-supervision`，以及 `benchmark-reproduction` 与其 GDPevo 配方都没有并入：复现的 Benchmark 放在 penguin-harness-benchmark 仓库，不放进插件。

## 兼容性

- 插件库里已没有 `agent-tuning`：`penguin agent create --plugins agent-tuning` 以及其他任何指名它的安装请求都以 `404 unknown_plugin` 失败，不会创建任何东西。改用 `default-rsi-toolkit`。
- Agent 已装的四个 Skill 照常保留。插件库按 Skill 名匹配它们，所以**插件市场**页面把每个 Skill 算在现在承载它的插件名下：`agent-optimization` 归 `default-rsi-toolkit`，`benchmark-design` 与 `agent-evaluation` 归 `agent-evaluation`，`agent-initialization` 归 `agent-development`。`benchmark-design`（`2026.10.11.1`）与 `agent-initialization`（`2026.10.12.1`）提示可更新；更新 `agent-development` 时会一并装上 `penguin-plugin`。
- 本次发布之前创建的 Agent 不会自动获得四个算法工具包。要在「优化」标签页选用某个方法，先在**插件市场**页面为该 Agent 安装 `opro-rsi-toolkit`、`ape-rsi-toolkit`、`ace-rsi-toolkit` 或 `awm-rsi-toolkit`。
- npm 上的 `@penguinharness/agent-tuning` 不再发布新版本；改为依赖 `@penguinharness/default-rsi-toolkit` 与 `@penguinharness/agent-evaluation`。
