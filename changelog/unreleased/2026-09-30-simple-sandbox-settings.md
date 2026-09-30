# The permission menu offers named presets

- **Date:** 2026-09-30
- **Type:** feat
- **Scope:** `server`, `web`

[中文版](2026-09-30-simple-sandbox-settings.zh.md)

The composer's permission button lists presets instead of three sections of levels: Full Access,
Always Ask, Workspace Write and Read Only, then More… for an administrator. Each preset is a
named file mode, network level and approval mode, and one pick saves all three on the Session.

- **What a preset does is in its tooltip.** Hovering a preset says what it blocks, what it
  allows, and whether this machine can enforce it. A preset no backend here can enforce stays
  listed, greyed out and marked "Not installed" or "Unavailable", as the levels were before.
- **The button names the Session's level by its preset.** A level no preset matches (set from
  the full settings, or by an older client) is shown as Custom, with its three values in the
  tooltip. When the Session also has masked paths or a read-only temp directory, the menu says
  "Advanced settings in effect".
- **The Sandbox card has a presets table.** More… opens the Sandbox card on the Settings
  dialog's Plugins page. At the top of the card is a table with one row per preset and columns
  for the name, whether the menu lists it, and its file mode, network level and approval mode.
  Renaming a preset keeps its mapping. Full Access can only be renamed or hidden. Two more
  presets, Workspace Write with Ask and Denied All, start out of the menu. The card's other
  settings stay below the table, unchanged.
- **Saving the table does not change what is confined.** The presets only name combinations.
  A Session still stores its own mode, network level and approval mode, and the sandbox policy
  is still read from the card's other fields.
- Settings groups gain a `table` field type: fixed rows, columns of `string`, `boolean` or `enum`,
  and cells that can be locked. Only the cells that differ from the declaration are stored, and a
  refused cell is named `<field>.<row>.<column>`. An `unavailable` option can name a table
  column.
- The Session's `sandbox` object in the API gains two response-only fields: `presets` (the table,
  disabled rows included) and `advanced`. The chat defaults carry them too.
