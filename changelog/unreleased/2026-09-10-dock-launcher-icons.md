# The workbench launcher's shortcuts got redrawn, and its ball answers the pointer

- **Date:** 2026-09-10
- **Type:** feature
- **Scope:** `web`
- **PR:** [#680](https://github.com/Prism-Shadow/penguin-harness/pull/680)

[中文版](2026-09-10-dock-launcher-icons.zh.md)

The floating launcher's ball now answers what the pointer is on. Pointing at the ball itself turns
its four workbench tiles into an expand mark and changes the caption under it to "Open"; pointing
at one of the fanned-out entries puts that entry's own glyph in the ball, beside the name the
caption already read out. Keyboard focus drives both exactly as the pointer does, and a fan merely
standing open with nothing pointed at leaves the ball on its resting mark.

## Details

Five marks were redrawn, in the one table the launcher fan, the dock's panel picker, its add menu
and its tab strip all read from, so each moved on all four surfaces at once:

- **Subagents** — two robot heads, a large one above-left and a small one below-right, in place of
  the three-circle spawn tree. It is the Agent's own robot head, twice.
- **Memory** — a brain with its stem, in place of the open book. The Memory panel and the
  memory-changes card had each carried their own hand-typed copy of the book; the brain is drawn
  once, in `components/ui/icons.tsx`, and both surfaces import it.
- **Trace observation** — an open eye, in place of three stacked lines.
- **Remote control** — the paper plane a session row already flies while it is relaying, in place
  of a chat bubble, so one feature wears one mark. The bubble had no other caller and was deleted.
- **Hide launcher** — the same eye struck through corner to corner, in place of the close cross.

The Workspace folder, the scheduled-tasks alarm clock, the terminal prompt and the ball's resting
workbench tiles are unchanged.

## The sidebar's Models mark

The Models library in the sidebar nav and the collapsed rail had been drawing a brain of its own,
which the Memory brain would have sat beside as a near-duplicate: at the sizes those rows render,
both reduce to a round outline with a vertical line through it. Models is now a cube — one model,
as a discrete thing picked off a shelf. It is deliberately not the stack of plates a library would
otherwise suggest, because Machines is the next nav row down and is already two stacked server
units.

The agent cards' memory-count stat had a third hand-typed brain, with an inner fold that does not
survive the 13px it renders at. It now draws the one `MEMORY_ICON` along with every other Memory
surface.
