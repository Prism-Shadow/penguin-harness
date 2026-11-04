# A Penguin Remote session counts as the person's sign-in

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `server`, `docs`
- **PR:** [#1337](https://github.com/Prism-Shadow/penguin-harness/pull/1337)

[中文版](2026-10-26-remote-session-counts-as-person.zh.md)

A browser reached through Penguin Remote could not generate a Chrome pairing code: the server refused it with `human_required` ("Sign in with your password to do this; an API token or its Remote session cannot."), because the one-hour session Penguin Remote exchanges the local API token for (`POST /api/remote/session`, see [the exchange](../0.2.16/2026-10-14-remote-session-exchange.md)) carried the token's authority. That session now counts as the person's sign-in, so the Web App behaves through Penguin Remote as it does when signed in locally.

## Details

- `/api/me` reports the session as `sessionVia: "remote"` instead of `"token"`; `"token"` now means only the local API token sent as a Bearer header.
- Every write that takes a person's sign-in accepts the Remote session: pairing a Chrome, choosing the browser backend, an agent's API switch, keyless access, approval mode, keys and Try it, and the admin's `agentApiEnabled`. The Bearer token is still refused with `403` `human_required`, whose message now reads "This takes a person's sign-in; the local API token cannot do it."
- The identity rules treat the Remote session like any cookie session: a `sessionId` or `agentId` it sends is not taken as an agent's claim, a run it starts records the admin as its driver, and the browser routes act for the admin and honour the `projectId` the Web App sends.
- Unchanged: only a Bearer may call `POST /api/remote/session`, so a Remote cookie still cannot mint another session; the session still expires one hour after it was issued; it opens no route reserved for the desktop app's own window; and a password change from it still needs the current password.
- An agent that holds the local API token can exchange it for a Remote session and pass these checks. The security and server API docs state this alongside the token's existing limits, which are a narrowing, not a boundary.
