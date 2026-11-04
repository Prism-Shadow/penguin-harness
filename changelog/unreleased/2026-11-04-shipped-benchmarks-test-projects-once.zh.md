# 内置 Benchmark 的 server 测试只创建一次 Project

- **Date:** 2026-11-04
- **Type:** process
- **Scope:** `server`
- **PR:** [#1476](https://github.com/Prism-Shadow/penguin-harness/pull/1476)

[English](2026-11-04-shipped-benchmarks-test-projects-once.md)

`packages/server/test/builtin-agents.test.ts` 中读回内置 Benchmark 的场景，在 macOS runner 上不再超出 5 秒的时限。它原先在一个测试里完成全部工作：启动一个会把整份内置目录复制进每个新建 Project 的 App，创建两个 Project，再逐条读回每个 Case 的题面。自 penguin-harness-benchmark 于 2026-11-02 把 GDPEVO Essential 与 Sec A–E 并入目录后，这在 macOS 上每次尝试都超过 5 秒，在 Windows 上约 22 秒。

## 细节

- App 与两个 Project 在该场景组的 `beforeAll` 中只创建一次，并在 `afterAll` 中删除。
- 场景按 Project 拆为两个：开户时建立的初始 Project，以及之后新建的 Project。各自读回自己的 Project，断言与原先相同。
- 两个场景在 macOS 上重试时只重新读取，不再重新启动 App、重建 Project。
- 两个场景不再承担文件里 `beforeEach` 为其他场景启动、而它们从不使用的那个 App。
