# QA 一轮：计划、运行、交付的 Skill

- **Date:** 2026-10-06
- **Type:** process
- **Scope:** `tests`, `skills`

[English](2026-10-06-qa-round-skill.md)

`penguin-harness-qa` Skill 把 `tests/scenarios/` 里的任务串成一轮 QA：计划、运行、交付。

- **计划**：给定被测 ref、预算、执行面、平台，以及可选的重点与上一轮，QA Agent 给出建议的任务子集，每个任务附一句理由——先筛掉平台不适用的，再按重点、changelog、遗留问题排序，连同 `starts_from` 链上的前置任务在预算内选入——并写出定好全部输入的 `<RUN>/plan.md`。计划经人确认后才开跑。
- **运行**：按 `starts_from` 的顺序、从交接下来的环境开始跑。单个任务用到预估时长的两倍即停；前置任务失败后，依赖它的任务不跑；预算用完时，其余任务记为未跑。
- **交付**：除各任务的报告外，单文件总览 `<RUN>/index.html` 列出每个计划任务的状态、全部产品问题，覆盖多个平台时还列出各平台结论的差异。
