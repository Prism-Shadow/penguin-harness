# The Self-Evolution Workbench ships from `@penguinharness/rsi-workbench`

- **Date:** 2026-11-26
- **Type:** feature
- **Scope:** `server`, `core`, `web`, `ui-gallery`, `docs`
- **PR:** [#1899](https://github.com/Prism-Shadow/penguin-harness/pull/1899)
- **Breaking:** yes — core's Benchmark exports and `/api/projects/:p/benchmarks…` were removed; Benchmarks belong to the Agent the workbench is on

[中文版](2026-11-26-rsi-workbench-builtin.zh.md)

The Self-Evolution Workbench (the former Evaluation Center) came from the external built-in plugin `@penguinharness/rsi-workbench` 0.2.0 of [penguin-harness-rsi-platform](https://github.com/Prism-Shadow/penguin-harness-rsi-platform), and the in-repo Evaluation Center was deleted. The workbench is a Support-style workbench of the default Agent: a handler and a page in an iframe, opened in the App Center window like any other Agent workbench. Its two Skills, `benchmark-design` and `agent-evaluation`, came with it.

## Pins

- `packages/server`, `packages/cli`, `packages/desktop`, `packages/landing` and `packages/ui-gallery` pinned `@penguinharness/rsi-workbench` to its v0.2.0 GitHub Release asset in `devDependencies`, the form the RSI toolkits use, which needs no `minimumReleaseAgeExclude` entry.
- The same five raised `@penguinharness/default-rsi-toolkit` to 0.2.20, and landing and the gallery the nine other RSI toolkits to their re-released versions, all from the same Release. The toolkits and the two Skills name `agents/default_agent/app/data/benchmark/` as the default Benchmark folder.
- `@penguinharness/agent-evaluation` and `library/benchmark` were removed.

## What moved where

- The Benchmarks are kept per Agent, in the data folder of the workbench `benchmark` of the Agent it is installed on: `<agentDir>/app/data/benchmark/<benchmark_id>/`, the default Agent's being the Project's. Removing the workbench deletes them; exporting the Agent with its workbench data carries them. Harbor checkouts go to `<agentDir>/app/cache/benchmark/harbor/`.
- The workbench seeds the Example and the built-in Benchmarks on its first load and writes `.seeded`; it never seeds again. The seeds come from the pinned package, so a build no longer fetches the Benchmark repository's `main` (`scripts/build-benchmarks.mjs` was deleted, with the `archives/benchmarks.tgz` push and the CLI's and the desktop app's `builtin-benchmarks`).
- The handler serves the former data routes under `/api/projects/:projectId/agents/:agentId/workbenches/benchmark/api/`, with the same requests, answers and error codes. Any member of the Project may create, delete and overwrite-import a Benchmark; a hand-made Benchmark's id is generated from its title on the page.
- The page's Start opens a conversation as the person who clicked it on the chosen Agent, with the approval mode the form names (allow all by default), and lists the tasks it started per Benchmark.
- Old `/benchmark`, `/benchmark/<id>` links open the window at the same place ([backward compatibility](2026-11-26-backward-compatibility.md)).
- A Project's `benchmark` semantic-id kind, the market's `@penguinharness/agent-evaluation` entry and the App Center's arrangement rule moved to `rsi-workbench`.

## Compatibility

- **Core.** `placeBenchmark`, `provisionProjectBenchmarks`, the manifest and scoreboard readers and writers (`parseBenchmarkManifest`, `writeBenchmarkManifest`, `compareDateVersions`, …), `EXAMPLE_BENCHMARK`, `readBuiltinBenchmarks` and `usePushedBenchmarkDirectory` are no longer exported. Read and write `benchmark_config.toml` and `scoreboard.yaml` with `@penguinharness/rsi-workbench/format`.
- **HTTP.** `/api/projects/:projectId/benchmarks…` was removed. Call `/api/projects/:projectId/agents/default_agent/workbenches/benchmark/api/benchmarks…` (or another Agent's) instead; the paths below `benchmarks` are unchanged.
- **Data.** Existing Benchmarks and in-repo workbench copies are moved once at the next start; see [backward compatibility](2026-11-26-backward-compatibility.md).
