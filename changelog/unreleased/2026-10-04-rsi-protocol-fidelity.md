# Aligned RSI recipes with their source protocols

- **Date:** 2026-10-04
- **Type:** fix
- **Scope:** `skills`, `docs`, `web`

[中文版](2026-10-04-rsi-protocol-fidelity.zh.md)

Aligned ACE and AWM training recipes and GDPevo reporting with pinned primary
sources, and separated method training executions from supervision recovery.

## Details

- Restored ACE's per-sample reflection/regeneration, curation and post-curation
  sequence, with source defaults, counter semantics and explicit optional pruning.
- Separated canonical offline AWM from the sequential online mechanism applied
  to training, with complete workflow loading and a frozen independent test phase.
- Specified GDPevo source staging and three independent replicas with per-task
  population standard deviation; kept prompted recovery scores separate.
- Clarified evaluator transport, training-only feedback, task duration, rollback
  and final snapshot handoff; updated the design and literature summaries.
- Aligned Evaluation Center task prompts with matrix control and method-specific
  policies, and kept recovery/penalty results outside baseline scoreboards.
- Assigned companion cleanup after parent loss and initialized memory scaffolding
  before freezing new Target States.
- Aligned evaluation scratch paths with Penguin's system prompt and required
  Supervisors to resolve instruction priority before judging access.
- Prevented diagnostic-runtime caches from mutating shared frozen benchmark files.
- Scoped feedback visibility to the receiving role and phase, so training
  restrictions do not suppress authorized independent test results.
