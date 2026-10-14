# Local API token can issue short remote browser sessions

- **Date:** 2026-10-14
- **Type:** feature
- **Scope:** `server`
- **PR:** [#1139](https://github.com/Prism-Shadow/penguin-harness/pull/1139)

[中文版](2026-10-14-remote-session-exchange.zh.md)

Penguin Remote gained an endpoint to exchange the machine-local Harness API token for a short-lived browser session token. The protected endpoint returned the cookie name, raw session token, expiry timestamp and max age for a one-hour session, leaving the remote proxy to set the public-domain cookie itself.

## Details

- `POST /api/remote/session` accepted requests authenticated by the existing local API token Bearer path. Password, desktop, first-login setup and Remote cookie sessions were refused.
- Refused cookie requests neither renewed the session nor set a cookie; ordinary API requests retained their existing sliding renewal.
- The issued browser session was stored through the normal auth-session repository with an internal `remote` source marker. Its public `sessionVia` stayed `token`, preserving the local API token’s human-only write restrictions and Agent identity rules. Sensitive writes required a separate password login.
- Token-only routes required an actual Bearer header even after an outer route authenticated a Remote cookie; an exchanged session could not mint another session.
