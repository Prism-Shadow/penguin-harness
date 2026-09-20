# Two instances on one host stay signed in, and a write must come from this app's own pages

- **Date:** 2026-09-19
- **Type:** fix
- **Scope:** `server`, `cli`
- **PR:** [#800](https://github.com/Prism-Shadow/penguin-harness/pull/800)

[中文版](2026-09-19-origin-guard-instance-cookie.zh.md)

**Signing in to one instance no longer signs the other out.** Cookies are scoped to a host and ignore the port, so two instances reached on the same host — a release and a development build, or two tunnels opened on a phone — shared the `penguin_session` cookie, and each sign-in overwrote the other's. A browser is now given the cookie under a name that carries the port it reached the server on (`penguin_session_<port>`); signing out clears only this server's own sessions. A client that is not a browser — the CLI, a server speaking to a machine it holds — has a cookie jar of its own and keeps the plain name, so an older CLI works against a newer server. The plain name is still accepted from a browser, so nobody is signed out by the upgrade; a browser that was already signed in keeps sharing that one cookie until it signs in again.

**A write must come from a page of this origin.** Every `POST`, `PUT`, `PATCH` and `DELETE` under `/api` that carries an `Origin` header is refused with `403 cross_origin_write` unless that origin is this server's own — host and port, the rule the terminal's WebSocket handshake already applied and now shares. `SameSite` alone does not cover it: another port of the same host is the same site, so a page served by any other local program could ride the session. A request with no `Origin` is not a browser's and is unaffected (the CLI, scripts, a hot push).

**A write with a body and no Content-Type is refused (`415`).** The content-type rule let a request with no Content-Type through on the assumption that it had no body; a page can send one (`fetch` with an untyped `Blob` and `mode: "no-cors"`), and the handlers parsed it as JSON without asking.
