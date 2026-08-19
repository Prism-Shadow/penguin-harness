# Thinking-level labels split by surface, and the compaction row names its mode

- **Date:** 2026-08-19
- **Type:** fix
- **Scope:** `web`
- **PR:** [#340](https://github.com/Prism-Shadow/penguin-harness/pull/340)

[中文版](2026-08-19-thinking-label-and-compaction-notice.zh.md)

Two corrections to what the chat UI prints. The Chinese thinking-level label stopped carrying the wire value on every surface and now carries it only where a tier is picked, and the compaction step row started naming what it actually did — a step that clears the context is no longer announced as compaction — which left neither mode with an outcome line to write.

## Thinking-level labels

- `S.chat.thinkingLevelNames` became the plain tier name: zh reads 低 / 中 / 高 / 极高 / 最高, plus 无 for a stored legacy `none`; en keeps the wire value that has always been its name. Every surface showing a level that is already chosen reads it — the composer picker's trigger and tooltip in the draft and active-session controls alike, the mid-chat switch dialog and its toasts, and the Project chat-defaults control and its read-only row.
- `S.chat.thinkingLevelMenuName` composes the dropdown-row variant, appending the wire value the pick will send (`极高 (xhigh)`). The composer's own dropdown is its only caller: the Project chat-defaults control is a native `<select>`, which paints the picked option's own text onto the collapsed control, so annotating its rows would land the wire value back on a trigger.
- English gained no split. Its tier name already is the wire value, so `thinkingLevelMenuName` takes just the name and returns it unchanged instead of duplicating the table.
- A drift guard walks core's `DEFAULT_CHAT_THINKING_LEVELS` against both real dictionaries — previously the web tests only exercised a hand-written stub: every tier is named in both locales, no zh name carries latin letters or parentheses, and the menu variant carries the wire value.

## Compaction row

- The row's title names its mode. A `summarize` step stays 压缩 / "Compaction"; a `discard` step became 清空 / "Clear", because it drops the old context rather than compacting it, and labelling that compaction was the confusing part.
- With the mode in the title, a settled row writes no outcome text in either mode: it renders as status icon, title and wall time, plus — on a `summarize` — the chevron that opens the adopted summary. The `已丢弃旧上下文` / "old context discarded" strings and the `compactionDone` helper that chose between them were deleted from both catalogs.
- The running row stopped repeating the mode as a raw `summarize` / `discard` in its detail slot; that was the untranslated wire value, and the title carries it now.
- A failed or aborted compaction still states why, in both modes: the reason is the one thing the title cannot carry.
