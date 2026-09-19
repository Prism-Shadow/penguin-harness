# A Shortcuts settings page, with bindings stored per account

- **Date:** 2026-09-18
- **Type:** feature
- **Scope:** `web`, `server`
- **PR:** [#789](https://github.com/Prism-Shadow/penguin-harness/pull/789)

[中文版](2026-09-18-shortcut-settings.zh.md)

The System settings dialog gained a **Keyboard shortcuts** page in the personal group, after
Appearance. It lists every rebindable command by group with its current chord, written the way the
platform writes it (`⌘W` on a Mac, `Ctrl+W` elsewhere). Clicking a chord records the next
combination pressed: Esc cancels, Backspace or Delete clears the binding, and a key without Ctrl or
Alt (⌘ or ⌃ on macOS; Shift alone is typing) is refused unless it is an F key. Each row can go back to its default, and the page can
reset every override at once. Bindings are stored per account in `ui_prefs.keybindings`; a change
applies at once in every tab of the same browser, and the account's other browsers and the desktop
app pick it up the next time they load.

## Details

- A row says what stands in its binding's way: another command on the same chord (which one wins
  is stated), a chord the browser itself reserves (works in the desktop app only), or, in the
  desktop app, a chord its menu also carries (the binding takes it over).
- `PUT /api/me/prefs` validates `keybindings`: version 1, per-platform sections (`mac`, `windows`,
  `linux`) of at most 64 entries, command ids and chord strings checked against their grammar and
  length caps, the whole document at most 8 KiB. An invalid document is refused with
  `invalid_keybindings` and nothing from that request is stored.
- After sign-in the account's copy replaces the browser mirror; a mirror the account knows nothing
  about is cleared, and an edit made under the previous account is never read as this account's.
  A write that fails to reach the server is reported and leaves the mirror in place.
- Setting rows can now show their hint in the attention tone, which the conflict hint uses.
