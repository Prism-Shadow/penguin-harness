# Shortcuts hold several bindings; the palette completes session ids

- **Date:** 2026-10-27
- **Type:** feature
- **Scope:** `web`, `ui`, `server`

[中文版](2026-10-27-shortcut-multi-bindings-and-palette-session-jump.zh.md)

A command can hold several keyboard bindings. The Shortcuts settings page draws each binding as a chip with its own remove button, and the recorder button adds a recorded chord to the command instead of replacing what it had — so a second chord for an action no longer costs the first one. Deleting the added chords leaves the default; deleting them all marks the command as unbound; the default chord itself can be deleted the same way, and the per-row restore button keeps putting everything back. Typing Ctrl+P as a second binding for the command palette takes it over from the browser's Print in that tab, and the row's note says so.

The stored form (`ui_prefs.keybindings`) carries one command's bindings as an array of chord strings; the single-chord string an older build writes still reads as one binding, the server accepts both forms and caps a command at eight chords.

Typing the start of a session id (`session-…`) in the command palette completes that session: the entry shows its title with its run state (running, compacting or idle) and its session id beside it, and Enter jumps to its chat page. A long id is ellipsed in the entry's secondary line. Completion works on the sessions the sidebar has loaded and asks the sessions list for the typed prefix live, so a session no loaded page carries — one on a machine of the Project, say — is completed all the same; the merged rows run most recently active first, at most twenty entries.

## Details

- Matching fires a command when the pressed chord is any of its bindings; conflict detection and the row's notes (a chord the browser keeps for itself, a chord the desktop menu also uses) read the whole list.
- A palette entry can carry a secondary line (`detail`), drawn in the muted ink after the label; the caller's completions (`suggest`) answer the raw query and list after the filtered standing actions.
