# The avatar menu's update row becomes an App info dialog

- **Date:** 2026-10-02
- **Type:** feature
- **Scope:** `web`, `docs`, `skills`
- **PR:** [#950](https://github.com/Prism-Shadow/penguin-harness/pull/950)

[中文版](2026-10-02-app-info-dialog.zh.md)

The entry under **Settings** in the avatar menu is now **About** (zh 应用信息). It opens one
dialog holding the app's identity, its links, the software update, the release notes and the
credits; the separate Software Update modal and the Settings dialog's Credits page are gone.

## Details

- **The row.** Its label is always **About**, with the running version muted on the right. While
  an update is moving or waiting, the update sentence appears under the label — Checking…,
  New version vX available (with the accent dot), Downloading vX 42%, Restart to update to vX,
  Restarting… — so the avatar badge still leads to its own words. The row is shown to every
  session, including a browser signed into a desktop-mode server, which sees the version and the
  notes but no update controls.
- **The dialog**, top to bottom: the logo, the product name, the version with its build date, and
  two links that show the address they open — **Homepage** penguin.ooo and **GitHub**
  github.com/Prism-Shadow/penguin-harness; a **Software Update** section with the same states and
  actions as the old modal, except that opening the dialog no longer forces a check — it shows
  the last known answer and **Check for updates** runs a fresh one; **What's new**, a bundled
  bilingual list of every released version from 0.1.0 to 0.2.13, newest first, one to five short
  lines each, with the running version marked **Current** — only the newest version shows, the
  rest wait under an **Earlier versions** fold; and **Credits** — the copyright line and a fold
  that opens the font and icon licences that used to be the Settings dialog's Credits page.
- **Release notes data** live in `packages/web/src/lib/release-notes-data.ts` and are written at
  release preparation beside `RELEASE.md`; no other PR edits the file. The desktop app therefore
  shows them offline.
- The docs' Updates page names the new row and the section, and the Web App, Docker and Server
  API pages call the dialog by its new name.
