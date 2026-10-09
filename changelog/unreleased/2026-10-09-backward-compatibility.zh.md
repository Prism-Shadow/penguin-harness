# 向后兼容：benchmark.json 之前的 Benchmark

- **Date:** 2026-10-09
- **Type:** process
- **Scope:** `core`, `server`, `skills`

[English](2026-10-09-backward-compatibility.md)

[Benchmark 成为由 benchmark.json 描述的包](2026-10-09-benchmark-package.zh.md)。有两样东西会延续到新版本：每个既有 Benchmark 都有的 `benchmark_config.toml`（每个 Project 的示例与 Sec A–E，以及人或 Agent 建的每个 Benchmark），以及 Agent 里已安装的 agent-tuning 副本——它们在更新之前一直读写这个文件。

## 旧形态：只有 `benchmark_config.toml` 的 Benchmark 目录

服务端的 Benchmark 列表经由 `packages/core/src/state/benchmark-manifest.ts` 中的 `readBenchmarkManifest` 读取，它在读到这种目录时就地收编：按此前读取 TOML 的宽松口径由 TOML 构造清单——标题缺失或不可用时取目录名，每题运行次数缺失时为 1、超过 1,000 时为 1,000，只有明写 `draft` 或 `failed` 才是草稿或失败，其余一律按已发布处理。版本取 TOML 最后修改的那一天，记为 `.1`；早先版本预置的六个 id（`example-benchmark`、`penguinharness-benchmark-sec-a` 至 `-sec-e`）的 `origin.kind` 为 `builtin`，其余为 `agent`。它把结果写成 TOML 旁边的 `benchmark.json`，TOML 原样保留。此后读的就是 `benchmark.json`，旁边的 TOML 不再理会。有三种情形不同：

- TOML 写着 `draft` 的 Benchmark 只读取、不转换：仍在设计它的 agent-tuning 副本完成时会把 `published` 或 `failed` 写进 TOML，下一次读取时再转换。
- 解析不了的 TOML 不转换。这个 Benchmark 照旧以目录名列出，直到 TOML 修好为止。
- 写不进去的数据根，每次列出时都重新读取 TOML。

`agent-evaluation` 与 `agent-optimization` 两个 Skill 读取 `benchmark.json`，在转换之前读取 TOML，因此还没被列出过的数据根照样能评测。早先版本已安装的 agent-tuning 副本继续读写保留下来的 TOML；Agents 页面提示的插件更新会把它们换成新的 Skill。

**用户无需任何操作。** 每个既有 Benchmark 照常列出，并多了一个版本。既有 Project 里的内置 Benchmark 以其 TOML 写入的那一天为版本，而不是新预置的内置 Benchmark 所带的版本。

## 何时可以移除

在 0.3.0 发布准备时，由负责该次发布的人移除。移除之前，负责发布的人须先与用户确定一件事：还没被任何一次列出转换的纯 TOML Benchmark（此后没人在评估中心打开过的 Project、始终没有完成的草稿）如何处理——启动时一次性转换并删除所有残留的 `benchmark_config.toml`，还是任其成为列表不再显示的文件。随后移除：

- `packages/core/src/state/benchmark-manifest.ts` 中的收编逻辑（`adoptLegacyConfig`、`legacyManifest`、`LEGACY_SEEDED_IDS`）、`BENCHMARK_LEGACY_CONFIG` 与 `smol-toml` 的引入，使 `readBenchmarkManifest` 对没有 `benchmark.json` 的目录返回 null；
- `plugins/agent-tuning/skills/agent-evaluation/SKILL.md` 与 `plugins/agent-tuning/skills/agent-optimization/SKILL.md` 中「(or, until it is converted, the older `benchmark_config.toml`)」这几个字，并递增插件版本；
- `packages/core/test/benchmark-manifest.test.ts` 与 `packages/server/test/benchmarks.test.ts` 中标有 `compat(0.3.0)` 的用例；
- `packages/docs/content/self-improvement.{en,zh}.md` 中关于 `benchmark_config.toml` 的段落，以及 `packages/docs/content/server-api.{en,zh}.md` 中的对应分句。
