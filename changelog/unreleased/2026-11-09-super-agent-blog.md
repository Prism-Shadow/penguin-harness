# The blog gains a Super-agent post with two drawn figures

- **Date:** 2026-11-09
- **Type:** process
- **Scope:** `landing`
- **PR:** [#1513](https://github.com/Prism-Shadow/penguin-harness/pull/1513)

[中文版](2026-11-09-super-agent-blog.zh.md)

The blog gains a bilingual post, `designing-agents-to-replace-human-roles`: a reading of DeepSeek's internal Super-agent architecture as a study in handing over the runtime loop. It walks through three mechanisms — event-driven triggers with a code-rule-then-model two-tier filter and silent bug reproduction that ends in a PR, an always-on Router that keeps global context and dispatches tasks to isolated concurrent Workers, and an external Watchdog Agent that checks Worker progress and steps in on dead loops or drift — then argues that designing an agent means finding the steps a human still performs and asking whether another agent can take them, which is the same move PenguinHarness makes for evaluation and tuning.

The post carries two interactive figures, mounted by `packages/landing/src/blog-widgets/figure.tsx` from a `data-widget` attribute: an architecture topology whose three mechanisms light up in turn, and a three-stage evolution from human-led to agent-led work whose spotlight sweeps across the stages. Both figures stay still with every part lit under reduced motion.
