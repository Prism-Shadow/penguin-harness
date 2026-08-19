# Thinking-level labels split by surface, and a summarize compaction drops its outcome notice

- **Date:** 2026-08-19
- **Type:** fix
- **Scope:** `web`

[中文版](2026-08-19-thinking-label-and-compaction-notice.zh.md)

Two corrections to what the chat UI prints. The Chinese thinking-level label stopped carrying the wire value on every surface and now carries it only where a tier is picked, and a completed `summarize` compaction stopped restating what the row's own expandable body already shows.

## Thinking-level labels

- `S.chat.thinkingLevelNames` became the plain tier name: zh reads 低 / 中 / 高 / 极高 / 最高, plus 无 for a stored legacy `none`; en keeps the wire value that has always been its name. Every surface showing a level that is already chosen reads it — the composer picker's trigger and tooltip in the draft and active-session controls alike, the mid-chat switch dialog and its toasts, and the Project chat-defaults control and its read-only row.
- `S.chat.thinkingLevelMenuName` composes the dropdown-row variant, appending the wire value the pick will send (`极高 (xhigh)`). The composer's own dropdown is its only caller: the Project chat-defaults control is a native `<select>`, which paints the picked option's own text onto the collapsed control, so annotating its rows would land the wire value back on a trigger.
- English gained no split. Its tier name already is the wire value, so `thinkingLevelMenuName` takes just the name and returns it unchanged instead of duplicating the table.
- A drift guard walks core's `DEFAULT_CHAT_THINKING_LEVELS` against both real dictionaries — previously the web tests only exercised a hand-written stub: every tier is named in both locales, no zh name carries latin letters or parentheses, and the menu variant carries the wire value.

## Compaction row

- A completed `summarize` compaction renders no outcome text at all: `compactionDone` returns undefined for that mode and `StepBanner` omits the detail slot, leaving the status icon, the title, the wall time, and the chevron that opens the summary itself.
- A `discard` compaction kept its notice — 已丢弃旧上下文 / "old context discarded" — the one outcome the row cannot show any other way, since that mode writes no summary body to expand.
