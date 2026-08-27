# The provider key-minting redirect completes in the desktop app

- **Date:** 2026-08-26
- **Type:** fix
- **Scope:** `server`, `docs`

[中文版](2026-08-26-model-oauth-desktop-callback.zh.md)

TokenDance's **Authorize key** action failed in the desktop app with `unauthorized` — "Not signed in or the sign-in has expired." — while the same action completed in the browser. The redirect receiver no longer requires a session, so the flow now finishes in both.

## Details

- `GET /api/projects/:projectId/model-oauth/callback` is mounted ahead of the global auth middleware and authorizes on the flow id instead of a session cookie. The desktop shell hands every non-app URL to `shell.openExternal`, so the authorization page opens in the system browser, and the provider redirects *that* browser back to `http://localhost:<port>`, where it holds no `penguin_session` cookie; behind the auth gate every desktop authorization ended on a 401 before the handler ran.
- `ModelOAuthService.complete` accepts a null `userId`, which waives the flow's user check and nothing else. The request must still name the flow's own Project, arrive inside the ten-minute TTL, and be the flow's first redemption — and the flow id it presents is 32 random bytes minted server-side, bound to a PKCE verifier that never leaves the process.
- The exemption is exactly that one literal path and `GET`. `/start`, `/:flowId/code` and the status route are unchanged and still owner-only; a longer path under `/callback`, and any other method on it, are still behind the gate. Registering the literal path first also keeps the `:flowId` status route from matching `callback`.
- A signed-in browser tab completing the same callback is unaffected: the cookie is simply not consulted there.
- The Server API document records the exemption and its exact scope in both languages.
