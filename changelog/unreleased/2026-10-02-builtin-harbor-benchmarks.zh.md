# 五个内置 Benchmark（PenguinHarness Benchmark Sec A–E），在创建 Project 时写入

- **Date:** 2026-10-02
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `plugins`, `docs`
- **PR:** [#956](https://github.com/Prism-Shadow/penguin-harness/pull/956)

[English](2026-10-02-builtin-harbor-benchmarks.md)

新建的 Project 除 `example-benchmark` 外另带五个内置 Benchmark：PenguinHarness Benchmark Sec A 到 Sec E，依次取自 rag-bench-essential（Data Analysis Bench）、DeepSWE v1.1、AutomationBench、Terminal-Bench-Science 0.1 与 Terminal-Bench 4.0，各为一个能在纯 CPU 的 Docker 环境里运行的子集。它们的题目以 Harbor 任务的形式运行，任务放在公开仓库 Prism-Shadow/penguin-harness-benchmark，运行规则也写在那里；产品只存文本，评估中心的评估流程经 `agent-evaluation` Skill 运行它们。示例与这五个只在创建 Project 时写入一次。

## 细节

- **Project 自带什么。** 服务端在创建 Project 时写入示例与这五个：经 API 创建的 Project、新用户自己的默认 Project，以及全新安装首次启动时的 `default_project`。每个都先写进 `benchmarks/.seeding/` 下的临时目录，再改名就位；写入失败即 Project 创建失败并整体回滚。目录已存在的 id 直接跳过，从不往里写。此后不再写入：初始化或加载 `default_agent` 不再碰 `benchmarks/`，删掉的不会再出现，示例也不再在每次加载时被重新写入。全程不设任何标记文件。
- **五个内置。** id 为 `penguinharness-benchmark-sec-a` 到 `-sec-e`，标题为 PenguinHarness Benchmark Sec A 到 Sec E；每个的描述以原始评测集开头（「Sec A is rag-bench-essential (Data Analysis Bench): …」）。写入时均为 `runs = 1`、`status = "published"`，没有评估记录，各有十道题，即基准仓库各 `selection.json` 定稿的 50 道。各题集按实测模型校准过难度：Sec A–C 把它每次都通过的题换成了更难的，Sec D 重新选题，上限为 40 分钟、320 轮，启动命令还在任务说明前用一句话告诉 Agent 这个时间预算。定义是 `packages/core/src/state/builtin-benchmarks-data.ts` 里的数据，题号随行序。题目目录为 `CASE-NNN-<Harbor 任务名>`。题干给出简述、任务文件夹在仓库固定提交下的链接、来源与容器资源，以及 `## How this case is run` 一节：指向仓库运行规则（其 README 的「Running a task (for agents)」一节）的链接、带每个 trial 上限的完整 `harbor run` 命令与运行前提。评分细则为验证器 reward × 100。题干链接仓库里的实测结果（`results/v0.2.13/README.md`），不在产品里重复这些数字。所有链接都指向仓库的提交 `c12d65b`（即带有校准题集与实测结果的那一个），一个测试要求每份题干都链接 40 位提交。
- **格式。** 内置 Benchmark 的 `benchmark_config.toml` 与普通 Benchmark 一样，只有 `title`、`description`、`runs` 与 `status`，没有任何字段标明题目怎样运行。
- **API。** 没有新增字段：`GET …/benchmarks` 把这五个当作普通的已发布 Benchmark 列出。
- **Web App。** 内置 Benchmark 的显示与其他 Benchmark 无异。记为 `harbor:<trial>` 的运行不是应用里能打开的 Session，评估详情弹窗在它旁边放一个复制 trial 名称的按钮。
- **被测模型。** 评估提示词（对所有 Benchmark 都是同一段）不再指向被测 Agent「配置的模型」，而是写明用评估会话自己的模型：执行评估的 Agent 从其 Environment 的 `Provider` 与 `Model ID` 两行读一次，放进每个格子的请求，思考等级取被测 Agent 的配置。提示词本身不写死模型，所以发送前在输入框里换了模型，测的就是换后的那个；对话框的模型提示也这样写明。`agent-evaluation` 为所有调用方加上同一规则（用自己指令给出的模型对，否则用自己会话的；两者都不完整就停下来问用户），并要求调用方与子会话都不读服务端的 `api-token`、Project 的 `.project_config.toml` 或服务端的 `web.db`，也不拿磁盘上的 token 调服务端 API。
- **Skill。** `agent-evaluation`（agent-tuning `2026.10.09.1`）从题干识别经 Harbor 运行的题——`## How this case is run` 一节写明 Harbor、链接仓库的 40 位提交并给出 `harbor run` 命令——并按仓库的运行规则取仓库、启动、控制并发与 Docker 网络、重试和读取 `result.json`。链接到分支或标签的题干按 `benchmark_invalid` 处理。新增的 `reference/harbor.md` 只规定产品侧：调用方在 `benchmarks/.harbor/` 下建一份以该提交命名的检出，一次改名发布，此后不再改动；每个格子用仓库里的 PenguinHarness 适配器跑一次 Harbor trial，适配器把被测 Agent 的 Agent State（不含 vault、记忆与定时任务）与其 Project 里已保存的模型条目带进任务容器，无网络任务要放行的主机由仓库里的辅助脚本给出。分数为 reward × 100，成本取 trial 的 `agent_result.cost_usd`，耗时取 agent 阶段，Session id 记为 `harbor:<trial>`；trial 的文件留在该 Benchmark 的 `.jobs/` 下。没有 Vault 步骤。调用方同时至多跑四个格子；题干带共享网络那一行的 trial 接入同一个 Docker 网络 `penguin-bench`；Docker 分不出网络的格子降低并发后重跑一次，从不计作 0 分。`benchmark-design` 不碰这些 Benchmark，`agent-optimization` 像使用其他已发布 Benchmark 一样使用它们，但不读任务的测试与验证器输出。
- **文档。** 评估中心页面新增「内置 Benchmark」一节，列出这五个及其原始评测集；它与「自我进化」页都写明了 Project 何时得到示例与内置 Benchmark，以及评估标签页发起的评估用哪个模型。

## 已有的 Project

早先版本的 Project 保持原样：不会得到这五个，已有的 `example-benchmark` 照旧保留，用户删掉的示例也不会被写回（早先版本每次加载 `default_agent` 都会重新写入示例）。新建的 Project 与全新安装的 `default_project` 一开始就有全部六个。
