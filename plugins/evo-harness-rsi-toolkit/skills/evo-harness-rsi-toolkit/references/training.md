---
name: evo-training
description: "Coordinate one Evo training batch with reflection in the original Solver Session and one independent library compilation."
---

# One Evo training batch

You are the training coordinator in this Benchmark environment. Read the run configuration, train-only brief and [learning roles](roles.md). Keep this Session and environment for the whole batch. Solvers answer tasks; one independent Evolver compiles their negative-feedback lessons.

## Solve and reflect

Freeze the pre-batch library, model, tools and thinking level. Give every Solver the same complete general descriptions and matching-topic bodies before it acts. Later tasks do not receive earlier candidates or an updated library. Keep task outputs separate and follow the declared order when business state is shared.

For each task:

1. Start one Solver with the public task, permitted inputs/tools, Solver and reflection roles, answer path and actual feedback interface.
2. Let it answer once and obtain one authorized grade. Preserve the submitted answer and complete raw feedback. A failed scoring call leaves the batch incomplete; do not manufacture a score or resubmit a graded attempt to improve it.
3. On success, retain the trajectory without candidates. On negative feedback, let this same Solver reflect on its actual history. If the coordinator receives the grade, deliver the full feedback by continuing the original child Session with `input_subagent`.
4. Save its negative candidates, including an explicit empty list when no supported lesson emerges. After grading, the Solver reasons over already observed evidence; it does not edit the answer, query new business data or ask for another grade.

Use the Benchmark's declared negative-feedback rule. For normalized feedback, a partial score is not full success; an infrastructure error is not a low task score.

## Compile once

After all tasks finish, start one independent Evolver with the complete private pre-batch library, all negative candidates and all authorized training contexts. Include successful contexts as counterevidence, without turning them into positive-source candidates.

The Evolver makes ADD/MERGE/REVISE/SKIP decisions according to [roles.md](roles.md). Retain decisions and reasons, including an empty decision set when there are no candidates. Keep the five-general/five-per-topic ceilings and the 16,000-byte export budget.

The same Evolver may finish or correct its compilation before export. Do not introduce another Solver pass, candidate test, score gate or second Evolver. A low earlier task score does not establish that a proposed repair will work.

## Export

Freeze the compiled library and export its complete reader, index and eligible methods to the Benchmark's declared Skill location. General exports contain descriptions only; full general bodies remain private. Follow the Benchmark's required answer locations using the original submitted answers, without generating replacements during export.

Save the learning records separately: task order, original Solver identities, answers, full authorized feedback, trajectories, negative candidates, one Evolver's decisions, private library and final export. Record actual cost, duration and token usage for producing this library, including delegated work once. Report missing tasks or deviations. One pass and one compilation provide training observations, not a multi-round optimization curve.
