# QA rounds: a skill that plans, runs and delivers one

- **Date:** 2026-10-06
- **Type:** process
- **Scope:** `tests`, `skills`

[中文](2026-10-06-qa-round-skill.zh.md)

The `penguin-harness-qa` skill turns the tasks in `tests/scenarios/` into one QA round: plan, run, deliver.

- **Plan.** Given a ref, a budget, the surface the tasks run on, the platforms and optionally a focus and the previous round, the QA Agent recommends a subset of tasks with a one-line reason for each — tasks fitting the platforms, ranked by focus, changelog and open problems, each taken together with its `starts_from` chain within the budget — and writes `<RUN>/plan.md` with every input fixed. The run waits for a person to confirm the plan.
- **Run.** Tasks run in `starts_from` order from the handed-over environment. A task stops at twice its estimated cost, tasks after a failed prerequisite are not run, and tasks left when the budget runs out are marked not run.
- **Deliver.** Besides each task's report, a self-contained `<RUN>/index.html` lists every planned task's status, all product problems, and, when the round covers several platforms, where their verdicts differ.
