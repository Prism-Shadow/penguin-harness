# 「使用」对话框可以选被测智能体的模型，工具包的优化提示词把运行协议交还给工具包

- **Date:** 2026-11-05
- **Type:** feat
- **Scope:** `web`, `skills`, `docs`
- **PR:** [#1431](https://github.com/Prism-Shadow/penguin-harness/pull/1431)
- **Issue:** [#1429](https://github.com/Prism-Shadow/penguin-harness/issues/1429)

[English](2026-11-05-use-dialog-tested-model.md)

Benchmark「使用」对话框的两个标签页都新增了**被测智能体使用的模型**，与执行评估或优化的会话所用的模型分开选择。它预设为被测智能体在这个 Benchmark 上最近一次评估所用的模型，没有评估时为 Project 的默认模型；每段提示词都以 `provider` 和 `model_id` 点名这个模型。会话自己的模型只负责派发、打分、修改和记录。使用 Default 时，显示和采用的基线分是被测智能体在这个模型上的分数。

Default 以外的每个 RSI 工具包现在收到同一段通用提示词：它的 Skill、被测智能体、Benchmark、测试集重复次数和被测模型。方法在哪些数据上训练和测试、预算多少、怎样测量、记录什么，都交给工具包自己的 Skill。像 SkillOpt 这样在 Train/Test 对上学习的工具包，不会再被要求在单个 Benchmark 上按每题次数、以冒烟预算优化。对这些工具包，**每题运行次数**改为**测试集重复次数**（默认 3），即方法报告的每个 State 在测试集上完整测几遍，对应已发布实验记录的 `n_attempt`。

`agent-optimization` Skill 以请求点名的被测模型上的评估作为 Reference；OPRO、APE、ACE 和 AWM 的 Skill 把 `test_repetitions` 当作每题运行次数。这五个 Skill 都换了新版本。
