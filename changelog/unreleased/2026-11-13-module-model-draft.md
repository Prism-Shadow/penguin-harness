# Module semantics and proofs in Lean

- **Date:** 2026-11-13
- **Type:** process
- **Scope:** `rfcs/formal`
- **PR:** [#1560](https://github.com/Prism-Shadow/penguin-harness/pull/1560)

[中文版](2026-11-13-module-model-draft.zh.md)

Added a Lean model of Module declarations, Operators, Passes, Plugin replay, and local HMR, with complete proofs and explicit external type-check assumptions. Basic laws are in `Basics.lean`; the main results are in `Proofs/Normalization.lean`, `Proofs/Plugin.lean`, and `Proofs/HMR.lean`.

Added the Typst paper *A Modular System with Hot Updates and Runtime Checking* in POPL/PACMPL format. Chapter 3 introduces semantics and basic properties; Chapter 4 develops deferred operator normalization, plugin reconfiguration with a Cordis 2026 comparison, and Hot Module Reload. The appendix contains the basic laws and proof arguments.

Added a Discussion of ordered error recovery and its selection limits, plus proposed producer/consumer contract tests at the hot-update handshake alongside implemented runtime type checks. Clarified the relation to Cordis's recovery exactness and confluence results.

Formalized compilation steps and failed-attempt histories, including counterexamples to output-only undo and DI-only impact analysis. Added an HMR protocol for verified plans, transitive retention of generation, Task, resource, and recovery code, degraded recovery state, and token-guarded cleanup. The paper identifies the remaining TypeScript refinement obligations and excludes package transport.

Defined the formalization scope as declaration operations, Plugin replay, and local Module/Plugin updates. The HMR abstraction represents tasks by generation references and parked snapshots by opaque tokens.

Unified declaration transformations under Operator and standardized upright sans-serif operation names, curried types, complete calls, and partial applications. Formal materials cite the governing RFCs and distinguish operation types from final Module validity.
