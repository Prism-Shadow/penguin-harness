# Tabbed dock sidebars for every side element

- **Date:** 2026-08-21
- **Type:** feature
- **Scope:** `web`
- **PR:** [#394](https://github.com/Prism-Shadow/penguin-harness/pull/394)
- **Breaking:** yes — previously saved per-conversation terminal dock arrangements (browser localStorage) are not carried over; the docks start closed once, and running shells stay reachable from any dock's "+" menu.

[中文版](2026-08-21-dock-tab-sidebars.zh.md)

Replaced the chat page's drawer-style side panels and the old terminal pane system with
two uniform dock surfaces, one on the right and one at the bottom of the chat page
(Codex-style). Every side element — the subagents panel, the Workspace files panel, the
Memory panel, the new Trace panel, and any number of terminals — became a closable tab in
either dock: both docks can be open at once, tabs switch by click, reorder by drag within
a strip, move to the other edge by drag or by the dock's move button, and every tab
carries an always-visible × in its own slot (never overlapping the label). The old
mutual-exclusion between panels (and between panels and terminal panes) was removed with
the drawers.

## Details

- The chat toolbar's panel switcher became exactly two pull-open buttons — bottom dock,
  right dock — replacing the per-element icons, their pin system and the create menu. An
  opened dock with no tabs shows a centered picker (agents / terminal / workspace /
  memory / trace) choosing what to open there; each dock's own "+" menu adds more tabs, a
  fresh shell, or any live shell no conversation holds.
- The arrangement is per conversation, like each browser window managing its own tabs:
  tabs, active tab and open docks switch with the Session, no conversation's tabs depend
  on another's, and everything survives a reload (least-recently-used conversations age
  out of storage). An arrangement made while drafting is handed to the Session the first
  send creates. Dock sizes (right width, bottom height) stay one preference.
- Panels opened from the conversation — a message file card, a subagent chip, a
  memory-change row, the spawn auto-open — land on the right dock by default.
- The Trace panel shows the current conversation's Trace files (file pills, raw-file
  export, and the performance timeline + event list reused from the traces page). The
  Traces entry left the left navigation; the /traces browsing page stays reachable
  through its deep links (Agents page, session details popover, benchmark runs).
- The subagents panel's identity strip gained a jump button that opens the selected
  child's own Session in the chat area.
- Ctrl+` walks the conversation's terminal states: front when a panel covers it, hide
  when shown, restore — or adopt/create a shell when no terminal tab exists here. A
  failed shell create surfaces as an error toast.
- Opening and closing a dock animates (a 200ms slide, contents pinned at their settled
  size so nothing reflows mid-transition); cross-dock moves and conversation switches
  apply instantly. The bottom surface's picker lays its choices out in a row, the right
  one as a list. A terminal tab's × confirms before ending the shell, and detaching a
  terminal to its own window returns the tab to the dock it left when that window closes.
- Below 1024px the two docks render as one merged bottom surface listing both docks'
  tabs; the stored arrangement splits back apart when the window widens. The mobile
  bottom-Sheet variant of the panels was removed with the drawers.
- Fixed the Trace panel's dev-mode first load: under React StrictMode's double-invoked
  effects the listing fetch was cancelled and never retried, leaving the skeleton up
  until the tab was toggled. Also fixed the right dock's resize handle, which could not
  reach the box it resizes (it is a layout sibling of the dock, not a descendant).

## Compatibility

The dock arrangement is stored under a new localStorage key (`penguin.dock.layout`). The
old keys (`penguin.terminal.dock`, `penguin.terminal.dockRatios`,
`penguin.terminal.tabOrder`) are no longer read or written and are left in place; there is
no migration. The one-time effect is that docks start closed after the update — shells
keep running server-side, and every live shell no conversation holds can be pulled back in
from a dock's "+" menu or the picker's terminal row. The shared side-panel width
(`penguin.panelWidth`) carries over unchanged.
