# The provider key-minting redirect completes in the desktop app

- **Date:** 2026-08-26
- **Type:** fix
- **Scope:** `server`, `docs`
- **PR:** [#502](https://github.com/Prism-Shadow/penguin-harness/pull/502)

[中文版](2026-08-26-model-oauth-desktop-callback.zh.md)

TokenDance's **Authorize key** action failed in the desktop app with `unauthorized` — "Not signed in or the sign-in has expired." — while the same action completed in the browser. Every desktop authorization had been ending on a 401 before the handler ran: the authorization page opened in the system browser, and the provider redirected *that* browser back to `http://localhost:<port>`, where it carried no `penguin_session` cookie. The redirect receiver stopped requiring a session — and stopped redeeming anything on its own, so that the route answering without one never gained the authority to write a credential.

## Details

- Mounted `GET /api/projects/:projectId/model-oauth/callback` ahead of the global auth middleware, so it authorizes on the flow id rather than a session cookie: 32 random bytes minted server-side, bound to a user, a Project, a provider and a PKCE verifier that never leaves the process, and good for ten minutes.
- Split the redemption in two. The receiver deposits the code on the flow and answers "Authorization received"; the exchange with the provider and the write into the Project's models moved onto `GET /:flowId`, the owner's own poll, which stayed behind the auth gate. A failed exchange reaches the dialog there as `{status: error, error}` instead of on the redirect page.
- Gave a flow one deposit slot, and refused a deposit for one opened with `mode: manual` — that mode hands out no callback URL, so a deployment that picked it had not opted into an unauthenticated receiver. The deposited code and the PKCE verifier are both claimed before the exchange's first `await`, so two redirects racing deposit once and two polls racing redeem once.
- Answered `HEAD` on the callback path with 405: Hono re-dispatches a HEAD as a GET before routing, which would otherwise have let a method HTTP requires to be safe spend the flow's deposit.
- Held the exemption to that one literal path. `/start`, `/:flowId/code` and the status route were left owner-only, and registering the literal path first keeps `:flowId` from matching `callback`.
- Deleted the unused `ModelOAuthService.providerOf`.
- Recorded the receiver, its exact scope and the two-step redemption in the Server API and Models documents, in both languages.
