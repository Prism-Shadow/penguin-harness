# The Optimize tab asks a Train/Test toolkit for what it actually runs on

- **Date:** 2026-11-03
- **Type:** fix
- **Scope:** `web`, `core`, `server`, `skills`, `docs`

[中文版](2026-11-03-optimize-train-test-toolkits.zh.md)

Every RSI toolkit other than Default used to get the same Optimize prompt: one frozen Benchmark, runs per case, the Skill's smoke budget and every candidate recorded on that Benchmark's scoreboard. SkillAdam, SkillOpt, OpenSkill and TRACE work differently. They learn on a Train package in one continuous environment, then test the frozen baseline and final States several times on the paired Test package, and they define no smoke budget. The prompt contradicted their own Skill.

A plugin can now declare `penguin.rsi_protocol` in its `package.json`: `benchmark`, the meaning when absent, or `train-test`. The four continuous-training toolkits declare `train-test`. With one of them picked, the Optimize tab asks for **Test repetitions** (3 by default) in place of runs per case and says which packages the method uses. The prompt then asks the Skill to resolve the Train/Test pair, train once, test each frozen State that many times and record only the baseline's and the final State's Test matrices. The plugin library lists the field as `rsiProtocol`. Default and the toolkits that optimize against one Benchmark keep the form and prompt they had.
