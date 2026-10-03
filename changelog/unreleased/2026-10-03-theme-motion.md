# A work group settled with a transition, the sidebar's switches moved instead of snapping, and every streaming text took one effect

- **Date:** 2026-10-03
- **Type:** feature
- **Scope:** `ui`, `web`, `ui-gallery`
- **PR:** [#966](https://github.com/Prism-Shadow/penguin-harness/pull/966)

[中文版](2026-10-03-theme-motion.zh.md)

A motion round followed theme round 3 ([2026-10-02-theme-defaults.md](2026-10-02-theme-defaults.md)): the owner found the switch from 运行中 to 运行完毕 abrupt, the sidebar's switches snapping, and the gallery's streaming specimens disagreeing with one another.

## Changes

- **Running to done:** when a work group or a harness row settled on screen, the label, mark and details eased into their settled ink over the theme's base duration; the settled glyph and the settled title arrived on the theme's reveal (Frost de-blurred them, Primer faded them in, Console showed them at once); and the open body folded away on the theme's layout motion instead of vanishing in one frame, so the reply below rose with it. Rows appended to an open group arrived on the same reveal. A transcript that loaded already settled moved nothing.
- **Sidebar:**
  - The selected row's fill eased in over 200 ms while the previous one left over 150 ms, and selection no longer changed the label's weight in Frost and Primer (Console kept its bold).
  - A nav entry that was pinned or unpinned surfaced in its new area on the theme's reveal, and a session list regrouped by workspace, Agent or time surfaced as one piece.
  - Session groups, the drafts group, lazy folders and the collapse area all folded through one shared fold. The collapse area folded away before it disappeared when its last entry was pinned.
  - The gallery's own navigation links changed colour alone: the current link kept the box of the others.
- **Streaming:** assistant replies, thinking text, compaction summaries and tool output streamed through one host, `StreamText`, so all four took the theme's pace, veil and caret. Tool output grew with the transcript while it streamed and took its height cap back once it finished. The gallery's Motion board and hooks page showed the real spinner, pulsing dot and streaming caret instead of hand-drawn copies, and the streaming board played the same script into a tool output beside the reply.
