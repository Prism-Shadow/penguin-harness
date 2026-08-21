# Update check moved out of System settings, into the account menu

- **Date:** 2026-08-21
- **Type:** feature
- **Scope:** `web`, `docs`

[中文版](2026-08-21-update-check-out-of-settings.zh.md)

Moved checking for updates out of the System settings dialog and into the sidebar user menu, on the row directly under the **System settings** entry. The dialog's **Updates** page ([System settings dialog](2026-08-20-system-settings-page.md)) was removed, and the web and desktop update rows now share one slot outside the dialog, so an update is one click from the menu instead of two clicks and a page.

## Details

- The menu's server-update row carries the manual check itself: it reads "check for updates" and runs the forced lookup until a newer release is known, then names that release in place and opens the update dialog — the release-notes link and the admin-only self-update — instead of routing into a settings page. Each check still reports exactly one outcome as a toast.
- The row shows the running server version on its right, matching the desktop client row it stands beside; the release date it used to carry as a hint stays on the new-chat page's version line, which has room for it.
- Both rows keep their existing gates and are mutually exclusive: the server row is hidden in desktop mode, the client row appears only in the shell's own window, and a browser signed into a desktop-mode server gets neither.
- The lazy check is unchanged — nothing is fetched until the user menu is first opened — and so are the avatar's reminder dot, the draft page's "New version available" badge, and the confirmed restart-to-install step of the desktop row.
- The check state and both dialogs are held by the sidebar rather than by the rows, which unmount with the menu, so a check clicked in the menu still settles and still toasts after the menu closes.
- A non-admin outside desktop mode is now left with the Personal pages alone, so the settings rail draws no group headings for them.
- The Web App guide's System Settings and Version-and-Updates chapters were rewritten for the new placement, in both languages.
