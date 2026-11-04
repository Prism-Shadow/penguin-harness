# Zip imports hold directory entries to the archive caps

- **Date:** 2026-11-03
- **Type:** fix
- **Scope:** `server`, `docs`
- **PR:** [#1450](https://github.com/Prism-Shadow/penguin-harness/pull/1450)

[中文版](2026-11-03-zip-directory-entry-caps.zh.md)

A zip entry whose name ends in `/` no longer got past the archive caps. The Skill, plugin and Benchmark imports had counted and size-checked file entries only, while fflate still inflated whatever bytes a directory entry held: the Skills archive route accepted a 262 KB zip whose directory entry inflated to 256 MB, so the 14 MB upload cap let one request allocate about 14 GB.

## Details

- Every entry, directories included, counted towards the archive's entry limit (200 for a Skill or a hook package, 1,000 for a Benchmark, 2,000 for a plugin), and its declared size towards the per-file and total caps. Both were read off the central directory before anything inflated, so the request above was refused with 400 naming the entry.
- A directory entry within the caps was never inflated and was left out of what the import read. The hook import, which had already skipped directory entries without inflating them, counted them and checked their sizes the same way.
- The refusal over the count named an entry limit, with directories counted, instead of a file limit, and the Skills, Evaluation Center and server API docs gave the counts as entries.
