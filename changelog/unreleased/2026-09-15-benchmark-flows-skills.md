# Every Benchmark flow uses agent-evaluation, and the create examples are plain prose again

- **Date:** 2026-09-15
- **Type:** fix
- **Scope:** `web`
- **PR:** [#728](https://github.com/Prism-Shadow/penguin-harness/pull/728)

[中文版](2026-09-15-benchmark-flows-skills.zh.md)

## What changed

- The create, evaluate and optimize conversations the Evaluation Center opens now start with the Skills they rest on preselected — create with `benchmark-design` and `agent-evaluation`, evaluate with `agent-evaluation`, optimize with `agent-optimization` and `agent-evaluation` — so the `[use_skills]` block names them on send and the model reads them before it acts; a Skill the chosen agent lacks is simply not preselected, and the Use dialog already warns about a missing one. All three fixed tails also say in as many words that every evaluation goes through a `run_subagent` subagent told to use `agent-evaluation`, never scored by the model itself and never bypassed. Left to itself, a model sometimes did exactly that.
- The four "Create with AI" examples are one- or two-sentence scenario descriptions again (what contradicts, what is hidden, what is vague). The structured requirements moved into the fixed tail — about three cases, few and hard; the techniques (hidden preconditions, vague or incomplete input, conflicting sources, strict deliverables, no difficulty by piling on rows or rules); a desired baseline below 50; a pilot limit of 4 — each still overridable by the draft above it.
- `benchmark-design` no longer treats a missed desired baseline score as a failed calibration. The publish gate is a fixed 85 on the `0..100` scale: a frozen Formal Baseline below 85 is published however far it stays from the desired score, and `status = "failed"` is written only when no valid Pilot revision can be produced or the lowest-scoring valid one still scores 85 or above at the iteration limit (plugin `agent-tuning` 2026.09.15.1).
- The built-in example Benchmark is versioned: its `benchmark_config.toml` carries `example_version`, a field only the example writes. Loading `default_agent` now replaces an example left by an earlier release — one whose config has no version or an older one — with the current example, whole, evaluations appended to it included; a deleted example stays deleted, an example at the current version is left as it is, and the user's own Benchmarks beside it are never touched.
- The first "Create with AI" example is the home page's decision-agent scenario — football betting, an after-sales action, an investment move, each a finite choice under rules, past cases and current facts that conflict or fall short. The list stays at four: the data-analysis example makes room for it.
