# A floating shortcuts launcher

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#586](https://github.com/Prism-Shadow/penguin-harness/pull/586)

[中文版](2026-09-02-dock-floating-launcher.zh.md)

The chat page gained an AssistiveTouch-style floating launcher for the workbench: while no dock
surface is up, a translucent round button floats just inside the right edge of the conversation
body under a short "Shortcuts" caption, and a click fans its entries out on a tight
semicircular ring around it — one per dock panel plus a terminal, glyphs alone, their names read
out by that same caption — and picking one opens that panel, at which point the launcher goes
away. The workbench's panels had been reachable only through the toolbar's toggle, which a user
could fail to notice altogether — on a phone most of all. The arc's last entry puts the launcher
away for good, and an Appearance setting brings it back.

## Details

- Shows while the room it stands in for is free: on a desktop-width window that is the right dock
  being hidden; below the breakpoint, where the two docks render as one merged bottom surface, it
  is neither dock being open. Narrow layouts used to have no launcher at all.
- Resting: a 44px translucent circle with backdrop blur and a soft shadow, quiet until hovered or
  focused (a visible focus ring for keyboard users), showing a workbench glyph — a dashboard of
  four tiles — with its name printed under it on the same glass: a bare glyph does not say what it
  opens, and the ball's accessible name is that same word. It rests 32px in from the body's right
  edge, far enough to read as floating rather than pinned and far enough that the caption stays
  centred under it, the longest name it shows included. Neither the ball nor an entry carries a
  tooltip: every name is already on screen. It sits inside the chat body — between the toolbar and
  the composer — so neither it nor its caption ever covers either.
- Click, Enter or Space fans out round entries: every kind in `PANEL_KINDS` through the shared
  panel meta (a kind added later appears by itself), plus the terminal, which adopts a live shell
  no conversation holds or starts one, exactly like the dock picker, and a last "hide launcher"
  entry in the muted ink, so it reads as a lesser thing than the panels above it. A panel entry
  names the right dock on a wide window and names none on a narrow one, where the store lands the
  tab exactly where the toolbar's own panel buttons land it. They fall on a semicircular ring
  centred on the ball and opening leftward — from straight above it, through straight left, to
  straight below — spread evenly and in top-to-bottom order. The entries are glyphs alone, and
  pointing at one or focusing it prints its name in the ball's caption: one name on screen instead
  of seven pills floating around the ball, which is what had pushed the ring far enough out to stop
  reading as one object. The ring rests 92px from the ball's centre and widens only where a trimmed
  arc would otherwise crowd the entries together. Near the body's top or bottom the arc trims to the
  span that still fits, keeping every entry inside the conversation. Arrow keys walk the
  arc from top to bottom with the ball at the head of the sequence; Esc (refocusing the ball), a
  press elsewhere, or scrolling folds it.
- "Hide launcher" folds the fan, writes `penguin.dock.launcherHidden` and unmounts the ball under
  its own click, leaving a toast that names where it comes back from. That preference is the one
  the new **Shortcuts launcher** switch on the Appearance settings page reads and writes, so
  the fan's entry and the switch are two views of the same choice; both apply on the spot, through
  a small store the launcher's mount and the settings row subscribe to. A tolerant read means only
  a deliberate "1" hides it — an absent or hand-edited value shows the launcher.
- The pending-approval amber dot rides the ball — and the agents entry — under the same rule as the
  toolbar's right-dock toggle, and is named in the ball's accessible name.
- The ball drags along the edge with a small movement threshold, so a press stays a click; it
  rubberbands off the edge and past the body's ends and springs back on release. The position is
  one global preference, `penguin.dock.launcherY`, stored as a ratio of the chat body's height with
  a tolerant parse (anything unusable falls back to the centre). The gesture is tracked on the
  window, so it follows the pointer wherever it travels — over other controls included — instead
  of stalling the moment pointer capture is lost; capture and `touch-action: none` are still what
  keep a touch drag from scrolling the page under it. Both preferences are registered as browser
  preferences in `lib/install-scope.ts`, so switching data roots keeps them.
- `prefers-reduced-motion` disables the spring and the fan's animations: instant show and hide.
- The decisions — visibility, clamping (which reserves the caption's height), the ratio round trip
  and its parse, drag bounds, the arc's geometry and trimming, and the put-away preference and its
  store — live in `features/dock/dock-launcher-state.ts` with unit tests
  (`test/dock-launcher-state.test.ts`). The Web App docs and the design spec describe the launcher.
