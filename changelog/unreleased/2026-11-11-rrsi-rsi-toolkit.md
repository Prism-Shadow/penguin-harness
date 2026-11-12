# The RRSI toolkit regularises both ends of a round

- **Date:** 2026-11-11
- **Type:** feature
- **Scope:** `plugins`, `skills`, `docs`, `landing`
- **PR:** [#1535](https://github.com/Prism-Shadow/penguin-harness/pull/1535)

[中文版](2026-11-11-rrsi-rsi-toolkit.zh.md)

Added the RRSI RSI Toolkit, `rrsi-rsi-toolkit`, reproducing Regularized Recursive Self-Improvement of Agent Harnesses (Xia et al., 2026, [arXiv:2609.24972](https://arxiv.org/abs/2609.24972)). It is the tenth algorithm toolkit and, like the others, one Skill of the plugin's own name that carries its method and focused references rather than an executor of its own.

## What the round regularises

- The Proposer carries a cosine-annealed L0 edit budget: `b_t` shrinks over the round, so early proposals may bundle several independent changes and late ones almost none, and a stall sends the next proposal to components never exercised so far.
- The Critic screens a candidate before any measurement is spent. It looks for benchmark overfitting — a change that fits the labelled Train cases rather than the task — and rejects rather than ranks, so a rejected candidate costs no evaluation.
- The Pruner reports components whose recent best gain is non-positive as deletion targets.
- Algorithm 2 selected candidates using the calibrated score floor, policy-token cost and structural novelty, then retained the final accepted harness for held-out evaluation.
- Calibration followed the authors' repeated-baseline estimator and pooled-trial bootstrap fallback, using the same per-task trial count as candidate evaluation.
- Evaluation recorded policy tokens separately from dollar cost and followed the upstream missing-token convention.

## Editable harness

The toolkit supported target Agent State edits and isolated target-source edits. Each measured version retained its State snapshot and source/build record; source-mode evaluation used the candidate's CLI or install bundle. Proposers edited files with Penguin's native tools and returned their edit declarations as JSON.

## Packaging

The plugin declared its card, its one Skill and its icon in `src/index.ts`, compiled to `ifaces.json`. It was registered for server, CLI, desktop and landing packaging, in the bilingual plugin catalogs and in the website's algorithm list. Its evaluation reference added token usage and source/build binding; the shared-reference check remained on ACE, APE, AWM and OPRO.

The toolkit is self-contained: it creates the Target Agent's harness slot, evaluates its own cells and writes the Evaluation Center's scoreboard, so it runs with no other plugin installed. It carries a smoke demo task with its own Benchmark so a first round can be run end to end before a real Benchmark is chosen.
