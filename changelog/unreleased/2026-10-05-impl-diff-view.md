# A proposal's changes, file by file, on its page

- **Date:** 2026-10-05
- **Type:** feature
- **Scope:** `company-proposals`, `server`, `web`

[中文版](2026-10-05-impl-diff-view.zh.md)

The proposal page gave only `+N/−M` for an impl branch; to see what changed, a reviewer had to compare the branches on GitHub.

## Changes

- `GET …/proposals/:number/impl/changes[?w=1]` returns the impl branch's diff file by file — the merge base of base and head, up to head — with each file's path (and old path on a rename), status, added and deleted lines, binary flag and hunks. `w=1` ignores whitespace. The answer is read-only and cached by the head and base commits.
- The diff is read from the delivery repository's blobless mirror. The mirror still holds no file contents of its own accord: a diff fetches by id only the blobs of the paths it changes, in one bounded fetch, and writes no ref. A file over 512 KiB keeps its counts without hunks (`tooLarge`), and once the patch text reaches 4 MiB the remaining files keep their counts only (`diffLimit`).
- When the mirror cannot answer (not built yet, or a fetch fails), the diff is parsed from GitHub's comparison and marked `source: "github"` with the reason; that source lists at most 300 files, sends no patch for a binary or large file (`noPatch`), and cannot ignore whitespace.
- On the proposal page, **View diff** beside `+N/−M` opens the diff view: the changed files grouped by directory with status and counts (a click jumps to the file), each file's diff collapsible, a unified or split layout remembered per browser, and an ignore-whitespace toggle. Binary, too-large and capped files, and a diff from GitHub's comparison, each say so; loading, empty and error states offer a retry where one helps.
