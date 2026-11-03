# 「优化」标签页按 Train/Test 工具包实际的运行方式向它提要求

- **Date:** 2026-11-03
- **Type:** fix
- **Scope:** `web`, `core`, `server`, `skills`, `docs`

[English](2026-11-03-optimize-train-test-toolkits.md)

以前，Default 以外的每个 RSI 工具包收到的都是同一段优化提示词：一个冻结的 Benchmark、每题运行次数、技能的冒烟预算，并把每个候选都记入这个 Benchmark 的记分板。SkillAdam、SkillOpt、OpenSkill 和 TRACE 的做法不同：它们在一个连续环境里用 Train 包学习，再把冻结的 baseline 与 final State 在配对的 Test 包上测试若干次，也没有定义冒烟预算。提示词和它们自己的 Skill 互相矛盾。

插件现在可以在 `package.json` 里声明 `penguin.rsi_protocol`：`benchmark`（不填即此义）或 `train-test`。这四个连续训练工具包声明为 `train-test`。选中其中一个时，「优化」标签页把每题运行次数换成**测试重复次数**（默认 3），并说明方法用的是哪两个包。提示词随之要求 Skill 自己找到配对的 Train/Test 包，训练一次，每个冻结 State 测试这么多次，只记录 baseline 与 final 的 Test 矩阵。插件库以 `rsiProtocol` 列出这个字段。Default 和在单个 Benchmark 上优化的工具包，表单与提示词不变。
