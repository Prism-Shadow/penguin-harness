# The permission menu offers named presets

- **Date:** 2026-09-30
- **Type:** feat
- **Scope:** `server`, `web`, `ui`

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
  for the name, its file mode, network level and approval mode, Default, and Pin (whether the
  menu lists it). Renaming a preset keeps its mapping. Full Access can only be renamed, unpinned
  or made the default. Two more presets, Workspace Write with Ask and Denied All, start
  unpinned. The table fits the settings dialog in a bordered box with a tinted header and even
  columns: the name wraps and holds the effective name, the three choice columns are the same
  width with short option names ("Approve all", "Approve reads", "Ask every time", "Deny all"),
  Pin is a pin toggle, and Full Access's locked cells show their value as plain text. Every
  column header has a "?" saying what the column means.
- **Explanations sit behind a "?" beside their title** on every settings card: the card's
  description, each field's and the table's. A format rule (masked paths: one absolute path
  per line) stays on screen under its field.
- **New Sessions start from the default preset.** A Default column picks one row, Workspace
  Write until changed. While the switch is on, a new Session and the composer's draft take that
  row's file mode, network and approval mode; a default that confines nothing (Full Access)
  starts Sessions unconfined. Changing the default reaches new Sessions only. The card no longer
  has its own confinement mode and network fields; settings stored before the default preset
  keep their mode and network until the card is saved once (see backward compatibility).
- **The Sandbox card has an on/off switch at the top.** It decides whether new Sessions start
  confined; a Session that exists keeps its own policy. Off, a new Session has full file and
  network access and is held only by its approval mode, and the composer's permission menu
  lists the four approval modes instead of the presets. The presets and the default are kept
  while it is off and apply again when it is turned on. A fresh install starts off. Settings
  saved before the switch existed read it as on when they confined anything (a mode other than
  Off, a network that is not open, or masked paths); see
  [backward compatibility](2026-10-02-backward-compatibility-sandbox-switch.md). While the
  switch is off, the card hides its warning that no sandbox backend is usable.
- **The temp directory and masked paths moved into an Advanced fold**, collapsed by default,
  under the switch and the presets table.
- **Turning the switch on offers to install a sandbox backend** when the machine has none for
  its OS: `@penguinharness/sandbox-bwrap` on Linux, `@penguinharness/sandbox-seatbelt` on
  macOS, `@penguinharness/sandbox-wsl` on Windows. The dialog wears a download mark. The
  choices are Install and Not now, with
  "Don't ask again", which this browser remembers per machine. Installing goes through the
  Plugins page's install, into the current Project for that machine; the switch stays on
  either way.
- Settings groups gain a `table` field type: fixed rows, columns of `string`, `boolean` or `enum`,
  and cells that can be locked. Only the cells that differ from the declaration are stored, and a
  refused cell is named `<field>.<row>.<column>`. An `unavailable` option can name a table
  column. A table can declare a `rowChoice`: a single-choice column stored in an `enum` field of
  the same group whose options are the row ids, drawn before the column its `before` names; and
  a `pin`: a boolean column drawn as a pin toggle with a tooltip per state. Columns and the row
  choice take a `description`, and fields a `hint` (`hintZh`) for their format, shown under the
  field while the `description` goes behind the "?".
- Settings fields can be marked `advanced: true`; the Plugins page folds such fields on every
  card.
- The sandbox's settings entry gains `backend` (`installed`, `recommended`); its group gains
  `enabled` and `defaultPreset` and loses `mode` and `network`. A notice may name a switch in
  `onlyWhen`, and the page shows it only while that switch is on.
- `ConfirmModal` (UI package) takes a `glyph` for its leading mark.
- The Session's `sandbox` object in the API gains three response-only fields: `presets` (the
  table, disabled rows included), `advanced`, and `switchOn` (the Sandbox switch). The chat
  defaults carry them too, plus `defaultApprovalMode`: the default preset's approval mode
  while the switch is on. A Session created without an approval mode takes it; an
  organization's Session keeps `allow-all`.
