# Keep deep-linked Sessions inside their Project

- **Date:** 2026-08-24
- **Type:** fix
- **Scope:** `web`
- **PR:** [#435](https://github.com/Prism-Shadow/penguin-harness/pull/435)

[中文版](2026-08-24-project-session-isolation.zh.md)

The Web App rejected a deep-linked Session when it belonged to a different Project instead of inserting it into the current Project's conversation list.

## Details

- Scoped direct Session lookup results to the currently selected Project.
- Scoped failed deep-link probes by both Project and Session so a Project switch could not reuse stale probe state.
