# The full-page workbench's exit is a floating ball that drags, docks to an edge and tucks away

- **Date:** 2026-11-12
- **Type:** feature
- **Scope:** `web`, `ui`, `ui-gallery`
- **PR:** [#1546](https://github.com/Prism-Shadow/penguin-harness/pull/1546)

[中文版](2026-11-12-workbench-exit-ball.zh.md)

The **Exit full screen** text button at the bottom-right of a full-page workbench (`/app/<project>/<agent>/<workbench>`) was replaced by a 46px round glass ball with the exit glyph, in the same corner. A click, Enter or Space exits as the button did; the ball can be dragged to either side edge or tucked away so it stops covering the workbench's own page.

## Details

- **Drag.** Mouse, touch or pen; a press that moves under 4px is still a click, and the click after a drag never exits. The ball follows the pointer, stays below the window band and inside the page, and on release springs to the left or right edge, whichever side its centre is on, 16px in. While a press is live a transparent cover over the page keeps the workbench's iframe from swallowing the pointer; at any other time nothing but the ball takes events.
- **Tuck.** Hovering or keyboard-focusing the ball shows a small × on its inner top corner (**Tuck to the edge**); pushing the ball past its side edge and letting go does the same, and the ball dims while it is far enough out. Tucked, a slim handle on that edge at the same height (**Show the exit button**) brings the ball back. The command palette's **Exit full page** works either way.
- **Remembered.** The side, the height (as a share of the page's height) and the tucked state are one browser preference, `penguin.workbench.exitBall` in localStorage, shared by every full-page workbench and not synced to the account. A resize re-places the ball inside the page without rewriting what was stored; an unreadable value falls back to the corner, and blocked storage only costs persistence.
- **Shared UI.** The ball is the UI package's new `FloatingBall` (drag threshold, edge snap, tuck and untuck, a controlled placement handed back through `onChange`, the drag shield), built on the dock launcher's `LauncherBall`, whose caption became optional, with two new parts beside it: `LauncherDismiss` (the corner ×) and `LauncherEdgeHandle` (the edge tab). Its geometry is a pure module, `floating-ball-geometry.ts`. The gallery's **Buttons** board shows it on a stage of its own.
