# Session links remember the machine they name

- **Date:** 2026-09-30
- **Type:** fix
- **Scope:** `web`
- **PR:** [Myriad-Dreamin/penguin-harness#107](https://github.com/Myriad-Dreamin/penguin-harness/pull/107)

[中文版](2026-09-30-claude-code-open-and-idle.zh.md)

A link to a Session the app has not listed can name its machine with `/chat/<session>?machine=<id>`. The chat page records that hint before looking the Session up, so it asks the right machine instead of falling back to a personal conversation on this server. What the app learned from its own lists still wins.
