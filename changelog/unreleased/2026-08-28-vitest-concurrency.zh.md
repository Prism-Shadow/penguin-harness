# 一次测试只占半台机器，而不是整台

- **Date:** 2026-08-28
- **Type:** fix
- **Scope:** `tooling`

[English](2026-08-28-vitest-concurrency.md)

在一台 8 核主机上，`pnpm test` 最多能开出 28 个重量级 Node 进程——而且确实开了：两个并发上限相乘。`pnpm -r` 默认同时跑 4 个包，而每个包的 vitest 又按 CPU 数决定自己的进程池大小（vitest 的默认值是 `核数 - 1`）。这些 fork 还都不小：server 那套测试以 `isolate: false` 运行，因此它的每一个 fork 在整个生命周期内都常驻着完整的应用模块图——server、core、SQLite。

结果就是一次测试运行会和主机上其他一切争抢最后那点内存。在开发者自己的机器上，被抢的是他自己的 PenguinHarness 服务端；在共享主机上，被抢的是别人的工作。无论哪种，内核挑出来杀掉的都不会是测试进程。

现在两个维度都设了上限——只限制其中一个不够，因为它们是相乘的：

- 包**一次只跑一个**（根 `test` 脚本上的 `--workspace-concurrency=1`）。
- 每个进程池最多取**可用核数的一半**，且不少于 1（`vitest.shared.ts`，展开进每个包的 vitest 配置）。

用 `availableParallelism()` 而非裸 CPU 数：在容器里它报告的是本进程真正可以使用的份额，而那正是这个上限所关心的数字。机器确实闲置时——CI runner，或者一台没跑别的东西的笔记本——可用 `VITEST_MAX_FORKS` 覆盖，那种场合的要点本来就是把资源用满。

直接跑单个包的测试（`pnpm --filter … test`）除了进程池上限之外没有变化。
