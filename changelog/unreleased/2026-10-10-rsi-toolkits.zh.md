# RSI 工具包：`agent-tuning` 更名为 `rsi-default`，OPRO、APE、ACE 与 AWM 加入

- **Date:** 2026-10-10
- **Type:** feature
- **Scope:** `plugins`, `core`, `server`, `web`, `docs`
- **PR:** [#1030](https://github.com/Prism-Shadow/penguin-harness/pull/1030)
- **Breaking:** yes — `agent-tuning` 插件更名为 `rsi-default`，指名 `agent-tuning` 的安装请求会被拒绝

[English](2026-10-10-rsi-toolkits.md)

插件库新增排在首位的分类 `rsi`（Agent 自进化），收纳 RSI 工具包：每种自进化算法一个插件。`agent-tuning` 更名为 `rsi-default`，即 Default RSI Toolkit，四个 Skill 不变；四个算法工具包 `rsi-opro`、`rsi-ape`、`rsi-ace` 与 `rsi-awm` 随之加入，各用一个同名 Skill 运行一篇论文的算法。评估中心的「优化」标签页新增覆盖这五个工具包的**方法**字段，`GET /api/rsi` 提供自进化目录。OPRO、APE、ACE 与 AWM 的配方来自 Junhao Hu 的 [#985](https://github.com/Prism-Shadow/penguin-harness/pull/985)，改写为互相独立的工具包。

## 细节

- **分类。** `PLUGIN_CATEGORIES` 新增排在首位的 `rsi`，标题为 Agent Self-Evolution / Agent 自进化。`ai-app-development` 保留 `agent-development`、`model-development` 与 `skill-porting`。
- **`rsi-default`。** `plugins/agent-tuning` 移至 `plugins/rsi-default`（`@penguinharness/rsi-default`，`2026.10.10.1`，分类 `rsi`）。`agent-initialization`、`benchmark-design`、`agent-evaluation` 与 `agent-optimization` 的名称与正文不变；清单改为描述 Default RSI Toolkit。`core`、`cli` 与 `desktop` 改为依赖五个 `@penguinharness/rsi-*` 包，不再依赖 `@penguinharness/agent-tuning`。`company-hr` Skill（`agent-company` `2026.10.10.2`）改用新插件名。
- **算法工具包。** `rsi-opro`（OPRO，Yang 等，2023）、`rsi-ape`（APE，Zhou 等，2022）、`rsi-ace`（ACE，Zhang 等，2025）与 `rsi-awm`（AWM，Wang 等，2024），版本均为 `2026.10.10.1`，均预装。每个 Skill 都以论文的默认参数与一档冒烟预算运行该算法，在 Target Agent 里初始化学习槽（一个 Target 自有的 Skill，加上其 `AGENTS.md` 里的一行固定指令），给每个被测量的候选一个新的、留有快照的 Agent State 版本，最后连同来源链接报告基线分与最终分。`rsi-opro` 与 `rsi-ape` 各带一个演示任务（`precise-summary`、`house-style-brief`），用户提出时由 Skill 连同一个新建的 Target Agent 一起搭好。
- **评测契约。** 工具包之间互不依赖。每个算法工具包自带一份 `references/evaluation.md`：沿用 `agent-evaluation` 的单格协议（发给 `run_subagent` worker 的八字段请求、纯 YAML 结果、四个失败码），写入同样的 `scoreboard.yaml` 记录，内置的 Harbor 题按题干运行。四份副本逐字节相同，由 core 测试钉住。
- **方法。** 评估中心**使用** → **优化**标签页新增**方法**：Default、OPRO、APE、ACE 或 AWM。选 Default 以外的方法时，隐藏**最多轮数**与**目标分数**，把被测智能体、Benchmark 与每题运行次数交给该方法的 Skill，并预选这个 Skill。Web 测试把这份列表钉在插件库的 `rsi` 插件上。
- **目录。** `GET /api/rsi`（登录即可）返回 `rsi` 分类的工具包（各带 Skill 与是否预装）以及内置 Benchmark；草稿页的计数读取它（见[定位调整](2026-10-10-rsi-positioning.zh.md)）。
- **文档。** 「技能与插件」列出新分类与各工具包，「自我进化」新增「RSI 工具包」与「复现的 Benchmark」两节，「评估中心」介绍**方法**字段。
- [#985](https://github.com/Prism-Shadow/penguin-harness/pull/985) 中对四个 `agent-tuning` Skill 的改写、`agent-supervision`，以及 `benchmark-reproduction` 与其 GDPevo 配方都没有并入：复现的 Benchmark 放在 penguin-harness-benchmark 仓库，不放进插件。

## 兼容性

- 插件库里已没有 `agent-tuning`：`penguin agent create --plugins agent-tuning` 以及其他任何指名它的安装请求都以 `404 unknown_plugin` 失败，不会创建任何东西。改用 `rsi-default`。
- Agent 已装的四个 Skill 照常保留。插件库按 Skill 名匹配它们，所以**插件市场**页面把它们算在 `rsi-default` 名下，并提示可更新到 `2026.10.10.1`。
- 本次发布之前创建的 Agent 不会自动获得四个算法工具包。要在「优化」标签页选用某个方法，先在**插件市场**页面为该 Agent 安装 `rsi-opro`、`rsi-ape`、`rsi-ace` 或 `rsi-awm`。
- npm 上的 `@penguinharness/agent-tuning` 不再发布新版本；改为依赖 `@penguinharness/rsi-default`。
