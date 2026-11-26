# Address a subagent by its Session ID

- **Date:** 2026-11-23
- **Type:** feature
- **Scope:** `core`, `server`, `web`
- **PR:** [#1766](https://github.com/Prism-Shadow/penguin-harness/pull/1766)

[中文版](2026-11-23-subagent-session-addresses.zh.md)

A delegation returns the child’s Session ID and its short form. Use the full ID or a unique suffix of at least eight characters to message or stop that child from another authorized conversation in the same Project on the same machine. Archived children keep their addresses after reconnecting or restarting the server. Stop ends the chosen child’s current run. The Agent panel can copy its full Session ID.
