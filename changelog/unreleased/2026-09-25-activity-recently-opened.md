# Recently opened activities on the Activities list

- **Date:** 2026-09-25
- **Type:** feature
- **Scope:** `web`

The Activities list shows the four activities the author opened most recently in the project,
in a **Recently opened** row above the full list, so returning to today's work is one click.

- An activity counts as opened once it has loaded; one that fails to load is not recorded.
  Opening it again moves it back to the front of the row.
- The row appears only when the search is empty and at least one recently opened activity is
  still in the list; a deleted activity drops out of it. The full list follows under
  **All activities**.
- Openings are remembered per project in this browser (`penguin.activities.recent` in
  localStorage, the newest 15 per project). Nothing is sent to the server; unreadable stored
  data shows no row.
