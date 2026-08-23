# The macOS 'penguin' install quotes the app path it hands to the privileged shell

- **Date:** 2026-08-23
- **Type:** fix
- **Scope:** `desktop`

[中文版](2026-08-23-desktop-cli-install-quoting.zh.md)

Installing the `penguin` command on macOS falls back to `osascript … with administrator
privileges` when linking `/usr/local/bin/penguin` is refused — the ordinary path on a Mac
without Homebrew, where that directory does not exist and creating it needs root. The
command it ran interpolated the app bundle's own path into a single-quoted shell word
without escaping it, so a bundle kept in a directory whose name contains an apostrophe
produced a command that broke out of its quoting and ran as root. Both quoting layers are
now applied by a generator in `launcher.ts`, next to the launcher scripts and covered by
the same unit tests.

## Details

- `shellQuote` renders a value as one POSIX shell word, splicing embedded single quotes as
  `'\''`; `appleScriptString` renders the resulting command as an AppleScript literal,
  escaping the backslashes that splice introduces.
- `adminSymlinkAppleScript` composes the two into the `do shell script …` source that
  `cli-install.ts` passes to `osascript`, so the escaping is chosen once and asserted
  directly rather than restated at the call site.
- The link directory is derived from the link path instead of being spelled out twice.
- The AppImage wrapper's own refusal of quoted paths is unchanged: it bakes the path into a
  script that stays on disk, which is a different exposure from a one-shot command.
