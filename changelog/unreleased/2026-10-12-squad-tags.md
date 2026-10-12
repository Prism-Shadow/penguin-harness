# Subagents carry a squad tag; lists expose parentage; cost groups by squad

- **Date:** 2026-10-12
- **Type:** feat
- **Scope:** `core`, `server`, `cli`, `docs`
- **PR:** [#1035](https://github.com/Prism-Shadow/penguin-harness/pull/1035)

[中文版](2026-10-12-squad-tags.zh.md)

`run_subagent` takes an optional `squad` label (1–64 chars). It is recorded on the
child Session's `session_meta`, so grouping never depends on parsing the spawn prompt.

## Details

- The session list exposes `parentSessionId` (the spawner, read straight from the
  index row) and `squad` on every spawned row; top-level and legacy rows omit both.
- `cost --by squad` groups Token usage by the origin child Session's tag. Rows with
  no squad-bearing origin land in `(none)`, so a leader's own Tokens stay out of
  every squad bucket.
- An invalid `squad` argument fails loudly at the tool call instead of recording
  a junk tag.
- New index columns (`sessions.parent_session_id`, `sessions.squad`) are added with
  the usual open-time upgrade, so existing databases pick them up on restart.
