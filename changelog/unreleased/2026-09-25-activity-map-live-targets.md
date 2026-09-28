# See the live tap targets on the behavior map, and resize it beside the player

- **Date:** 2026-09-25
- **Type:** feature
- **Scope:** `web`

While an activity plays, the phase it is in on the behavior map now shows how many things
the learner can tap (for example **5 live**), and a list under the drawing shows the first
three with **+N more** for the rest. Pointing at or focusing one of them outlines it in the
player until the pointer or focus moves away. Pressing one keeps the outline, as the
**Tap targets** chips under the player already do.

- When the player's area is at least 960 px wide, the map sits beside the player instead
  of under it. A divider between them can be dragged, or moved 20 px at a time with the
  arrow keys (Home and End go to the narrowest and widest). The map stays between 260 and
  880 px wide and always leaves the player at least 320 px.
- The map's width and whether it is shown are now remembered in the browser
  (`penguin.activityMapWidth`, `penguin.activityMapVisible`). If storage can't be read, the
  map is shown at its default width of 360 px.
- Below 960 px the map stays under the player as before.
