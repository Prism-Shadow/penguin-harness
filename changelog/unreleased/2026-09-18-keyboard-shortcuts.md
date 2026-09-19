# Keyboard shortcuts follow the platform, from one registry

- **Date:** 2026-09-18
- **Type:** feature
- **Scope:** `web`
- **PR:** [#787](https://github.com/Prism-Shadow/penguin-harness/pull/787)

[中文版](2026-09-18-keyboard-shortcuts.zh.md)

The Web App's shortcuts now come from one registry (`lib/shortcuts/`) instead of four hand-written
modifier checks, and the modifier follows the platform: ⌘ on macOS, Ctrl elsewhere. In the desktop
app the terminal tab closes on ⌘W on a Mac, where Ctrl+W now passes to the shell as readline's
delete-word; Windows and Linux keep Ctrl+W. The editors in the Files panel and the handbook save on
⌘S on a Mac and Ctrl+S elsewhere, instead of accepting both everywhere. The terminal toggle stays
`` Ctrl+` `` on every platform (`` ⌘` `` is macOS's own window cycling). Chords match on the
physical key (`KeyboardEvent.code`), so a CJK IME, Shift, Caps Lock and a macOS Option chord no
longer change what a key means, and defaults move to the key that types their letter on a non-US
layout where the browser exposes one.

## Details

- Registry: `palette.toggle` (⌘P / Ctrl+P, reserved for the command palette), `terminal.toggle`
  (`` Ctrl+` ``), `terminal.close` (⌘W / Ctrl+W), `editor.save` (⌘S / Ctrl+S). Each has a scope
  (global, terminal, editor); a focus scope beats global on the same chord, then registry order.
- Overrides are read from the browser mirror `penguin.keybindings` (versioned, per-platform
  sections, only rows that differ from the default), and every open tab follows a change live.
  The settings page that writes them, and the per-account server copy, follow in a later change.
- Every place that shows a chord — the terminal tab's × tooltip, the panel picker's kbd, the save
  button's title, the handbook's editor hint — formats it from the registry the way the platform
  writes it (`⌘W`, `` ⌃` ``; `Ctrl+W`), and updates when the binding changes. A browser tab shows
  no chord the browser itself reserves (⌘W / Ctrl+W close the browser tab there), so no tooltip
  promises a key that does the opposite.
- A held chord repeats: every repeat is kept from the browser's own action (Save Page, Print), and
  the command runs once.
- macOS terminal clipboard: ⌘C and ⌘V are the native copy and paste; Ctrl+C is always SIGINT and
  Ctrl+V reaches the shell. Windows and Linux keep Ctrl+Shift+C / Ctrl+Insert / Ctrl+C-over-a-selection
  and Ctrl+V / Shift+Insert.
- A guard test fails on any `ctrlKey` / `metaKey` read outside `lib/shortcuts/`.
