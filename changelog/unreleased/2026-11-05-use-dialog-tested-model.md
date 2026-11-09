# The Use dialog picks the tested agent's model, and a toolkit's Optimize prompt leaves its protocol to the toolkit

- **Date:** 2026-11-05
- **Type:** feat
- **Scope:** `web`, `skills`, `docs`
- **PR:** [#1431](https://github.com/Prism-Shadow/penguin-harness/pull/1431)
- **Issue:** [#1429](https://github.com/Prism-Shadow/penguin-harness/issues/1429)

[中文版](2026-11-05-use-dialog-tested-model.zh.md)

Both tabs of a Benchmark's **Use** dialog have a new field, **Tested agent's model**, separate from the model of the conversation that runs the evaluation or the optimization. It is preset to the model of the tested agent's latest evaluation on that Benchmark, or to the Project's default model when it has none, and every prompt names it as `provider` and `model_id`. The conversation's model only fans out, scores, edits and records. With Default, the baseline shown and used is the tested agent's score on that model.

Every RSI toolkit other than Default now gets the same general prompt: its Skill, the tested agent, the Benchmark, the test-set repetitions and the tested model. Which data the method trains and tests on, its budget, how it measures and what it records are left to the toolkit's own Skill. A Train/Test toolkit such as SkillOpt is no longer told to optimize one Benchmark per case at a smoke budget. For these toolkits **Runs per case** becomes **Test-set repetitions** (3 by default), the number of complete passes over the test set for each State the method reports, as a published experiment records `n_attempt`.

The `agent-optimization` Skill uses the evaluation on the tested model a request names as its Reference. The OPRO, APE, ACE and AWM Skills read `test_repetitions` as their runs per case. All five carry a new version.
