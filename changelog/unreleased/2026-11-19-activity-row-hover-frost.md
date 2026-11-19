# Frost keeps the mark that says why a compaction has no full summary

- **Date:** 2026-11-19
- **Type:** fix
- **Scope:** `ui`, `web`

[中文版](2026-11-19-activity-row-hover-frost.zh.md)

Frost draws no status marks on activity rows, so a **Compacted** row that wrote no full summary
hid the one mark whose tooltip says why. That mark now stays in Frost. Doodle already showed it;
in Console, on a row that folds, it now sits after the fold marker instead of giving way to it.

## Details

- `ActivityGroup` takes `attention`: a settled activity whose `mark` needs the reader's attention.
  The head carries `data-attention`. Frost's rule that hides status marks, and Console's rule that
  swaps a settled mark for the fold marker, both leave such a row's mark in place.
- The compaction row passes it when the compaction completed without a full summary. Other rows
  read as before in every theme.
