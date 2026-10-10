# Benchmark 成为包：benchmark_config.toml 新增 id、日期版本与来源

- **Date:** 2026-10-09
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `skills`, `tooling`
- **PR:** [#1008](https://github.com/Prism-Shadow/penguin-harness/pull/1008)

[English](2026-10-09-benchmark-package.md)

Benchmark 的 `benchmark_config.toml` 成为它的清单，像 `plugin.json` 描述插件那样把 Benchmark 描述成一个包。在 `title`、`description`、`runs` 与 `status` 之外，它新增三个键：`id`（即目录名）、日期版本 `version`（`YYYY.MM.DD.N`）与 `[origin]` 表（`kind` 为 `builtin`、`manual`、`agent`、带 `url` / `ref` / `path` / `imported_at` 的 `git`，或带 `imported_at` 的 `zip`）。这三个键读取时都可以省略：早于它们写下的清单照原样读取，以目录名为 id，没有版本，来源未知，也没有任何东西改写它。Benchmark 的包是清单加上各 `CASE-*` 目录；`scoreboard.yaml`、`.jobs/` 下的 trial、其他以点开头的条目和符号链接都留在磁盘上的副本里。

## 细节

- core 新增 `packages/core/src/state/benchmark-manifest.ts`：清单的类型；`parseBenchmarkManifest`，新键出现时才校验（`id` 与所在目录不符报 `benchmark_id_mismatch`，`version` 或 `[origin]` 不合规、或文本不是合法的 TOML 报 `benchmark_manifest_invalid`），旧键照旧宽松读取，不认识的键忽略；`checkBenchmarkManifest`，写入的清单须守的上限（标题 1 到 200 个字符、描述不超过 2,000 个字符、每题运行次数 1 到 1,000、状态为三者之一）；`readBenchmarkManifest`；`writeBenchmarkManifest`（原子写入的 TOML，`[origin]` 表放在最后，校验不通过的一概不写）；`nextDateVersion`（当天的 `.1`，同一天再取下一个序号，从不倒退）与 `compareDateVersions`。
- 示例与五个内置 Benchmark 预置时写入各自的 `id`、来源 `builtin` 与记在 core 数据里的版本（`2026.10.09.1`）。core 导出了 `BUILTIN_BENCHMARKS`。
- 服务端的 Benchmark 列表经由清单读取。名字不是 id 的目录（`.seeding/`、`.harbor/`）从来不算 Benchmark。清单不可用的（不是合法的 TOML、`id` 与所在目录不符、`version` 或 `[origin]` 不合规）以目录名列出，按 `failed` 处理，`manifestError` 给出错误码与原因；读取清单时的文件系统错误则让请求失败。手动创建的 Benchmark 写入它的 `id`、当天的第一个版本与来源 `manual`。`BenchmarkSummary` 新增可选的 `version`、`origin`（其中 `importedAt` 为驼峰写法）与 `manifestError`。`origin.ref` 若出现，必须是 40 位提交 id。
- Web App 的 Benchmark 页面在清单带版本时于目录路径旁显示版本；Agent 从仓库文件夹导入的 Benchmark 另显示指向那个文件夹的链接（只认 http 与 https 链接）。清单读不了的 Benchmark 像创建失败的一样遮罩，写**清单无法读取**：卡片上原因放在图标的悬停提示里，页面上写在提示中。合并后的列表从第一台给出版本的机器取版本与来源。「用 AI 创建」的提示词写明了新增的键。
- agent-tuning `2026.10.09.3`：`benchmark-design` 在 `benchmark_config.toml` 里写入 `id`、版本与 `kind = "agent"` 的 `[origin]` 表，每次改题或改状态都递增版本。
- `scripts/benchmark-packages.mjs --out <dir>` 把五个内置 Benchmark 写成不带记分板的包，供 benchmark 仓库的 `packages/` 使用。`scripts/check-plugin-versions.mjs` 拒绝改了预置 Benchmark 的数据或其题干写入代码、却没在存放版本的文件里换新版本的改动；只改注释或空行的不算。
- 文档的「Benchmark 存储」一节写明了清单、它的可选键、版本规则与包；评估中心与服务端 API 页面随之更新，画廊里的 Benchmark 也带上了版本。
