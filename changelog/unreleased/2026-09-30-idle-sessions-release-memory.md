# Idle sessions are released for real, and a model or hooks save no longer strands a running dev server

- **Date:** 2026-09-30
- **Type:** fix
- **Scope:** `server`

[中文版](2026-09-30-idle-sessions-release-memory.zh.md)

The server drops a Session's runtime from memory in two cases: it has been idle for 30 minutes, or it was built before the last change to its Agent's config, hooks, plugins or the Project's models and is touched again. Both now dispose the runtime they drop. Before this, the runtime's background registries stayed in core's process-wide list, and through them the whole conversation history stayed reachable, so an evicted Session was never freed.

Neither path drops a Session that still has background work: a running background command, a background subagent still working, or a completion notice not yet delivered. The idle sweep already skipped those. The stale-config path did not, and that path runs after every save of an Agent's config, hooks or plugins, or of a Project's models. The save used to lose track of a running dev server: the process kept running, but the stop control no longer listed it. Now such a Session keeps its runtime, with the old values, until that work is over, and is rebuilt on the next access after that.
