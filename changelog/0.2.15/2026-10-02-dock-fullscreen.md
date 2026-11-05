# A dock can grow to its largest size, and every dock panel is a registry definition

- **Date:** 2026-10-02
- **Type:** feature
- **Scope:** `web`, `ui`
- **PR:** [#961](https://github.com/Prism-Shadow/penguin-harness/pull/961)

[中文版](2026-10-02-dock-fullscreen.zh.md)

A dock surface with tabs can now grow to its largest size — from a header button or by dragging its edge past the maximum — with an animated transition.
The panels behind the docks became definitions in one registry, which every list of panels reads,
as the seam for panels that plugins will provide.

## Details

- **Full screen** is the dock at its largest, below the chat toolbar, which keeps the title and
  statistics: the right dock covers its row (the conversation column), with an open bottom dock still
  showing below it; the bottom dock (or the merged sheet on a narrow window) grows up to the toolbar.
  The navigation column stays. Enter it with the **Full screen** header button, or by dragging the
  dock's edge a little past its maximum width (height for the bottom dock); the drag snaps into full
  screen and ends there. While full, the resize handle sits on the surface's leading edge: dragging it
  back snaps out to the stored size, and so does a double-click. The header button, now **Exit full
  screen**, leaves in place. Esc does not leave: the terminal, the editor and web pages use it. The
  tab strip, **Add panel**, a terminal's **Detach** and the dock's × keep working; moving the dock or
  a tab to the other edge is put away.
- Entering and leaving animate with the theme's layout motion — the surface grows from where it
  docks and shrinks back — and are instant under reduced motion. The panel lays out at its final
  size from the first frame, so a terminal does not refit on every step. The theme's layout motion
  now also covers `top` and `left`.
- Full screen is not remembered. It ends when the conversation changes, when the window crosses the
  narrow breakpoint, when the dock is hidden or its last tab closes, and when a dock it covers has to
  show something (the right dock opening under a full-screen bottom dock), so that content never
  opens under the cover. A full-screen right dock covers no other dock, so the bottom dock opening
  or showing a terminal leaves it as it is.
- The page under the cover does not reflow, and the panels do not remount: scroll positions, a
  file preview, an editor draft and a terminal's screen are as they were on the way back. Dialogs,
  menus, tooltips and toasts still show above a full-screen dock, and the built-in browser's page
  follows it.
- The touch-only **Fill the screen** button of the bottom dock is gone; full screen replaces it on
  every pointer.
- **Panel registry.** Each panel kind (agents, Files, Memory, Trajectories, Remote control,
  Scheduled tasks, Browser) is a definition — id, name, icon, order, whether it is offered here,
  and its body component. The tab strip, **Add panel**, the empty dock's picker and the Shortcuts
  launcher list and name panels from it. A body reaches what its dock gives it through one hook,
  `useDockPanel()`: its dock, whether it is the shown tab, full screen on and off, and closing its
  tab through the close guards. A stored tab whose panel is not registered (a plugin not loaded
  yet) stays in the layout and shows a placeholder until it is, closable by its ×.
