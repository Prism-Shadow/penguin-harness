# The collapsed rail's last-conversation entry wears a clock

- **Date:** 2026-08-28
- **Type:** fix
- **Scope:** `web`
- **PR:** [#538](https://github.com/Prism-Shadow/penguin-harness/pull/538)

[中文版](2026-08-28-rail-last-conversation-clock.zh.md)

The collapsed sidebar rail's "Last conversation" entry now shows a clock — the glyph the
session list's "most recent" sort option already wears — in place of the chat-lines-with-resume-arrow
mark it had.

## Details

- The rail entry and the sort option share one exported glyph, so recency is one mark on both
  surfaces; the rail-only path constant was removed.
- Tooltip, accessible name, active state and the disabled look are unchanged.
