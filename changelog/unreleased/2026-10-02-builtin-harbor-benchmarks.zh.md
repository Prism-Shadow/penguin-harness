# 五个内置 Harbor Benchmark，Benchmark 每个 Project 只给一次

- **Date:** 2026-10-02
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `plugins`, `docs`
- **PR:** [#956](https://github.com/Prism-Shadow/penguin-harness/pull/956)

[English](2026-10-02-builtin-harbor-benchmarks.md)

每个 Project 新增五个取自公开评测集的内置 Benchmark：`terminal-bench`（Terminal-Bench 4.0）、`terminal-bench-science`（Terminal-Bench-Science 0.1）、`deep-swe`（DeepSWE v1.1）、`automation-bench`（AutomationBench）与 `rag-bench-essential`（Data Analysis Bench），各为一个能在纯 CPU 的 Docker 环境里运行的子集。它们的题目以 Harbor 任务的形式运行。任务文件不进本仓库，放在公开仓库 Prism-Shadow/penguin-harness-benchmark；评估中心的评估流程经 `agent-evaluation` Skill 运行它们。这五个与 `example-benchmark` 现在每个 Project 各只给一次，删掉的不会再出现。

## 细节

- **只给一次。** default_agent 初始化与之后每次加载时，把 Project 还没得到过的 Benchmark 写入，并记在 `benchmarks/.seeded.json` 里；删掉的不再写回，之后的版本新增内置 Benchmark 时只补新增的那个。每个 Benchmark 先写进 `benchmarks/.seeding/`，改名就位后才记入标记，因此崩溃既不会留下写了一半的 Benchmark，也不会让标记记下一个从未写成的 Benchmark。用户自己的目录占用了某个内置 Harbor id 时，这个目录一概不动，等它不在了才补上那个内置 Benchmark。从标记里删掉某个 id，就会再给一次。`example-benchmark` 改按同一规则，内容不变；此前删掉后每次加载都会重新写入。共用一个数据根的两个进程（服务端与 CLI）可以同时预置：每次写标记前都重读一遍、写入并集，另一个进程先放好的 Benchmark 同样算作已给，暂存区只清理一小时以上的残留。标记无法读取时什么也不写，并在每个进程的 stderr 上报一次。
- **五个内置。** 预置时均为 `runs = 1`、`status = "published"`，没有评估记录，各有十道题，即基准仓库各 `selection.json` 定稿的 50 道。定义是 `packages/core/src/state/builtin-benchmarks-data.ts` 里的数据，题号随行序。题干与文档链接仓库里的实测结果（`results/v0.2.13/README.md`），不在产品里重复这些数字。
- **格式。** `benchmark_config.toml` 写有 `kind = "harbor"` 与 `[harbor]` 表：`repo`、`ref`、`path`、`agent`、`harbor_version`、`run_timeout`、`max_turns`、`allow_agent_hosts`，rag-bench-essential 另有 `setup`。题目目录为 `CASE-NNN-<Harbor 任务名>`。题干给出简述、任务文件夹在 `ref` 下的链接、来源、容器资源与 `harbor run` 命令；评分细则为验证器 reward × 100。一个标记为「预期失败」的测试要求 `ref` 是 40 位提交，直到结果提交固定下来。
- **API。** `GET …/benchmarks` 为这类 Benchmark 返回 `kind: "harbor"` 与 `harbor: { repo, ref, path }`。`kind` 缺少可用的 `[harbor]` 表，或取其他值，都按普通 Benchmark 读取；手动创建接口仍只写普通 Benchmark。
- **Web App。** Harbor Benchmark 的卡片与页面标题带一个中性的 **Harbor** 标签，页面在**题目文件**处链接仓库的 `ref`。评估标签页多一行说明运行所需：执行评估的智能体所在机器装有 Docker 与 uv，评估所用的模型已保存 API key。记为 `harbor:<trial>` 的运行旁有一个复制 trial 名称的按钮。
- **被测模型。** 评估提示词（对所有 Benchmark 都是同一段）不再指向被测 Agent「配置的模型」，而是写明用评估会话自己的模型：执行评估的智能体从其 Environment 的 `Provider` 与 `Model ID` 两行读一次，放进每个格子的请求，思考等级取被测 Agent 的配置。提示词本身不写死模型，所以发送前在输入框里换了模型，测的就是换后的那个；对话框的模型提示也这样写明。`agent-evaluation` 为所有调用方加上同一规则（用自己指令给出的模型对，否则用自己会话的；两者都不完整就停下来问用户），并要求调用方与子会话都不读服务端的 `api-token`、Project 的 `.project_config.toml` 或服务端的 `web.db`，也不拿磁盘上的 token 调服务端 API。
- **Skill。** `agent-evaluation`（agent-tuning `2026.10.03.1`）新增 `reference/harbor.md`。调用方把 `ref` 解析为提交，在 `benchmarks/.harbor/` 下建一份以该提交命名的检出，一次改名发布，此后不再改动。每个格子用仓库里的 PenguinHarness 适配器跑一次 Harbor trial，适配器把被测 Agent 的 Agent State（不含 vault、记忆与定时任务）与其 Project 里已保存的模型条目带进任务容器；无网络任务要放行的主机由仓库里的辅助脚本给出。分数为 reward × 100，成本取 trial 的 `agent_result.cost_usd`，耗时取 agent 阶段，Session id 记为 `harbor:<trial>`；trial 的文件留在该 Benchmark 的 `.jobs/` 下。没有 Vault 步骤。调用方同时至多跑四个格子。Terminal-Bench 与 Terminal-Bench-Science 的 trial 经仓库的 `tools/docker/shared-network.yaml` 接入同一个共享 Docker 网络 `penguin-bench`，DeepSWE 的 trial 从不接入。Docker 分不出网络的格子降低并发后重跑一次，从不计作 0 分。`benchmark-design` 不碰 Harbor Benchmark，`agent-optimization` 像使用其他已发布 Benchmark 一样使用它们，但不读任务的测试与验证器输出。
- **文档。** 评估中心页面新增「内置 Harbor Benchmark」一节；它与「自我进化」页都写明了每个 Project 只给一次的规则，以及评估标签页发起的评估用哪个模型。

## 已有的 Project

早先版本的 Project 在其 default_agent 下次加载时得到这五个。已经存在的 `example-benchmark` 记为已得到、原样保留；用户删掉过的示例会在标记第一次写入时再写入一次，此后不再出现。
