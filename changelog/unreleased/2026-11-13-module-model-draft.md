# Draft module semantics in Lean

- **Date:** 2026-11-13
- **Type:** process
- **Scope:** `rfcs/formal`
- **PR:** [#1560](https://github.com/Prism-Shadow/penguin-harness/pull/1560)

[中文版](2026-11-13-module-model-draft.zh.md)

Added a Lean draft defining modules, passes and plugin selection, with explicit external type-check assumptions. The draft states laws for editing, final decoration, admission, plugin replay and termination; theorem proofs remain `sorry` for review.

Placed formal materials under `rfcs/formal/`, added declaration decorators with composition, locality and contract-preservation statements, and added a Typst paper in POPL/PACMPL format describing the mechanism, model, assumptions and proof boundary. RFCs state the design directly; formal materials cite the corresponding RFC sections.
