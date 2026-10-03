# A dock can fill the conversation area, and every dock panel is a registry definition

- **Date:** 2026-10-02
- **Type:** feature
- **Scope:** `web`, `ui`
- **PR:** [#961](https://github.com/Prism-Shadow/penguin-harness/pull/961)

[中文版](2026-10-02-dock-fullscreen.zh.md)

A dock surface with tabs can now fill the whole conversation area, with an animated transition.
The panels behind the docks became definitions in one registry, which every list of panels reads,
as the seam for panels that plugins will provide.

## Details

- **Full screen.** A **Full screen** button in the dock's header (the right dock, the bottom dock,
  or the merged bottom sheet on a narrow window) expands that surface over the conversation area:
  the chat toolbar, the conversation and the other dock are covered, while the navigation column,
  which folds on its own, stays. The tab strip, **Add panel**, a terminal's **Detach** and the
  dock's × keep working; moving the dock or a tab to the other edge and the resize handle are put
  away. The same header button, now **Exit full screen**, leaves in place. Esc does not leave: the
  terminal, the editor and web pages use it.
- Entering and leaving animate with the theme's layout motion — the surface grows from where it
  docks and shrinks back — and are instant under reduced motion. The panel lays out at its final
  size from the first frame, so a terminal does not refit on every step. The theme's layout motion
  now also covers `top` and `left`.
- Full screen is not remembered. It ends when the conversation changes, when the window crosses
  the narrow breakpoint, when the dock is hidden or its last tab closes, and when something has to
  show in the other dock (for example the agent opening the built-in browser whose tab lives
  there), so that content never opens under the cover.
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
