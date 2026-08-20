# Token Hub activity entry

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `web`

[中文版](2026-08-20-token-hub-activity-entry.zh.md)

Added a signed-in account-menu entry that opens the Token Hub campaign center in a separate browser tab.

## Details

- The entry uses `https://penguin.ooo/activities` by default.
- Deployments can set `VITE_TOKEN_HUB_ACTIVITY_URL` at Web App build time to use another Token Hub origin or a specific generated campaign link.
- External-link handling continues to use the system browser in the desktop app.
