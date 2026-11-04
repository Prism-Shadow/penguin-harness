# 落地页列出没有上游的 Benchmark

- **Date:** 2026-11-04
- **Type:** fix
- **Scope:** `landing`, `agents`
- **PR:** [#1458](https://github.com/Prism-Shadow/penguin-harness/pull/1458)
- **Issue:** [#1452](https://github.com/Prism-Shadow/penguin-harness/issues/1452)

[English](2026-11-04-landing-original-benchmarks.md)

首屏的评估集清单新增「生物医学」，即专为 Benchmark 仓库编写的内置 Benchmark。没有上游的 Benchmark 链到它在 [penguin-harness-benchmark](https://github.com/Prism-Shadow/penguin-harness-benchmark) 里的包。

## 细节

- 每个评估集条目按键名标明类别，中英两份词典把键名映射到文案，由编译器检查每个条目在两种语言下都有文案。
- 删去 `packages/landing/test/rsi-stats.test.ts`。它把首屏手工维护的清单钉在插件目录和从另一仓库 `main` 克隆的 Benchmark 目录上，那边一合并，这边所有开着的 PR 的 CI 都会失败。
- 开发 Skill 的测试规范新增两类不该写的测试：手工清单与其来源之间的同步检查，以及读取本仓库未固定内容的测试（另一仓库的实时分支、真实网络、当天日期）。
