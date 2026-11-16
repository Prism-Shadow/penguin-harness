---
name: openskill-rsi-toolkit
description: "Run OpenSkill on selected Project Benchmarks: research domain knowledge, refine reusable Skills with independent virtual tests, freeze the last revision, then evaluate baseline and final."
version: 2026.10.29.4
---

# OpenSkill

You are the experiment controller. Use the selected Benchmark's instructions and Penguin's existing tools to arrange learning, freezing and evaluation.

[OpenSkill: Open-World Self-Evolution for LLM Agents](https://arxiv.org/abs/2606.06741v1) learns reusable Skills without target-task supervision. It retrieves domain knowledge and separate verification anchors, then refines Skills using independent virtual tests. The creator keeps its learning history; the verifier independently checks the resulting work. Model weights and tools stay fixed.

The output is the **last valid Skill revision**, not the revision with the highest earlier virtual score. Freeze every construction Case before measuring either baseline or final on the target Benchmark. [Source notes](references/source-notes.md) explain the implementation reference and Penguin adaptations.

## Before you start

If the request only names this Skill, ask which Target and Benchmark to use. Resolve supplied experiment details from the request and Project before asking for anything else.

Follow [initialization](references/initialization.md). Find the selected Benchmark in the current Project, read its manifest and Case statements, and resolve the documented runtime and source commit. The user need only name an installed Benchmark.

Use all declared Train and Test questions unless a subset is requested. Build one library per independent benchmark or training unit. Within it, each construction Case has its own persistent creator and fixed Skill plan; do not combine unrelated Cases into one creator's learning history. A continuous Train Case can contain several questions.

Resolve the Target Agent, model, thinking level, experiment version, runtime limits and output directory before starting. The Target is separate from this controller. Keep the same solving configuration for baseline and final.

| Setting | Default |
| --- | --- |
| Construction runs per benchmark/training unit | 1 |
| Planned Skills per construction Case | 1–4; keep the decomposition fixed |
| Refinement retries per Case | Up to 3 |
| Targeted searches after failure | Up to 3 per Case |
| Virtual tests | Up to 60 checks per verification |
| Complete Test repetitions per frozen State | 3 |

Use user-supplied experiment settings when present and record the choices. Runtime and resource limits come from the selected Benchmark and execution environment.

## Learn with independent virtual feedback

Give the learner [training.md](references/training.md), the public construction inputs and the fixed settings. Keep its learning Session and environment available across revisions. Use Penguin's supported delegation and Session continuation for the creator and verifier roles.

1. **Research.** Retrieve domain knowledge and make a separate pass for independently justified verification anchors. Queries must describe the domain problem without identifying the Benchmark or locating its solutions.
2. **Plan and create.** Fix 1–4 reusable Skills per Case. The same creator writes and revises them, then applies the current revision to a fresh practice output.
3. **Verify independently.** A separate verifier derives checks from public requirements and independent evidence. Run those checks on the practice output; retain actual results and distinguish failed assertions from broken tests or unsupported expectations.
4. **Refine.** Send observed failures to the same creator. Use `SELF-FIXABLE` for a repair supported by existing knowledge and `NEEDS-DR` for a gap needing targeted retrieval. Change the reusable Skill and execute it again; editing an answer alone is not refinement.
5. **Freeze.** Stop on virtual success or the declared budget. Retain the last valid revision, including its last-tested status, and collect the complete library and learning records.

Construction receives no target scores, private rubrics, hidden tests, reference solutions or prior evaluated answers. An available training judge is still target supervision: do not use it for OpenSkill feedback. Use the Benchmark's supported unscored practice environment. If the runtime cannot separate practice from official scoring, report that limitation rather than changing the method.

## Evaluate and report

After **all** construction Cases are frozen, create baseline and final States from the same saved base. Baseline is the pre-learning State; final adds the frozen library and its reader. Route a combined library by public applicability, never by target scores. Keep answers, practice outputs, virtual tests and learning history out of both States.

Follow [evaluation and reporting](references/evaluation.md). Test both States on the complete selected evaluation set three times by default, using a fresh environment and conversation for every case and repetition. Reuse the same frozen library; do not train three times. With a held-out Test package, construction uses Train only. Without one, keep the method's same-task setting explicit.

Report `baseline`, `final`, their `mean`, `std` and gain, plus versions, cost, time and token categories. Record virtual results and actual revisions as `curve_kind: virtual_validation`; they are not ground-truth Train scores. Keep intermediate labels in `native_stage`, and display progress as numbered `step` records.

Keep an index of active and completed jobs and their artifacts. Respect the shared container limit, including sidecars, and collect every requested result. Test feedback never reopens construction or changes the frozen library.
