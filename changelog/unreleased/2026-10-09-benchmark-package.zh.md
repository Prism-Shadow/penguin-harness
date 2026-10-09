# Benchmark 成为包：benchmark.json 取代 benchmark_config.toml，并带日期版本

- **Date:** 2026-10-09
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `skills`, `tooling`

[English](2026-10-09-benchmark-package.md)

Benchmark 的配置改为清单 `benchmark.json`，像 `plugin.json` 描述插件那样把 Benchmark 描述成一个包：`id`（即目录名）、`title`、`description`、日期版本 `version`（`YYYY.MM.DD.N`）、`status`、`runs` 与 `origin`（`builtin`、`manual`、`agent`、带 `url` / `ref` / `path` / `imported_at` 的 `git`，或带 `imported_at` 的 `zip`）。Benchmark 的包是清单加上各 `CASE-*` 目录；`scoreboard.yaml`、`.jobs/` 下的 trial、其他以点开头的条目和符号链接都留在磁盘上的副本里。磁盘上已有的 `benchmark_config.toml` 如何读取，记在[向后兼容](2026-10-09-backward-compatibility.zh.md)中。

## 细节

- core 新增 `packages/core/src/state/benchmark-manifest.ts`：清单的类型、`parseBenchmarkManifest`（严格校验；报 `benchmark_manifest_invalid`，`id` 与所在目录不符时报 `benchmark_id_mismatch`；不认识的字段忽略）、`readBenchmarkManifest`、`writeBenchmarkManifest`（原子写入、两空格缩进的 JSON，读取方会拒绝的清单一概不写）、`nextDateVersion`（当天的 `.1`，同一天再取下一个序号，从不倒退）与 `compareDateVersions`。
- 示例与五个内置 Benchmark 预置时写 `benchmark.json`，来源为 `builtin`，各自的版本记在 core 的数据里（`2026.10.09.1`）。core 导出了 `BUILTIN_BENCHMARKS`。
- 服务端的 Benchmark 列表经由清单读取。名字不是 id 的目录（`.seeding/`、`.harbor/`）从来不算 Benchmark；清单读不了的仍以目录名列出，按 published 处理，不带版本。手动创建的 Benchmark 写入当天的第一个版本，来源为 `manual`。`BenchmarkSummary` 新增 `version` 与 `origin`（其中 `importedAt` 为驼峰写法）。
- Web App 的 Benchmark 页面在目录路径旁显示版本；Agent 从仓库文件夹导入的 Benchmark 另显示指向那个文件夹的链接（只认 http 与 https 链接）。合并后的列表从第一台给出版本的机器取版本与来源。「用 AI 创建」的提示词改为写明 `benchmark.json` 及其字段。
- agent-tuning `2026.10.09.3`：`benchmark-design` 写入带版本、来源为 `agent` 的 `benchmark.json`，每次改题或改状态都递增版本；`agent-evaluation` 与 `agent-optimization` 读取 `benchmark.json`。
- `scripts/benchmark-packages.mjs --out <dir>` 把五个内置 Benchmark 写成不带记分板的包，供 benchmark 仓库的 `packages/` 使用。`scripts/check-plugin-versions.mjs` 拒绝改了预置 Benchmark 的数据或其题干写入代码、却没在存放版本的文件里换新版本的改动。
- 文档的「Benchmark 存储」一节写明了清单、版本规则与包；评估中心与服务端 API 页面随之更新，画廊里的 Benchmark 也带上了版本。
