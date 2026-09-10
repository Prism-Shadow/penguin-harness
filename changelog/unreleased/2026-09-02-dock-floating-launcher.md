# A floating launcher for the right dock

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#586](https://github.com/Prism-Shadow/penguin-harness/pull/586)

[中文版](2026-09-02-dock-floating-launcher.zh.md)

The chat page gained an AssistiveTouch-style floating launcher for the right dock: while that
dock is hidden on a desktop-width window, a translucent round button rides the right edge of the
conversation body under a short caption, and a click fans its entries out on a semicircular arc
around it — one per dock panel plus a terminal, each showing its name — and picking one opens that
panel in the right dock, at which point the launcher goes away. The dock's panels had been
reachable only through the toolbar's toggle, which a user could fail to notice altogether.

## Details

- Resting: a 44px translucent circle with backdrop blur and a soft shadow, quiet until hovered or
  focused (a visible focus ring for keyboard users), showing the toolbar's right-pane glyph, with
  its name printed under it on the same glass — a bare glyph does not say what it opens, and the
  accessible name opens with that same word. It sits inside the chat body — between the toolbar and
  the composer — so neither it nor its caption ever covers either.
- Click, Enter or Space fans out round entries: every kind in `PANEL_KINDS` through the shared
  panel meta (a kind added later appears by itself), plus the terminal, which adopts a live shell
  no conversation holds or starts one, exactly like the dock picker. They land on a semicircular
  arc centred on the ball and opening leftward — from straight above it, through straight left, to
  straight below — spread evenly and in top-to-bottom order, each with its name shown beside it at
  all times (above or below at the arc's ends), so the visible name is the button's accessible name
  and nothing has to be hovered to be read. Near the body's top or bottom the arc trims to the span
  that still fits, keeping every entry and its name inside the conversation. Arrow keys walk the arc
  from top to bottom with the ball at the head of the sequence; Esc (refocusing the ball), a press
  elsewhere, or scrolling folds it.
- The pending-approval amber dot rides the ball — and the agents entry — under the same rule as the
  toolbar's right-dock toggle, and is named in the ball's accessible name.
- The ball drags along the edge with a small movement threshold, so a press stays a click; it
  rubberbands off the edge and past the body's ends and springs back on release. The position is
  one global preference, `penguin.dock.launcherY`, stored as a ratio of the chat body's height with
  a tolerant parse (anything unusable falls back to the centre).
- `prefers-reduced-motion` disables the spring and the fan's animations: instant show and hide.
- The decisions — visibility, clamping (which reserves the caption's height), the ratio round trip
  and its parse, drag bounds, and the arc's geometry and trimming — live in
  `features/dock/dock-launcher-state.ts` with unit tests
  (`test/dock-launcher-state.test.ts`). The Web App docs and the design spec describe the launcher.
