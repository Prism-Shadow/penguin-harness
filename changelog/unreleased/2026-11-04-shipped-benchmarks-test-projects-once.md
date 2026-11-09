# The shipped-Benchmarks server test creates its Projects once

- **Date:** 2026-11-04
- **Type:** process
- **Scope:** `server`
- **PR:** [#1476](https://github.com/Prism-Shadow/penguin-harness/pull/1476)

[中文版](2026-11-04-shipped-benchmarks-test-projects-once.zh.md)

The scenario in `packages/server/test/builtin-agents.test.ts` that reads the shipped Benchmarks back no longer runs out of its 5-second budget on the macOS runner. It booted an app that copies the whole shipped catalog into every Project it creates, created two Projects and read every case statement back, all inside one test. Since penguin-harness-benchmark moved GDPEVO Essential and Sec A–E into the catalog on 2026-11-02, that took more than 5 s per attempt on macOS and about 22 s on Windows.

## Details

- The app and both Projects are created once, in the scenario group's `beforeAll`, and removed in its `afterAll`.
- The scenario is split per Project: the initial Project made at account setup, and a Project created afterwards. Each one reads its own Project back with the same assertions as before.
- A macOS retry of either scenario only reads again; it no longer boots the app and creates its Projects a second time.
- The two scenarios no longer pay for the app the file's `beforeEach` boots for the other scenarios, which they never used.
