# Restore memory update cards in long conversations

- **Date:** 2026-10-14
- **Type:** fix
- **Scope:** `server`, `web`
- **PR:** [#1138](https://github.com/Prism-Shadow/penguin-harness/pull/1138)

[中文版](2026-10-14-memory-updates-pagination.zh.md)

Fixed missing memory update cards when a conversation loaded a history page that started after
its session metadata. History pages now carry the recorded Agent State directory so memory
edits appear when opening the conversation, loading older messages, and reconnecting.
