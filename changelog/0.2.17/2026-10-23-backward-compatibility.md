# Data compatibility

- **Date:** 2026-10-23
- **Type:** feature
- **Scope:** `core`, `server`, `web`
- **PR:** [#1299](https://github.com/Prism-Shadow/penguin-harness/pull/1299)

[中文版](2026-10-23-backward-compatibility.zh.md)

## Traces without Task records

Traces written before [the Task records](2026-10-23-trace-task-pair.md) carry no `task_begin` / `task_end`. Readers derive the Task boundaries of those Traces from the user's prompts, as they did before: a Task starts at a main-session user prompt (a prompt carrying only origin blocks and a goal round's re-sent input included) and runs until the next one, and how it ended is read from the records it holds.

The choice between the two readings is positional. A reader derives the boundaries up to the first Task record in a Session's sequence of records and reads the records from there on, so a Session resumed after the upgrade is read in two parts within the same file. A reader that reads one file alone takes that file's first Task record as the boundary.

### Scope

The readers that answer "where does a Task start": core's resume replay, which decides whether a file was closed by a compaction; the server's message window and Trace analysis; the Web App's chat stream model and outline. In this release they all still derive the boundaries, and ignore or place the new records without reading them as boundaries. A reader that comes to prefer the records keeps the derivation for the part before the first one.

### What you need to do

Nothing. No Trace is migrated or rewritten, and old Traces read as before.

### Lifetime

The fallback does not expire with a release: a Trace is the truth on disk and can be imported from another installation. It stays until the user decides that Traces without Task records no longer need to be readable, for example by setting a minimum readable Trace version or after a one-time rewrite of the old Traces. The maintainers of the readers listed under Scope then remove the derivation together, in one change.
