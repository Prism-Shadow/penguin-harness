# The server builds and checks origins on the address the browser is on

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `server`, `desktop`, `docs`
- **PR:** [#1336](https://github.com/Prism-Shadow/penguin-harness/pull/1336), [#1351](https://github.com/Prism-Shadow/penguin-harness/pull/1351)

[中文版](2026-10-26-oauth-callback-port.zh.md)

Connecting TokenDance from the Models page sent the browser, once authorized, to `http://localhost/api/projects/<project>/model-oauth/callback?…` with no port, so the redirect never reached the App, in a browser and in the desktop app alike. The start request rides the Web App's API socket, and every call on that socket was addressed to a fixed `http://localhost`. On a desktop reached through Penguin Remote (`https://u<N>.go.penguin.ooo`), the redirect named plain HTTP, and browser writes passed the origin check only because the Penguin Remote client rewrote their `Origin` to `http://`.

The server now derives one **public origin**, the address in the browser's address bar, and uses it wherever it builds or compares an origin. Behind a trusted proxy (`PENGUIN_TRUST_PROXY=1`) its scheme comes from `X-Forwarded-Proto` and its host from `X-Forwarded-Host`, else `Host`, each as a single value ([trust-proxy hardening](2026-10-26-trust-proxy-hardening.md)); otherwise it is the connection's own scheme and `Host`.

## Details

- Calls on the API socket are addressed to the public origin the socket was opened on, port included, as an HTTP request is.
- A model provider's authorization redirects back to the public origin, and the choice between redirect and one-time code is made on it: a Web App opened over plain HTTP on a LAN address gets the code step again, which the socket had turned back into a redirect to `localhost`.
- The origin check on writes, on the API socket and terminal handshakes, and on a workbench's handler accepts the public origin's scheme on the request's `Host`. On the desktop app's server it also accepts the request's own origin while a Penguin Remote hop, today its client, rewrites `Origin` for older desktops; see [backward compatibility](2026-10-26-backward-compatibility.md).
- `POST /api/builtin-browser/extension/pairings` answers `origin` with the public origin instead of echoing the request's `Origin` header.
- Session cookies are `Secure`, and the hot-update network gate sees HTTPS, when the public origin is `https`.
- The desktop app's embedded server runs with `PENGUIN_TRUST_PROXY=1`. It listens on loopback only, and through Penguin Remote it now sees the browser's `https://` address.
- The configuration, security and server API pages describe the public origin, the forwarded headers a proxy must set, and the desktop's trust.
