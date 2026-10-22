# GEPA joined the RSI toolkits as `gepa-rsi-toolkit`

- **Date:** 2026-10-22
- **Type:** feature
- **Scope:** `plugins`, `core`, `docs`, `landing`, `ui-gallery`
- **PR:** [#1277](https://github.com/Prism-Shadow/penguin-harness/pull/1277)

[中文版](2026-10-22-gepa-rsi-toolkit.zh.md)

A sixth RSI toolkit, `gepa-rsi-toolkit` (GEPA RSI Toolkit, category `rsi`, preinstalled), joined the plugin library. Its one Skill, `gepa-rsi-toolkit` (`2026.10.22.1`), ran GEPA ([Agrawal et al., 2025](https://arxiv.org/abs/2507.19457)) against `gepa-ai/gepa` at `8f287de942f41a6d1e0e7e5b2d576247c4bedee9`, with `optimize`'s defaults on a system of one instruction: a parent drawn from the per-case Pareto front, a minibatch of 3 feedback cases, a reflection model that read the parent's Traces and scores and wrote a new instruction, admission only on a strictly higher minibatch total, a full measurement of every admitted child, and the best average kept. The Optimize tab's **Method** field offered it with no Web App change, since that list is read from the library's `rsi` category.

## Details

- **Slot.** Initialization added `skills/gepa-instruction/` to the Target, holding `instruction.md` (the user's seed, else empty) and a fixed reader line in `AGENTS.md`, the shape the OPRO and APE toolkits use.
- **Sets.** `benchmark_id` gave the feedback cases the reflection model reads. An optional `pareto_benchmark_id` gave the Pareto cases every pool member is measured and selected on; without it, the two were the same cases, as `optimize` does with no `valset`. An optional `test_benchmark_id` was measured only after selection.
- **Draws.** `scripts/draw.py` (Python 3, standard library only) drew every parent and minibatch from one `random.Random(0)` stream, in the source's order, and kept that stream's state in the run's output directory so that a resumed Session continued it. Checked against the source's `select_program_candidate_from_pareto_front` and `EpochShuffledBatchSampler` on randomized pools, it drew the same parents and minibatches.
- **Prompt.** The reflection prompt was `InstructionProposalSignature.default_prompt_template` verbatim, with each minibatch execution rendered as the source renders a record (`Inputs`, `Generated Outputs`, `Feedback`), and the reply parsed as `ProposalAdapter.parse` does.
- **Budget.** Every Target execution counted toward `max_metric_calls`, checked before each iteration as the source checks it. The smoke default was the seed's measurement plus four iterations that admit nothing.
- **Declared adaptations.** The feedback was the Rubric score alone, since the Rubric is private; the reflection model read each execution's Trace and Workspace by path; scores were on `0..100`, so `perfect_score` was 100; Merge did not run, since with one instruction it reproduces a parent.
- **Evaluation.** The toolkit carried the same byte-identical `references/evaluation.md` as the other algorithm toolkits.
- **Packages.** `core`, `cli` and `desktop` depended on `@penguinharness/gepa-rsi-toolkit`. The landing page's algorithm row, the README tables, Skills & Plugins, Self-Improvement, Evaluation Center, the component gallery's plugin library and the Web App's skills end-to-end test listed it.
