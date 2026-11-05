# The process list clears every exited process in one click, and shows a long command whole on hover

- **Date:** 2026-09-17
- **Type:** feature
- **Scope:** `web`
- **PR:** [#782](https://github.com/Prism-Shadow/penguin-harness/pull/782)

[中文版](2026-09-17-process-list-clear-exited.zh.md)

The **Processes** list in a conversation's details card gained a one-click action that removes
every exited process, and a command too long for its row became readable by hovering it.

## Details

- While at least one listed process has exited, the list heading shows a text action, **Clear
  exited**: small gray text that darkens on hover, with no background or border. Its hover hint
  notes that the output captured from those processes is discarded too. One click removes every
  exited entry, with no confirmation step. It sends each entry's own
  Remove request, the same route as a row's **Remove** button, so running processes are never
  touched. An entry that has already gone, or turns out to be still running, is not reported as an
  error. Any other failure produces one toast for the whole batch, and the list refreshes
  afterwards.
- A command cut off by its row now shows whole in a styled tooltip when hovered: monospace, wrapping
  inside the panel, and kept within the screen. A command that fits its row opens no tooltip. The
  row no longer carries a native `title`.
- The shared `Tooltip` gained a `code` content kind for such text, and caps every panel's width at
  the room left on screen on the side it grows toward. `Truncated` gained a `codeTooltip` option
  that discloses a clipped tail through that panel instead of a native `title`.
