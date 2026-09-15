# A used-up sign-in link lands on the login page instead of a JSON error

- **Date:** 2026-09-11
- **Type:** fix
- **Scope:** `server`, `web`, `docs`
- **PR:** [#690](https://github.com/Prism-Shadow/penguin-harness/pull/690)

[中文版](2026-09-11-claim-link-failure.zh.md)

Opening a one-time sign-in link that had already been used, or had expired, answered the
browser with `{"error":{"code":"unauthorized",…}}` and left the visitor on a page of raw JSON
with nothing to act on. `GET /api/auth/claim` now redirects such a claim to `/login`, where
the Web App raises a dialog over the ordinary sign-in form explaining what happened and how to
get a working link.

## Details

- The redirect carries `?claimFailed=desktop` or `?claimFailed=server`, decided by whether the
  server was started by the desktop shell. The desktop copy says to restart the app, which
  issues a fresh link and signs the window in; the server copy points at the password form and
  at whoever runs the server. Both token kinds — the shell's one-shot token and the first-login
  link — still produce byte-identical refusals on a given server.
- The login page clears the parameter with a history replace once the dialog is up, so a reload
  does not raise it again and a copied address does not carry it.
- `server-api` documents the failure redirect alongside the success one.
