# Skill archive caps are enforced before the zip inflates

- **Date:** 2026-09-03
- **Type:** fix
- **Scope:** `server`
- **PR:** [#601](https://github.com/Prism-Shadow/penguin-harness/pull/601)

[中文版](2026-09-03-skill-archive-inflation-bounds.zh.md)

`POST /api/projects/:p/agents/:a/skills/archive` applied its 200-file, 5MB-per-file and 20MB-total caps to the entries `unzipSync` had already returned. `unzipSync` allocates a buffer of each entry's declared uncompressed size and inflates into it, so caps read off the result bound nothing: the 14MB the route accepts is enough compressed zeros to declare about 14GB, and an entry whose header overstates its size hands back a short view onto a buffer of the declared length — which passed every check and installed.

## Details

- `unzipBounded` (`services/skill-import-limits.ts`) wraps `unzipSync` with a `filter` that enforces the three caps from the central directory, before an entry inflates. The archive route calls it in place of `unzipSync`, and its after-the-fact byte and count checks are gone. Status codes and messages are unchanged: the same 400s, with the same text.
- Bounding against the declared sizes is exact in both directions — fflate inflates into a buffer of exactly that size and never grows it, so an entry can only ever yield fewer bytes than it claimed.
- A file entry named exactly like the archive's single top-level directory left an empty path once the prefix came off, and the write landed on the Skill directory itself; that `EISDIR` surfaced as a 500 with an unhandled-exception log line, and is now a 400 like the other rejected entry paths.
