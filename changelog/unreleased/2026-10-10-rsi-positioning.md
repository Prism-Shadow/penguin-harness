# PenguinHarness repositioned as the Unified and Stable RSI Framework

- **Date:** 2026-10-10
- **Type:** process
- **Scope:** `landing`, `docs`, `web`, `tooling`
- **PR:** [#1030](https://github.com/Prism-Shadow/penguin-harness/pull/1030)

[中文版](2026-10-10-rsi-positioning.zh.md)

The product copy moved from an "open-source, local-first multi-agent app development platform" to the **Unified and Stable RSI Framework**: automatically improve model × harness, so that any model, any algorithm and any agent can recursively self-improve. The READMEs, the landing page, the docs introduction and the Web App's draft screen led with the [RSI toolkits](2026-10-10-rsi-toolkits.md), then the one-sentence agent app, then the cost.

## Details

- **READMEs.** The hero line, the tagline and **Why PenguinHarness** were rewritten. The three reasons were reordered: the most comprehensive agent self-evolution framework came first, followed by the one-sentence agent app and the cost comparison, each keeping its video or chart. The plugin table gained the Agent Self-Evolution row.
- **Landing page.** The hero read "Unified and Stable RSI Framework", alternating "RSI" with "Self-Evolution", over "Automatically improve model × harness · any model · any algorithm · any agent". The stat tiles became 1000+ models, the number of RSI algorithms, the number of Benchmark reproductions and 100% open source; both numbers came from `src/lib/rsi-stats.ts`, which a test pinned to the library's `rsi` plugins and core's built-in Benchmarks. The pillars, the RSI loop section, the closing call to action and the footer tagline followed. The cases section showed two one-sentence examples: building an AI app (the RAG docs expert) and reproducing APE on the demo task shipped with `rsi-ape`, with the Evaluation Center screenshot as a placeholder still. The sled game left the landing page; its images stayed in the repository. The Skills section gained an Agent Self-Evolution card holding the four `rsi-default` Skills and the four algorithm Skills.
- **Docs.** The introduction described PenguinHarness as the Unified and Stable RSI Framework, and its third pillar named the RSI toolkits.
- **Web App.** The draft screen's subtitle became "The most comprehensive agent self-evolution platform", with a line under it counting the self-evolution algorithms and the Benchmark reproductions from `GET /api/rsi`; each number linked to the plugin library or to the Evaluation Center. The example folders opened on "Reproduce self-evolution algorithms": APE and OPRO on their demo tasks, and the Default RSI Toolkit's decision-agent example.
- **Package metadata.** The root `package.json` described PenguinHarness as the Unified and Stable RSI Framework.
