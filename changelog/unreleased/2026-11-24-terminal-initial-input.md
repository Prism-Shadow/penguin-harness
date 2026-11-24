# The terminal keeps the first keystrokes

- **Date:** 2026-11-24
- **Type:** fix
- **Scope:** `web`

[中文版](2026-11-24-terminal-initial-input.zh.md)

Fixed a race that could cut off the start of a command typed as soon as a terminal received keyboard focus. Opening or reopening a terminal now delivers those keystrokes to its shell in order.
