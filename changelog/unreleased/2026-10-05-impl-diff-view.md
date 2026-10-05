# A proposal's changes, file by file, on its page — and comments on them

- **Date:** 2026-10-05
- **Type:** feature
- **Scope:** `company-proposals`, `server`, `web`

[中文版](2026-10-05-impl-diff-view.zh.md)

The proposal page gave only `+N/−M` for an impl branch; to see what changed, a reviewer had to compare the branches on GitHub.

## Changes

- `GET …/proposals/:number/impl/changes[?w=1]` returns the impl branch's diff file by file — the merge base of base and head, up to head — with each file's path (and old path on a rename), status, added and deleted lines, binary flag and hunks. `w=1` ignores whitespace. The answer is read-only and cached by the head and base commits.
- The diff is read from the delivery repository's blobless mirror. The mirror still holds no file contents of its own accord: a diff fetches by id only the blobs of the paths it changes, in one bounded fetch, and writes no ref. A file over 512 KiB keeps its counts without hunks (`tooLarge`), and once the patch text reaches 4 MiB the remaining files keep their counts only (`diffLimit`).
- When the mirror cannot answer (not built yet, or a fetch fails), the diff is parsed from GitHub's comparison and marked `source: "github"` with the reason; that source lists at most 300 files, sends no patch for a binary or large file (`noPatch`), and cannot ignore whitespace.
- The proposal's detail carries the impl's `+N/−M` (`implStat`) without a click: the server computes it in the background from the same diff, cached by the head and base commits and checked again a minute after it was last read, and publishes an `impl_stat` plugin event when it changes, on which the page reads the detail again. Until it is known the page says it is counting; when it cannot be counted it says why.
- A click on `+N/−M` opens the diff view in a large dialog framed like Settings; closing it returns to the page where it was. The view: the changed files grouped by directory with status and counts (a click jumps to the file), each file's diff collapsible, a unified or split layout remembered per browser, and an ignore-whitespace toggle. Binary, too-large and capped files, and a diff from GitHub's comparison, each say so; loading, empty and error states offer a retry where one helps.
- A comment can be on a target as well as on a section's passage: a scope entry (by file and kind), a test entry (by file), a changed file, or a range of a changed file's lines (side, first and last line). `proposal.comment` takes a `target` param for these, checked strictly, and refuses with `400 comment_target` a target the current revision or the current diff does not have. A comment on the diff records the head and base commits it was written at and keeps the lines it was on; once a branch moves, the page marks it outdated and can still unfold those lines. Targeted comments are batched by request changes, reworded, withdrawn and resolved like any other, and an agent's `comments` text names each target.
- On the page, every scope and test entry and every file header in the diff has a comment button and its comment count; selecting lines in the diff (a click on a line number, then a Shift-click on another, or a drag across the code) offers **Comment on these lines**, and a file's line comments are listed under it.
- The comments table gains nullable target columns; an existing `company.db` gains them when opened. See [the compatibility notes](2026-10-04-backward-compatibility-notify-actions.md#the-old-shape-proposal_comments-without-target-columns).
