# 自进化工作台改由 `@penguinharness/rsi-workbench` 提供

- **Date:** 2026-11-26
- **Type:** feature
- **Scope:** `server`, `core`, `web`, `ui-gallery`, `docs`
- **PR:** pending
- **Breaking:** yes — 删除 core 的 Benchmark 导出与 `/api/projects/:p/benchmarks…`；Benchmark 归装有工作台的 Agent 所有

[English](2026-11-26-rsi-workbench-builtin.md)

自进化工作台（原评估中心）改由 [penguin-harness-rsi-platform](https://github.com/Prism-Shadow/penguin-harness-rsi-platform) 的外部内置插件 `@penguinharness/rsi-workbench` 0.2.0 提供，仓内的评估中心整体删除。它是默认 Agent 的客服式工作台：处理器加 iframe 中的页面，与其他 Agent 工作台一样在应用中心的窗口中打开。两个 Skill `benchmark-design` 与 `agent-evaluation` 随包提供。

## 锁定

- `packages/server`、`packages/cli`、`packages/desktop`、`packages/landing` 与 `packages/ui-gallery` 在 `devDependencies` 中把 `@penguinharness/rsi-workbench` 锁定到 v0.2.0 的 GitHub Release 附件，写法与 RSI 工具包相同，不需要 `minimumReleaseAgeExclude`。
- 这五处同时把 `@penguinharness/default-rsi-toolkit` 升到 0.2.20，官网与画廊另把其余九个 RSI 工具包升到重新发布的版本，均来自同一个 Release。工具包与两个 Skill 的缺省 Benchmark 目录改为 `agents/default_agent/app/data/benchmark/`。
- 删除 `@penguinharness/agent-evaluation` 与 `library/benchmark`。

## 移到了哪里

- Benchmark 归各 Agent 所有，存在该 Agent 上 `benchmark` 工作台的数据目录 `<agentDir>/app/data/benchmark/<benchmark_id>/`，默认 Agent 的即 Project 的。移除工作台即删除；导出 Agent 时勾选工作台数据即带走。Harbor 检出放在 `<agentDir>/app/cache/benchmark/harbor/`。
- 工作台首次加载时写入示例与内置 Benchmark，并写下 `.seeded`，此后不再写入。种子随锁定的包提供，构建不再拉取 Benchmark 仓库的 `main`（删除 `scripts/build-benchmarks.mjs`、推送中的 `archives/benchmarks.tgz` 以及 CLI 与桌面端的 `builtin-benchmarks`）。
- 处理器在 `/api/projects/:projectId/agents/:agentId/workbenches/benchmark/api/` 下提供原数据接口，请求、应答与错误码不变。Project 的任何成员都可以创建、删除与覆盖导入 Benchmark；手动创建的 id 由页面依标题生成。
- 页面的「开始」以点击者的身份在所选 Agent 上开一个对话，审批模式取表单所选（缺省「全部放行」），并在各 Benchmark 上列出由此发起的任务。
- 旧链接 `/benchmark`、`/benchmark/<id>` 在窗口中打开同一位置（[向后兼容](2026-11-26-backward-compatibility.zh.md)）。
- 语义 id 的 `benchmark` 种类、市场中 `@penguinharness/agent-evaluation` 的条目与应用中心的排列规则改为 `rsi-workbench`。

## 兼容性

- **core**：不再导出 `placeBenchmark`、`provisionProjectBenchmarks`、清单与记分的读写函数（`parseBenchmarkManifest`、`writeBenchmarkManifest`、`compareDateVersions` 等）、`EXAMPLE_BENCHMARK`、`readBuiltinBenchmarks` 与 `usePushedBenchmarkDirectory`。`benchmark_config.toml` 与 `scoreboard.yaml` 改用 `@penguinharness/rsi-workbench/format` 读写。
- **HTTP**：删除 `/api/projects/:projectId/benchmarks…`，改用 `/api/projects/:projectId/agents/default_agent/workbenches/benchmark/api/benchmarks…`（或其他 Agent 的），`benchmarks` 之下的路径不变。
- **数据**：已有的 Benchmark 与仓内版工作台在下一次启动时一次性迁移，见[向后兼容](2026-11-26-backward-compatibility.zh.md)。
