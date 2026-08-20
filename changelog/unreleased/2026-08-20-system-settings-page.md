# System settings page

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#369](https://github.com/Prism-Shadow/penguin-harness/pull/369)

[中文版](2026-08-20-system-settings-page.zh.md)

Merged three settings that sat as separate entries in the sidebar user menu — Proxy options, Upload limits, and the Show CLI sessions switch — into one System settings page at `/settings/:section`, with a grouped left sub-nav. The user menu kept a single **System settings** row in their place, and the two dialog components it used to open were deleted.

## Sub-pages

- **Personal → General** — the per-user **Show CLI sessions** switch, applied and persisted the moment it is touched, as it was in the menu.
- **Server → Proxy options** — admin only. The two switches and their shared address kept the single-PUT save, the inline `invalid_proxy_url` rejection and the "no changes to save" toast. A save now adopts the response as the new baseline, so the address settles into the normalized form the server stored instead of the form that was typed.
- **Server → Upload limits** — admin only. Same save path, same inline `invalid_attachment_limit` rejection, and the same `/api/me` re-pull that keeps the composer's cap in step with a raised limit.

## Details

- The Server group renders for admins alone, and a non-admin typing `/settings/proxy` is sent to their own first sub-page — the same answer an unknown segment gets, so the address bar reveals nothing about which sections exist. A viewer left with a single group gets no group headings.
- The route was registered under the existing `RequireAuth` guard. `/settings` with no segment resolves to the first sub-page the viewer may open.
- No server change: the surface moved, the admin-only `GET|PUT /api/admin/settings` endpoints behind it did not.
- The Web App reference gained a **System Settings (/settings)** chapter, which absorbed the previous Upload Limits chapter and documents the proxy sub-page for the first time.
