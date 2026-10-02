# 五个内置 Harbor Benchmark

- **Date:** 2026-10-02
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `plugins`, `docs`
- **PR:** [#956](https://github.com/Prism-Shadow/penguin-harness/pull/956)

[English](2026-10-02-builtin-harbor-benchmarks.md)

每个 Project 新增五个取自公开评测集的内置 Benchmark：`terminal-bench`（Terminal-Bench 4.0）、`terminal-bench-science`（Terminal-Bench-Science 0.1）、`deep-swe`（DeepSWE v1.1）、`automation-bench`（AutomationBench）与 `rag-bench-essential`（Data Analysis Bench），各为一个能在纯 CPU 的 Docker 环境里运行的子集。它们的题目以 Harbor 任务的形式运行。任务文件不进本仓库，放在公开仓库 Prism-Shadow/penguin-harness-benchmark；评估中心的评估流程经 `agent-evaluation` Skill 运行它们。

## 细节

- **预置。** default_agent 初始化与之后每次加载时，写入目录尚不存在的内置 Benchmark，与 `example-benchmark` 并列、规则相同：已存在的目录一概不动（用户自建的同名 Benchmark 亦然），删掉的下次加载会回来。预置时均为 `runs = 1`、`status = "published"`，没有评估记录。定义是 `packages/core/src/state/builtin-benchmarks-data.ts` 里的数据，题号随行序。
- **格式。** `benchmark_config.toml` 写有 `kind = "harbor"` 与 `[harbor]` 表：`repo`、`ref`、`path`、`agent`、`harbor_version`、`run_timeout`、`max_turns`、`allow_agent_hosts`，rag-bench-essential 另有 `setup`。题目目录为 `CASE-NNN-<Harbor 任务名>`。题干给出简述、任务文件夹在 `ref` 下的链接、来源、容器资源与 `harbor run` 命令；评分细则为验证器 reward × 100。
- **API。** `GET …/benchmarks` 为这类 Benchmark 返回 `kind: "harbor"` 与 `harbor: { repo, ref, path }`。`kind` 缺少可用的 `[harbor]` 表，或取其他值，都按普通 Benchmark 读取；手动创建接口仍只写普通 Benchmark。
- **Web App。** Harbor Benchmark 的卡片与页面标题带一个中性的 **Harbor** 标签，页面在**题目文件**处链接仓库的 `ref`。评估标签页多一行说明运行所需：执行评估的智能体所在机器装有 Docker 与 uv，被测智能体的模型已保存 API key。记为 `harbor:<trial>` 的运行旁有一个复制 trial 名称的按钮。
- **Skill。** `agent-evaluation`（agent-tuning `2026.10.02.1`）新增 `reference/harbor.md`。调用方先把仓库取到 `benchmarks/.harbor/` 下一次，每个格子用仓库里的 PenguinHarness 适配器跑一次 Harbor trial，适配器把被测 Agent 的 Agent State（不含 vault）与其 Project 里已保存的模型条目带进任务容器。分数为 reward × 100，成本取 trial 的 `agent_result.cost_usd`，耗时取 agent 阶段，Session id 记为 `harbor:<trial>`；trial 的文件留在该 Benchmark 的 `.jobs/` 下。没有 Vault 步骤。`benchmark-design` 不碰 Harbor Benchmark，`agent-optimization` 像使用其他已发布 Benchmark 一样使用它们，但不读任务的测试与验证器输出。
- **文档。** 评估中心页面新增「内置 Harbor Benchmark」一节。
