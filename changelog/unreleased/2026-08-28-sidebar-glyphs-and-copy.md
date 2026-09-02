# The sidebar's marks say what they stand for

- **Date:** 2026-08-28
- **Type:** fix
- **Scope:** `web`
- **PR:** [#538](https://github.com/Prism-Shadow/penguin-harness/pull/538)

[中文版](2026-08-28-sidebar-glyphs-and-copy.zh.md)

Six small corrections in the sidebar, each one a mark or a label that named something other
than what it does.

## Details

- **Last conversation** (collapsed rail): a history mark — a clock read backwards — in place
  of the chat-lines-with-resume-arrow glyph. Deliberately not the bare clock the session
  list's "most recent" sort option wears: that one means "ordered by time", this one means
  "the conversation you were last in", and the returning arrow is what says so.
- **Agents** (nav row, and the "group by agent" option that shares the glyph): a robot head
  with ears, eyes and a smile, in place of the featureless dome. An Agent is the thing in
  this product a person talks to.
- **Model library** (nav row): a brain in place of the CPU chip. The page lists language
  models, not the hardware they run on.
- The new-chat page's **"Build and tune agents"** example folder wears that same Agent glyph
  by importing it, where it had been hand-copied as a literal — the copy was already out of
  step with the comment claiming the two were the same mark, and it is what a redrawn glyph
  silently leaves behind. (The import cycle the copy was justified by does not exist: the
  glyph lives in `components/ui/group-list.tsx`, which pulls in nothing from `features/`.)
- **Project settings → Members**: two people, in place of the Agent glyph the tab had
  borrowed. Members are humans.
- zh: the grouping option reads 「按智能体分组」, naming the surface it groups into exactly as
  the nav entry does, instead of 「按 Agent 分组」.
- The session row's **Remote control** action drops its trailing ellipsis, in both languages —
  the other actions in that menu carry none.
