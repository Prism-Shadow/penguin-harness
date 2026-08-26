# The desktop app installs the `penguin` command itself

- **Date:** 2026-08-27
- **Type:** feature
- **Scope:** `desktop`, `docs`
- **PR:** [#480](https://github.com/Prism-Shadow/penguin-harness/pull/480)

[中文版](2026-08-27-desktop-installs-cli.zh.md)

The desktop app now puts its bundled `penguin` command on PATH without being asked, and
re-checks it at every launch. Only the deb package did this before; macOS, Windows and the
AppImage offered it once, in a dialog on first launch, and never again. Because the app and
the CLI it carries come from the same build, installing the command from the app is also
what keeps the two in step across an update.

## What each platform does

- **macOS** — links `/usr/local/bin/penguin` to the app. The unprivileged write is tried
  first and an administrator prompt appears only where it is actually refused, which is a
  Mac with no `/usr/local/bin` yet. Dismissing that prompt is recorded and the app stops
  asking; the menu item is the way back.
- **Windows** — appends the app's `bin` directory to the user `Path` (`HKCU\Environment`),
  as before: idempotent, append-only, and no elevation.
- **Linux AppImage** — writes the `~/.local/bin/penguin` wrapper that runs the AppImage.
- **Linux deb** — unchanged; its postinst already created `/usr/bin/penguin`.

## What it will not do

- **Replace a `penguin` this app did not write.** A regular file where a link belongs, a
  symlink pointing anywhere else, anything without the marker every bundled launcher
  carries — each is left exactly as it was and the reason is recorded under `userData` in
  `cli-command.json`. `install.sh` puts its own symlink at `~/.local/bin/penguin`, which is
  the very path the AppImage form uses; the app is the side that gives way. The menu item
  **Install 'penguin' Command…** replaces it deliberately, after showing what it would
  overwrite.
- **Install from a location that will not persist.** A macOS bundle still on its mounted
  dmg, or one Gatekeeper is running translocated, would produce a link that dies with the
  mount. The app defers, and installs on the next launch from Applications.

## Repair

Running at every launch is what repairs an install rather than only creating one: a link
left dangling by a moved or updated app, or a wrapper naming an AppImage that has moved, is
rewritten to point at the running app. A `penguin` that is already correct costs one
`lstat`.

## Documentation

`quickstart-desktop` gained a `penguin` command section covering all four forms and the
two refusals, and `quickstart` stopped sending desktop users to a CLI install to get the
command. Both pages also dropped the macOS quarantine and Windows SmartScreen first-launch
instructions, which had outlived the unsigned builds they were written for — the same
correction the landing and README sweep in
[#481](https://github.com/Prism-Shadow/penguin-harness/pull/481) made, applied to the
documentation site.
