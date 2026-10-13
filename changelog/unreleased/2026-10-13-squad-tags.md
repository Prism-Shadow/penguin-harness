# Squad tags: a subagent names the work group it belongs to

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `core`, `server`, `cli`, `docs`

[中文版](2026-10-13-squad-tags.zh.md)

A leader that fans a task out to several `run_subagent` children has no way to say that they are one piece of work — and nothing that reads the Trace can group them, because the only thing tying them together is the prompt that spawned them. This adds a label to say it.

## The tag

- **`run_subagent` takes `squad`**: a short free-text label (1–64 characters), validated where the other spawn arguments are — an empty, over-long or non-string value fails loudly rather than recording a junk tag, and JSON `null` counts as omitted, like a missing key.
- **The label is recorded on the child's `session_meta`** (`squad`), beside `source` and the model reference. The spawn site passes it through: `SubagentSpawnOptions.squad` (core) → `Agent.createSession` → the meta the child writes when it first runs. Absent = no squad, and the key is then not written at all.
- **Nothing parses a prompt to find it.** Cost attribution and parentage read the recorded field, so a squad survives a re-read of the Trace by anything that only has the file.

## Reading it back

- **The session list exposes `parentSessionId` and `squad`** on `SessionInfo`, read straight from the index row: `parent_session_id` is written at subagent registration (the origin chain's second-to-last hop when nested, else the Session that drove the spawn) and `squad` from the child's `session_meta`. Both are absent for top-level and legacy rows.
- **`cost --by squad`** groups usage by the tag of the origin child Session (`GROUP BY` on a scalar subquery over `usage_records.origin_session_id`, so a leader's own tokens stay out of every bucket). Rows whose origin has no tag land in `(none)`.
- The same dimension is available over HTTP (`GET /usage?groupBy=squad`).

## Compatibility

Both columns are added on open (`ensureColumn`), so an existing `web.db` gains them without a migration step and with no backfill: rows written before this change read as top-level and untagged, which is what they are.
