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
  presets, Workspace Write with Ask and Denied All, start out of the menu. The table sits in a
  bordered box with a tinted header; the name is an inline text box, "In menu" is a switch, and
  Full Access's locked cells show their value with a lock mark.
- **The Sandbox card has an on/off switch at the top.** It decides whether new Sessions start
  confined; a Session that exists keeps its own policy. Off, a new Session has full file and
  network access and is held only by its approval mode, and the composer's permission menu
  lists the four approval modes instead of the presets. The mode, network and presets are kept
  while it is off and apply again when it is turned on. A fresh install starts off. Settings
  saved before the switch existed read it as on when they confined anything; see
  [backward compatibility](2026-10-02-backward-compatibility-sandbox-switch.md).
- **The default mode, network, temp directory and masked paths moved into an Advanced fold**,
  collapsed by default, under the switch and the presets table.
- **Turning the switch on offers to install a sandbox backend** when the machine has none for
  its OS: `@penguinharness/sandbox-bwrap` on Linux, `@penguinharness/sandbox-seatbelt` on
  macOS, `@penguinharness/sandbox-wsl` on Windows. The choices are Install and Not now, with
  "Don't ask again", which this browser remembers per machine. Installing goes through the
  Plugins page's install, into the current Project for that machine; the switch stays on
  either way.
- **Saving the table does not change what is confined.** The presets only name combinations.
  A Session still stores its own mode, network level and approval mode, and the sandbox policy
  is still read from the card's other fields.
- Settings groups gain a `table` field type: fixed rows, columns of `string`, `boolean` or `enum`,
  and cells that can be locked. Only the cells that differ from the declaration are stored, and a
  refused cell is named `<field>.<row>.<column>`. An `unavailable` option can name a table
  column.
- Settings fields can be marked `advanced: true`; the Plugins page folds such fields on every
  card.
- The sandbox's settings entry gains `backend` (`installed`, `recommended`) and its group an
  `enabled` field.
- The Session's `sandbox` object in the API gains three response-only fields: `presets` (the
  table, disabled rows included), `advanced`, and `switchOn` (the Sandbox switch). The chat
  defaults carry them too.
