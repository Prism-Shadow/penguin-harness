# Added OPRO and APE method recipes

- **Date:** 2026-10-05
- **Type:** feature
- **Scope:** `skills`

[中文版](2026-10-05-opro-ape-methods.zh.md)

Added OPRO and non-iterative APE to Agent Tuning's method directory, with separate
initialization and optimization references, paper titles and source links.

## Details

- Defined OPRO's instruction generation from measured instruction/score history
  and final selection by training score.
- Defined APE's fixed candidate generation from authorized input/output examples,
  execution scoring and final candidate selection.
- Defined fixed prompt readers, candidate snapshots, independent testing,
  proposal budgets and method-specific source adaptations.
- Preserved existing methods, execution interfaces and Web entry points.
