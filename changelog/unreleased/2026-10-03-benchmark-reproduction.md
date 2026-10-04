# Reproduce benchmarks on demand

- **Date:** 2026-10-03
- **Type:** feature
- **Scope:** `skills`, `docs`

[中文版](2026-10-03-benchmark-reproduction.zh.md)

Added `benchmark-reproduction` to Agent Tuning. It imports an existing benchmark
from a repository or local checkout, preserves its evaluation protocol, verifies
smoke runs and Evaluation Center visibility, then asks before a full evaluation.

## Details

- Added reference-based, generic and custom construction routes, with a GDPevo
  recipe recording environment and grader compatibility lessons.
- Mapped official splits to train/test benchmarks and continuous tasks to identical
  definitions with explicit time/trial boundaries and state handoff.
- Taught Agent Evaluation to follow a benchmark's own Runtime instructions without
  benchmark-specific platform code. Datasets and adapters are created on demand.
- Rebuilt the RSI work on current main without the earlier bundled GDPevo data,
  default provisioning or Python runtime. Existing user data is not deleted.
