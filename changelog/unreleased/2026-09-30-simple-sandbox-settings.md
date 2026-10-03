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
  dialog's Plugins page. At the top of the card is a table with one row per preset: the name,
  its file mode, network level and approval mode, and an "Action" group of icons — a pin for
  whether the menu lists it, a drag handle, and a "…" menu with Set as default and, on presets
  an administrator added, Delete. The default row reads "(Default)" after its name. Each name
  has a "?" saying what the row is for: a sentence per built-in preset (Workspace Write: for
  everyday coding), and for an added preset, or a built-in one whose values changed, what each
  of its three values does. The choice cells show the value's full title as text and open a small
  menu of the options. Dragging the handle lifts the row and shows where it will land; the
  arrow keys move a focused handle's row. That order is the composer's menu order. "Add preset"
  adds a row (Workspace write only, Full access, Ask every time, not pinned); only added rows
  can be deleted, and not while they are the default. Renaming keeps a row's mapping; Full
  Access can only be renamed, unpinned or made the default. Names wrap by words, and below the
  table's minimum width the table scrolls instead of crushing them.
- **Explanations sit behind a "?" beside their title** on every settings card; the "?" opens on
  hover and keyboard focus, and a click or tap still toggles it: the card's
  description, each field's and the table's. A format rule (masked paths: one absolute path
  per line) stays on screen under its field.
- **New Sessions start from the default preset.** One row is the default, Workspace Write until
  changed. While the switch is on, a new Session and the composer's draft take that
  row's file mode, network and approval mode; a default that confines nothing (Full Access)
  starts Sessions unconfined. Changing the default reaches new Sessions only. The card no longer
  has its own confinement mode and network fields; settings stored before the default preset
  keep their mode and network until an administrator sets a default. The card marks as default
  the row that
  starts Sessions exactly where they do, or none, with a notice saying what is in effect (see
  [backward compatibility](2026-10-02-backward-compatibility-sandbox-switch.md)).
- **The Sandbox card has an Enable switch at the top.** It decides whether new Sessions start
  confined; a Session that exists keeps its own policy. Off, a new Session has full file and
  network access and is held only by its approval mode, and the composer's permission menu
  lists the four approval modes instead of the presets. The presets and the default are kept
  while it is off and apply again when it is turned on. A fresh install starts off. Settings
  saved before the switch existed read it as on when they confined anything (a mode other than
  Off, a network that is not open, or masked paths); see
  [backward compatibility](2026-10-02-backward-compatibility-sandbox-switch.md). While the
  switch is off, the card shows the switch alone: no presets table, no Advanced fold, no notice
  and no backend's own settings.
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
  column. A table can declare a `rowChoice`: a single choice of a row, stored in an `enum` field
  of the same group whose options are the row ids, drawn as its title in brackets after the
  chosen row's name and picked from the row's "…" menu; a `pin`: a boolean column drawn as a pin toggle with a tooltip per state; a `columnGroup`, a
  header over adjacent columns; and `extensible`: rows may be added (only those deleted) and all
  reordered, stored additively under `"$added"` and `"$order"`. A row choice may name an added
  row, or no row at all; a save that leaves it naming a row the table no longer has is refused. Columns, rows and
  `enum` options take a `description` (a row's and its options' are its "?"), and fields a `hint` (`hintZh`) for their format, shown under the
  field while the `description` goes behind the "?".
- Settings fields can be marked `advanced: true`; the Plugins page folds such fields on every
  card.
- The sandbox's settings entry gains `backend` (`installed`, `recommended`); its group gains
  `enabled` and `defaultPreset` and loses `mode` and `network`. A configuration may name a
  boolean field as its `switch`: while it is off, the page draws that field alone.
- **A non-admin sees which presets only an administrator can pick.** A preset wider than the
  server's sandbox settings (with the default Workspace Write: Full Access and Always Ask, whose
  file mode is Off) is greyed out for a non-admin and marked "Admin only", and its tooltip says it
  exceeds this server's sandbox ceiling; administrators, and the preset the Session is on, are
  unaffected. A refused pick leaves the Session as it was, and a toast says why.
- `ConfirmModal` (UI package) takes a `glyph` for its leading mark. A portaled `Dropdown` moves
  focus to its first item once the panel is placed; before, opening one from the keyboard left
  focus on the trigger and the arrow keys did nothing.
- The Session's `sandbox` object in the API gains three response-only fields: `presets` (the
  table, disabled rows included), `advanced`, and `switchOn` (the Sandbox switch). The chat
  defaults carry them too, plus `defaultApprovalMode`: the default preset's approval mode
  while the switch is on. A Session created without an approval mode takes it; an
  organization's Session keeps `allow-all`. Each preset row carries `aboveCeiling: true` when
  it is wider than the server's settings, by the same comparison that refuses a non-admin's
  pick with `403 sandbox_forbidden`.
- `PATCH /api/sessions/:sessionId` checks every field, the sandbox's ceiling and
  enforceability included, before it writes any: a refused request stores nothing. Before, it
  stored the approval mode first, so a refused preset pick left its approval-mode half saved.
