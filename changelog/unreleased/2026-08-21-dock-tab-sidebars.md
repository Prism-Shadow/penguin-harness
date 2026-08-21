# Tabbed dock sidebars for every side element

- **Date:** 2026-08-21
- **Type:** feature
- **Scope:** `web`
- **PR:** [#394](https://github.com/Prism-Shadow/penguin-harness/pull/394)
- **Breaking:** yes — previously saved per-conversation terminal dock arrangements (browser localStorage) are not carried over; the docks start closed once, and running shells stay reachable from the toolbar's terminal menu.

[中文版](2026-08-21-dock-tab-sidebars.zh.md)

Replaced the chat page's drawer-style side panels and the per-conversation terminal pane
system with two uniform dock surfaces, one on the right and one at the bottom of the chat
page (Codex-style). Every side element — the subagents panel, the Workspace files panel,
the Memory panel, the new Trace panel, and any number of terminals — became a closable tab
in either dock: both docks can be open at once, tabs switch by click, reorder by drag
within a strip, move to the other edge by drag or by the dock's move button, and a dock's
× hides the surface while keeping its tabs. The old mutual-exclusion between panels (and
between panels and terminal panes) was removed with the drawers.

## Details

- The arrangement — tabs, active tab, hidden docks, the right dock's width and the bottom
  dock's height — is global and persisted: it survives conversation switches and reloads,
  and it renders on the draft page too (session-bound panels show a placeholder there
  until the first send creates the Session). Terminals stopped being scoped to the
  conversation they were opened in.
- The chat toolbar's panel switcher gained the Trace entry and, in its create menu,
  per-element placement actions ("open on the right" / "open at the bottom") beside the
  existing pin toggles. Each dock's own "+" menu adds panels, a fresh shell, or any live
  shell that has no tab yet.
- The Trace panel shows the current conversation's Trace files (file pills, raw-file
  export, and the performance timeline + event list reused from the traces page). The
  Traces entry left the left navigation; the /traces browsing page stays reachable
  through its deep links (Agents page, session details popover, benchmark runs).
- The subagents panel's identity strip gained a jump button that opens the selected
  child's own Session in the chat area.
- Ctrl+` now walks terminal states: it brings the terminal tab to the front when a panel
  covers it, hides the docks holding terminals when one is shown, and restores — or
  adopts/creates a shell when no terminal tab exists. A failed shell create surfaces as an
  error toast.
- Below 1024px the two docks render as one merged bottom surface listing both docks'
  tabs; the stored arrangement splits back apart when the window widens. The mobile
  bottom-Sheet variant of the panels was removed with the drawers.

## Compatibility

The dock arrangement is stored under a new localStorage key (`penguin.dock.layout`). The
old keys (`penguin.terminal.dock`, `penguin.terminal.dockRatios`,
`penguin.terminal.tabOrder`) are no longer read or written and are left in place; there is
no migration. The one-time effect is that docks start closed after the update — shells
keep running server-side and every live shell stays reachable from the toolbar's terminal
menu. The shared side-panel width (`penguin.panelWidth`) carries over unchanged.
