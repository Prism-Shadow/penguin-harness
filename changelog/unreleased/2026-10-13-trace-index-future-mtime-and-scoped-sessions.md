# Trace index: future mtimes no longer wedge the gate; trace_sessions keyed per Agent

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `trace-index`, `server`
- **Issue:** [#301](https://github.com/Prism-Shadow/penguin-harness/issues/301)

[中文版](2026-10-13-trace-index-future-mtime-and-scoped-sessions.zh.md)

Two of the Trace-index defects reported in #301 are fixed: a date directory whose mtime lies in the future no longer forces a full index re-scan on every request, and the `trace_sessions` facts cache can no longer be rewritten or removed across Agent boundaries. The transient-filesystem-error handling (the report's slice 2) is unchanged.

## Details

- `cacheable` (the mtime-gate contract shared by every derived cache) treated a future mtime as *young*: a negative age is never past the freshness window, so the directory was cached as the never-matching sentinel, the gate missed on every request, and each pass re-cached the sentinel — a wedge that no quiet period or restart settles. A future mtime is now cached as its real value: it is not unstable, merely wrong, and any real change moves the mtime off the cached one, so the gate still notices.
- `trace_sessions` is keyed by `(project_id, agent_id, session_id)` instead of `session_id` alone. The same session id under two Agents of a Project is two conversations: one Agent's Trace import no longer rewrites the other's facts row, and one Agent's Session delete no longer removes the other's index rows while its files stay on disk. `getSession` / `deleteBySession` take the owning Agent's scope, which every call site already had.
- Migration 17 (`trace-sessions-agent-scoped-key`) rebuilds the table under the widened key. The rows are a derived cache and the old shape held at most one row per session id, so the rebuild keeps every row; the superseded `idx_trace_sessions_agent` index is dropped (the key's prefix covers it).

## Compatibility

- Migration 17 reshapes a table, so it is restart-only: a pushed platform boot refuses with `RestartRequiredError` until the runtime has opened the database once. Rolling back past it keeps only the first row per session id — the Agent-scoped siblings the widened key admitted are lost.
