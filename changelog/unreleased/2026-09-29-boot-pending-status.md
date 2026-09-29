# Web App: a page that is still signing in says so instead of staying black

- **Date:** 2026-09-29
- **Type:** fix
- **Scope:** `web`

[中文版](2026-09-29-boot-pending-status.zh.md)

Every page load passed through a window with nothing on screen: the app had mounted, but while `GET /api/me` was still in flight the auth guard rendered nothing, so the dark theme showed its bare pure-black body. Over a slow link that lasted seconds, on every page, and looked like a dead app. The guard now shows a centred "Loading…" status for that wait.

## Details

- Both auth guards (the app shell's and the bare one used by `/terminal` and full-page workflows) render the status instead of `null`.
- It fades in only after 400 ms, so a fast load goes straight to the page without a word blinking in; with reduced motion it is shown at once. It is a `role="status"` region, announced to screen readers.
- The white frame before the stylesheet and the script arrive is unchanged.
