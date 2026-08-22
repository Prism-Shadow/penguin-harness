# System settings dialog

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#369](https://github.com/Prism-Shadow/penguin-harness/pull/369)

[中文版](2026-08-20-system-settings-page.zh.md)

Merged the settings that sat as separate rows and dialogs in the sidebar user menu into one **System settings dialog**, opened from the menu's single remaining System settings row: a left rail of pages — grouped Personal / Server — with each page a list of title-and-description rows. The rail, pages and row layout follow the Project-settings-style paged dialog; the shell is a reusable `PagedDialog` component. The old `/settings/:section` and `/admin/users` routes were removed along with the standalone settings page.

## Pages

- **Personal → General** — interface language, display currency, and the per-user **Show CLI sessions** switch; each applies the moment it is touched, as in the menu.
- **Personal → Appearance** — app theme, terminal theme, font size and accent color, moved out of the user menu unchanged.
- **Personal → Account** — the Change password action; the page exists only where a password exists to change (the desktop shell's own window never sees one).
- **Server → Proxy options / Upload limits** — admin only; both kept their single-PUT save, inline rejections, and follow-up behavior from the previous settings page.
- **Server → Updates** — the manual check-for-updates action with the running version and its release-date hint, and — once a newer release is known — the entry into the update dialog. Hidden in desktop mode, where updating is the shell's job. The user menu keeps the reminder: its dot and a "New version available" row that opens this page directly.
- **Server → Users** — user management (list / create / reset password / delete), moved off its own route into the dialog; admin only and absent in desktop mode.

## Terminal theme follows the app by default

The terminal theme's default changed from pinned dark to **follow the app theme**: with nothing chosen, switching the app light/dark carries the terminal along. An explicitly saved light/dark choice is untouched — an absent stored value reads as "follow", and pinning either mode still decouples the two.

## Details

- Page visibility is one registry consulted by both the rail and the landing-page request, so a non-admin asking for an admin page lands on their own first page — the same answer an unknown request gets — and is never told the page exists. The admin APIs answer 403 regardless.
- The desktop shell's window drops the Account, Updates and Users pages (token session, shell-owned updates, single-user server); a password session against the same desktop-mode server keeps Account.
- No server change: the surfaces moved, the endpoints behind them did not.
- The Web App reference's System Settings chapter now describes the dialog and its pages, and the Version-and-Updates chapter points at the Updates page.
