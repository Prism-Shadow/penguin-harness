# The terminal keeps the first keystrokes

- **Date:** 2026-11-24
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1828](https://github.com/Prism-Shadow/penguin-harness/pull/1828)

[中文版](2026-11-24-terminal-initial-input.zh.md)

Fixed a race that could cut off the start of a command typed as soon as a terminal received keyboard focus. Opening or reopening a terminal now delivers those keystrokes to its shell in order. When the shell has bracketed paste enabled, multiline text pasted while reopening stays in the editor until Enter.

Cursor keys pressed while reopening use the foreground program's cursor-key mode. Keys typed after a right-click, middle-click or touch paste follow the pasted text, even when the browser takes time to read the clipboard.
