# The collapsed rail's last-conversation entry wears a history mark

- **Date:** 2026-08-28
- **Type:** fix
- **Scope:** `web`
- **PR:** [#538](https://github.com/Prism-Shadow/penguin-harness/pull/538)

[中文版](2026-08-28-rail-last-conversation-icon.zh.md)

The collapsed sidebar rail's "Last conversation" entry now shows a history mark — a clock
read backwards — in place of the chat-lines-with-resume-arrow glyph it had.

## Details

- The mark is deliberately not the bare clock the session list's "most recent" sort option
  wears: that one means "ordered by time", this one means "the conversation you were last
  in", and the returning arrow is what says so.
- Tooltip, accessible name, active state and the disabled look are unchanged.
