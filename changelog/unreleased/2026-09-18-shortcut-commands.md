# Six more keyboard shortcuts: search, new chat, sidebar, panels, new terminal

- **Date:** 2026-09-18
- **Type:** feature
- **Scope:** `web`
- **PR:** [#790](https://github.com/Prism-Shadow/penguin-harness/pull/790)

[中文版](2026-09-18-shortcut-commands.zh.md)

Six commands joined the shortcut registry, each rebindable on the Shortcuts settings page (`Mod` is
⌘ on macOS and Ctrl elsewhere): search sessions (Mod+Alt+S), new chat (Mod+Alt+N), show or hide the
sidebar (Mod+Alt+1), the right sidebar (Mod+Alt+2) and the bottom panel (Mod+Alt+3), and new
terminal (`` Ctrl+Shift+` `` on every platform, beside the terminal toggle's `` Ctrl+` ``). The
defaults stay off the browser's own shortcuts — Mod+K searches the web, Mod+N opens a window, Mod+B,
Mod+J and Mod+Shift+O open bookmarks and downloads — except on a Mac, where Chrome also binds ⌥⌘N
(split view), which new chat takes over. The buttons that run the same actions — the panel toggles
in the chat toolbar, the sidebar's search and new-chat buttons, the sidebar collapse and expand
controls — name the chord in their tooltips.

## Details

- Inside a focused terminal the shell keeps every key xterm would send it, bound or not: Ctrl+B
  stays tmux's prefix, and on Linux the Ctrl+Alt chords reach the shell as Meta. The app commands
  still reachable from a terminal are the chords xterm sends nothing for — `` Ctrl+` ``,
  `` Ctrl+Shift+` ``, every ⌘ chord on a Mac, and on Windows the Ctrl+Alt chords, which xterm
  leaves to AltGr.
- A key typed with AltGr (Windows reports it as Ctrl+Alt) is typing, not a chord: `ś` stays typable
  on the Polish layout although its keys read as Mod+Alt+S.
- Search sessions opens the sidebar's search field, or puts the caret back into an open one; on the
  collapsed rail one press expands the sidebar with the field open and focused. New chat does what
  every other New chat does, parking typed-but-unsent text first, and works with the sidebar
  collapsed. Both are development-mode commands: in company mode they leave the key to the browser.
- A command whose target is not on screen leaves the key to the browser too: the sidebar commands
  below the `md` breakpoint (where the pinned sidebar is not shown), and the panel and terminal
  commands on pages without docks — organization pages, the login page, the standalone terminal
  page — so a new terminal is never spawned into a hidden dock. Global commands also stay quiet
  while a dialog or menu is open.
- The settings page's Panels group, empty until now, holds the sidebar and panel toggles.
