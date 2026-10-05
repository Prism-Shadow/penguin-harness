# Choose benchmarks and RSI methods in conversation

- **Date:** 2026-10-05
- **Type:** feature
- **Scope:** `skills`, `web`, `docs`

[中文版](2026-10-05-agent-tuning-selection.zh.md)

Added separate conversation entries for benchmark reproduction and RSI method
selection, preserving the existing optimization form and baseline display.

## Details

- Asked for a benchmark or method when none was specified, showing identifiers,
  full paper titles and arXiv/GitHub links. Reused choices already made in the task.
- Required agreement before applying the generic reproduction workflow to an
  unmatched benchmark, without substituting the example dataset.
- Passed the selected method into initialization; the new method-selection entry
  carries task identity and Focus without the existing form's Penguin defaults.
- Kept the new buttons, request assembly and bilingual copy in separate files,
  with small additions at the existing page and dictionary entry points.
- Recorded source links, revisions and loaded reference versions/hashes in
  reproduction and experiment records, leaving absent historical fields unset.
- Updated the English and Chinese usage instructions.
