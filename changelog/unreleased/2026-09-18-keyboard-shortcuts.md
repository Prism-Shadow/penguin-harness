# Keyboard shortcuts follow the platform, from one registry

- **Date:** 2026-09-18
- **Type:** feature
- **Scope:** `web`
- **PR:** [#787](https://github.com/Prism-Shadow/penguin-harness/pull/787)

[中文版](2026-09-18-keyboard-shortcuts.zh.md)

The Web App's shortcuts now come from one registry (`lib/shortcuts/`) instead of four hand-written
modifier checks, and the modifier follows the platform: ⌘ on macOS, Ctrl elsewhere. No default sits
on a chord the browser keeps for itself, so each one works in a browser tab as well as in the desktop
app. The focused terminal closes on `` Ctrl+Alt+` `` (`` ⌃⌥` `` on a Mac), beside the terminal
toggle, and Ctrl+W passes to the shell as readline's delete-word on every platform. The editors in
the Files panel and the handbook save on ⌘S on a Mac and Ctrl+S elsewhere, instead of accepting both
everywhere. The terminal toggle stays `` Ctrl+` `` on every platform (`` ⌘` `` is macOS's own window
cycling). Chords match on the physical key (`KeyboardEvent.code`), so a CJK IME, Shift, Caps Lock
and a macOS Option chord no longer change what a key means, and defaults move to the key that types
their letter on a non-US layout where the browser exposes one.

## Details

- Registry: `palette.toggle` (⌥⌘P / Ctrl+Alt+P, reserved for the command palette),
  `terminal.toggle` (`` Ctrl+` ``), `terminal.close` (`` Ctrl+Alt+` ``, literal Control on a Mac
  too), `editor.save` (⌘S / Ctrl+S). Each has a scope (global, terminal, editor); a focus scope
  beats global on the same chord, then registry order.
- Defaults stay off the browsers' own shortcuts: ⌘P / Ctrl+P prints and ⌘W / Ctrl+W closes the
  browser tab, hence Mod+Alt and the backquote key. Save keeps ⌘S / Ctrl+S and takes the browser's
  Save Page while an editor has focus. On a Mac, Chrome binds ⌥⌘P to Page Setup, which the palette
  takes over.
- The command palette ([#768](https://github.com/Prism-Shadow/penguin-harness/pull/768)) opens
  on `palette.toggle` and nothing else: its own Ctrl+P / Ctrl+Shift+P listener is gone, its footer
  and the workflow page's "fill the app" hints name the current binding, and a key pressed inside a
  workflow page still reaches the palette (the frame re-raises it with the key's code).
- Overrides are read from the browser mirror `penguin.keybindings` (versioned, per-platform
  sections, only rows that differ from the default), and every open tab follows a change live.
  The settings page that writes them, and the per-account server copy, follow in a later change.
- Every place that shows a chord — the terminal tab's × tooltip, the panel picker's kbd, the save
  button's title, the handbook's editor hint — formats it from the registry the way the platform
  writes it (`⌥⌘P`, `` ⌃` ``; `Ctrl+Alt+P`), and updates when the binding changes. A browser tab
  shows no chord the browser itself reserves (a binding on ⌘W / Ctrl+W closes the browser tab
  there), so no tooltip promises a key that does the opposite.
- A held chord repeats: every repeat is kept from the browser's own action (Save Page, Print), and
  the command runs once.
- macOS terminal clipboard: ⌘C and ⌘V are the native copy and paste; Ctrl+C is always SIGINT and
  Ctrl+V reaches the shell. Windows and Linux keep Ctrl+Shift+C / Ctrl+Insert / Ctrl+C-over-a-selection
  and Ctrl+V / Shift+Insert.
- A guard test fails on any `ctrlKey` / `metaKey` read outside `lib/shortcuts/`.
