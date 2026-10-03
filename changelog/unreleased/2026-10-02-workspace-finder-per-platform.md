# The Workspace finder adapts to the machine it browses

- **Date:** 2026-10-02
- **Type:** feature
- **Scope:** `web`, `server`, `docs`

[中文版](2026-10-02-workspace-finder-per-platform.zh.md)

The Workspace finder's sidebar now shows what the browsed machine's own file manager would:
Windows drives with their names, macOS volumes, the Linux root and its mounts, and standard
folders found by that machine's own rules. Drive switching is one click from the address bar, and
a drive can be typed as `D:`.

## Details

- **Locations.** The section after Quick access is **This PC** on Windows and **Locations** on
  macOS and Linux. Windows drives are named as Explorer names them — `Windows (C:)`, or by type
  when the volume has no label (Local Disk, USB Drive, Network Drive, CD Drive), and an unnamed
  network drive by its share (`\\nas\media (Z:)`). macOS lists the volumes under `/Volumes`, the
  startup disk first. Linux lists **File System** (`/`) and the mounts under `/media`,
  `/run/media` and `/mnt`; under WSL that is where the Windows drives are, named `C:` and so on.
- **The address bar** has a drop-down beside its root (`C:`, `/`) listing the same locations, so
  switching drives takes one click even on a narrow window where the sidebar is a drawer. Typing a
  bare drive (`d:`) opens that drive's root.
- **Standard folders** come from the machine: Windows' known folders (a Desktop or Documents moved
  into OneDrive is found), Linux's XDG user directories (`~/桌面`, `~/文档` on a Chinese desktop),
  macOS's fixed names. A machine browsed over ssh is still matched by English names.
- **Freshness and time limits.** Places are fetched again on every open, so a USB drive plugged in
  meanwhile appears. Discovery runs with a time limit and a short cache; a disconnected network
  drive no longer holds the dialog, and the folder list never waits for it.
- **Hidden items on Windows.** Entries with the hidden attribute are left out, as in Explorer:
  `AppData`, `NTUSER.DAT`, `$Recycle.Bin` and the legacy profile links such as `Application Data`,
  which refused to open when clicked.
- **Keys.** Off the Mac, Ctrl+L, Alt+D and F4 edit the address, as in Explorer and the Linux file
  managers. F5 refreshes the folder instead of reloading the app.
- **API.** `GET /api/projects/:p/dirs` drops `roots`; the home request with `places=1` returns
  `standardFolders` and `locations`, and Windows listings mark `hidden` entries. The Server API
  docs describe the new fields.
