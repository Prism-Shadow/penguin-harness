# A runtime invalidation no longer discards a Session's queued follow-ups

- **Date:** 2026-10-22
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1269](https://github.com/Prism-Shadow/penguin-harness/pull/1269)

[中文版](2026-10-22-ensure-entry-queued-follow-ups.zh.md)

When a Project's models or credentials change, `invalidateAgentRuntimes` bumps the config
generation so every cached runtime is rebuilt on its next access. A runtime entry carrying
queued follow-ups could be discarded as stale once its run reached idle — before the queued
inputs had a chance to start — silently dropping every input the user was told was queued.

## Details

- Queued follow-ups live only on the runtime entry: `sweepIdle` already refuses to evict an
  entry whose queue is non-empty for exactly this reason. The discard-on-stale path in
  `ensureEntry` now applies the same rule: an entry whose queue is non-empty is returned
  as-is (like a busy entry), and is rebuilt on the first access after the queue drains.
- The runtime is therefore rebuilt with the new Project config once the queue has drained,
  unchanged from before; the only difference is that nothing queued is lost in between.
- A test pins the auto-start of queued follow-ups to hold the entry in the exact state the
  discard path used to mishandle (idle, stale, non-empty queue) and verifies red/green: on
  the old code the queued input is lost and the queue drains through a rebuilt runtime;
  with the fix the kept entry starts it and the rebuild happens only after the queue has
  drained.
