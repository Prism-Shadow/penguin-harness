# Every Benchmark flow uses agent-evaluation, and the create examples are plain prose again

- **Date:** 2026-09-15
- **Type:** fix
- **Scope:** `web`
- **PR:** [#728](https://github.com/Prism-Shadow/penguin-harness/pull/728)

[中文版](2026-09-15-benchmark-flows-skills.zh.md)

## What changed

- The create, evaluate and optimize conversations the Evaluation Center opens now start with the Skills they rest on preselected — create with `benchmark-design` and `agent-evaluation`, evaluate with `agent-evaluation`, optimize with `agent-optimization` and `agent-evaluation` — so the `[use_skills]` block names them on send and the model reads them before it acts; a Skill the chosen agent lacks is simply not preselected, and the Use dialog already warns about a missing one. All three fixed tails also say in as many words that every evaluation goes through a `run_subagent` subagent told to use `agent-evaluation`, never scored by the model itself and never bypassed. Left to itself, a model sometimes did exactly that.
- The four "Create with AI" examples are one- or two-sentence scenario descriptions again (what contradicts, what is hidden, what is vague). The structured requirements moved into the fixed tail — about three cases, few and hard; the techniques (hidden preconditions, vague or incomplete input, conflicting sources, strict deliverables, no difficulty by piling on rows or rules); a desired baseline below 50; a pilot limit of 4 — each still overridable by the draft above it.
