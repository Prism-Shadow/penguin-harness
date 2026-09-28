# Named layouts for the activity workspace

- **Date:** 2026-09-25
- **Type:** feature
- **Scope:** `web`

A **Layout** menu in the activity header switches the workspace between arrangements suited to
the job at hand, and saves the current arrangement under the author's own name so it comes back
next time.

- Three built-in layouts: **Writing** (rail open at 300 px, the conversation beside the work,
  the Description section), **Reviewing** (rail collapsed, the player open with its behavior
  map at 420 px, the Scenes and media section) and **Media** (a wide rail, no side panel, the Media library
  section). A built-in changes only what it names, and cannot be renamed or deleted.
- A layout captures the rail's width and whether it is collapsed, the open side panel, the open
  section, the behavior map's width and whether it shows, and the run log's **Show reasoning**
  switch. The layout on screen is marked **Current** in the menu.
- **Save current as…** saves up to 20 layouts; a name is 1 to 40 characters and must differ from
  every other layout's name, case aside. **Manage…** lists every layout, with Rename and Delete
  (after asking) for saved ones.
- **Keyboard shortcuts**, off by default: when ticked, Alt+1 to Alt+9 apply the layouts in menu
  order, except while typing in a field.
- Layouts are remembered in this browser (`penguin.activityLayouts` in localStorage). Nothing is
  sent to the server; unreadable stored data leaves the built-ins only.
- An applied layout reaches an open player and run log at once: the map's width and visibility
  and the reasoning switch are now one live value per page.
- The data-root sweep now classifies the studio's remembered map width and visibility and the
  layouts as browser state, so switching data roots keeps them. The recently opened activities
  name Project and Activity ids, so they are classified as data-root state and cleared with it.
