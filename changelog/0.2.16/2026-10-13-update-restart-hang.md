# Desktop: "Restart and update" restarts the app instead of spinning forever

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `desktop`, `web`
- **PR:** [#1092](https://github.com/Prism-Shadow/penguin-harness/pull/1092)

[中文版](2026-10-13-update-restart-hang.zh.md)

On macOS, "Restart and update" in the desktop app now quits and relaunches into the downloaded
version. The window used to hide into the tray instead of closing, the restart was never made,
and the App info dialog spun on "Restarting…" for as long as the window stayed open.

## Details

- An update's restart counts as quitting from the moment the updater announces it, so the
  window's close goes through even with "Keep running in the tray when the window closes" on.
- In the desktop window, a restart that has not taken the window away after 90 seconds stops
  spinning: the dialog says PenguinHarness did not restart, and "Restart and update" is offered
  again.

## Updating from an earlier version

The restart is made by the version being replaced, so an update started from 0.2.12 through 0.2.15
on macOS still stops at "Restarting…". Quit PenguinHarness from its menu-bar icon (Quit) or with
⌘Q: the update installs as the app quits. Open it again if it does not reopen by itself, and if
it still reports the old version, install the new one from the Releases page. Unticking "Keep
running in the tray when the window closes" in the menu-bar icon's menu before clicking "Restart
and update" avoids the stop.
