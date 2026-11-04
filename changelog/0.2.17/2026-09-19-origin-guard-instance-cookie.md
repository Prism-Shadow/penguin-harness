# Two instances on one host stay signed in, and a write must come from this app's own pages

- **Date:** 2026-09-19
- **Type:** fix
- **Scope:** `server`, `cli`
- **PR:** [#1268](https://github.com/Prism-Shadow/penguin-harness/pull/1268)
- **Breaking:** yes — behind a TLS-terminating reverse proxy, every write from the Web App is refused `403 cross_origin_write` unless the server runs with `PENGUIN_TRUST_PROXY=1` and the proxy keeps the external `Host`

[中文版](2026-09-19-origin-guard-instance-cookie.zh.md)

**Signing in to one instance no longer signs the other out.** Cookies are scoped to a host and ignore the port, so two instances reached on the same host — a release and a development build, or two tunnels opened on a phone — shared the `penguin_session` cookie, and each sign-in overwrote the other's. A browser is now given the cookie under a name that carries the port it reached the server on (`penguin_session_<port>`); signing out clears only this server's own sessions. A client that is not a browser — the CLI, a server speaking to a machine it holds — has a cookie jar of its own and keeps the plain name, so an older CLI works against a newer server. The plain name is still accepted from a browser, so nobody is signed out by the upgrade; a browser that was already signed in keeps sharing that one cookie until it signs in again.

**A write must come from a page of this origin.** Every `POST`, `PUT`, `PATCH` and `DELETE` under `/api` that carries an `Origin` header is refused with `403 cross_origin_write` unless that origin is this server's own — scheme, host and port, the rule the terminal's WebSocket handshake already applied and now shares. `SameSite` alone does not cover it: another port of the same host is the same site, so a page served by any other local program could ride the session. Origins are compared after URL normalization: a domain's case and a scheme's default port (`http://example.com` and `http://example.com:80`) are not a difference. Behind a TLS-terminating proxy, the forwarded scheme is honored only when `trustProxy` is enabled; the proxy must preserve the external host and overwrite `X-Forwarded-Proto` with `http` or `https`. A request with no `Origin` is not a browser's and is unaffected (the CLI, scripts, a hot push). The Agent API is the one exception: `/api/amsp/v1` answers any origin's preflight and serves a caller that presents an agent key as a `Bearer`, so a keyed write there is left to the group's own gate — which never accepts a cookie — while a cookie-bearing or credential-less one is still refused.

**A write with a body and no Content-Type is refused (`415`).** The content-type rule let a request with no Content-Type through on the assumption that it had no body; a page can send one (`fetch` with an untyped `Blob` and `mode: "no-cors"`), and the handlers parsed it as JSON without asking. A workbench's own handler is the exception: it takes any body — an upload, or a form of a program it relays — so what guards it is the browser's own account of where the request came from (`Sec-Fetch-Site`, and `Origin` against the request URL's origin), on every method rather than only on writes.

## Compatibility

- Behind a reverse proxy that terminates TLS, start the server with `PENGUIN_TRUST_PROXY=1`, have the proxy keep the external `Host` header and overwrite `X-Forwarded-Proto` with `https`. Without that, the page's `https://` origin does not match the plain-HTTP request the server receives, and every write from the Web App is refused with `403 cross_origin_write`. A proxy that rewrites `Host` is refused the same way.
- The origin rule leaves requests without an `Origin` header (the CLI, scripts) and the Agent API's keyed calls alone.
- A write that sends a body without a `Content-Type` is refused with `415 unsupported_media_type`. Send `Content-Type: application/json`.
