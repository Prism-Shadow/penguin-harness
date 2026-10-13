# Squad rows show their work group and parent in the sidebar

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `web`, `ui`
- **PR:** [#1078](https://github.com/Prism-Shadow/penguin-harness/pull/1078)

[中文版](2026-10-13-squad-row-mark.zh.md)

A Session spawned with a `squad` tag carries a users mark in the sidebar row's dim cluster, beside the marks that already say where a row came from. Its tooltip names the work group, and the short parent id where parentage is known — so a fan-out is recognizable as one piece of work from the list itself, without opening the children.

## Details

- `SessionRow` gains the `squadGlyph` / `squadLabel` slots, drawn as a `RowMark` right after the source mark; either half alone draws nothing, so a caller that knows only one of them shows no half-mark.
- `squadMark()` in `lib/session-source-mark.ts` builds it out of a list row: the tag, and the last six characters of `parentSessionId` when that names a different Session. Archived rows stay unmarked, like every other provenance mark, and an untagged row draws nothing new.
- The tooltip is bilingual (`S.chat.squadSession`).
