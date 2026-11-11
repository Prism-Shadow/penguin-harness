# The RRSI toolkit regularises both ends of a round

- **Date:** 2026-11-11
- **Type:** feature
- **Scope:** `plugins`, `skills`, `docs`, `landing`

[中文版](2026-11-11-rrsi-rsi-toolkit.zh.md)

Added the RRSI RSI Toolkit, `rrsi-rsi-toolkit`, reproducing Regularized Recursive Self-Improvement of Agent Harnesses (Xia et al., 2026, [arXiv:2609.24972](https://arxiv.org/abs/2609.24972)). It is the tenth algorithm toolkit and, like the others, one Skill of the plugin's own name that carries its method and focused references rather than an executor of its own.

## What the round regularises

- The Proposer carries a cosine-annealed L0 edit budget: `b_t` shrinks over the round, so early proposals may bundle several independent changes and late ones almost none, and a stall sends the next proposal to components never exercised so far.
- The Critic screens a candidate before any measurement is spent. It looks for benchmark overfitting — a change that fits the labelled Train cases rather than the task — and rejects rather than ranks, so a rejected candidate costs no evaluation.
- The Pruner reports components whose recent best gain is non-positive as deletion targets.
- Algorithm 2 admits a candidate only past a calibrated noise floor, so a gain inside the measured noise band is not a gain, and under a token-cost rule, so a candidate that buys score with a larger context pays for it.

## Packaging

The plugin declares its card, its one Skill and its icon in `src/index.ts`; `ifaces.json` is built from that. It is registered for core, CLI, desktop and landing packaging, in the bilingual plugin catalogs and in the website's algorithm list, and its Skill passes the frontmatter checks every shipped Skill passes. It ships `references/evaluation.md` byte-identical to ACE, APE, AWM and OPRO, pinned by the test in `packages/server/test/plugin-library.test.ts`.

The toolkit is self-contained: it creates the Target Agent's harness slot, evaluates its own cells and writes the Evaluation Center's scoreboard, so it runs with no other plugin installed. It carries a smoke demo task with its own Benchmark so a first round can be run end to end before a real Benchmark is chosen.
