# Local API token can issue short remote browser sessions

- **Date:** 2026-10-14
- **Type:** feature
- **Scope:** `server`
- **PR:** [#1139](https://github.com/Prism-Shadow/penguin-harness/pull/1139)

[中文版](2026-10-14-remote-session-exchange.zh.md)

Penguin Remote can now exchange the machine-local Harness API token for a short-lived browser session token. The new protected endpoint returns the cookie name, raw session token, expiry timestamp and max age for a one-hour session, leaving the remote proxy to set the public-domain cookie itself.

## Details

- `POST /api/remote/session` only accepts requests authenticated by the existing local API token Bearer path. Password, desktop and first-login setup cookie sessions are refused.
- Refused cookie requests neither renew the session nor set a cookie; ordinary API requests retain their existing sliding renewal.
- The issued browser session is stored through the normal auth-session repository with an internal `remote` source marker, so later audit and revocation can distinguish it from ordinary password sessions.
