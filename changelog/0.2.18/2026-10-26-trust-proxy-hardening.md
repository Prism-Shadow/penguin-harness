# The origin check behind a trusted proxy reads one forwarded scheme and the raw Host

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `server`, `desktop`, `docs`
- **PR:** [#1351](https://github.com/Prism-Shadow/penguin-harness/pull/1351)

[中文版](2026-10-26-trust-proxy-hardening.zh.md)

Behind a trusted proxy (`PENGUIN_TRUST_PROXY=1`), the origin check on writes, on the API socket and terminal handshakes, and on a workbench's handler was narrowed back to what it accepted before [the public origin](2026-10-26-oauth-callback-port.md), and it now also reads the browser's `Sec-Fetch-Site`.

## Details

- Only the desktop app's server still accepts the request's own origin, the connection's scheme with its `Host`, while the Penguin Remote client rewrites `Origin` for older desktops; see [backward compatibility](2026-10-26-backward-compatibility.md). Any other server behind a TLS-terminating proxy refuses `Origin: http://<public host>` on writes and on the API socket's handshake.
- `X-Forwarded-Proto` and `X-Forwarded-Host` count only as a single value: `http` or `https`, and one bare `host[:port]`. Behind a trusted proxy, a write or handshake whose forwarded header is a list (`https, http`) or malformed is refused with `403` `cross_origin_write`, as before the public origin, and the hot-update network gate does not count such a scheme as HTTPS. An address handed back to the browser takes the request's own scheme or `Host` in place of such a header.
- The origin check compares `Origin` with the forwarded scheme and the request's own `Host`. `X-Forwarded-Host` shapes only the addresses handed back to the browser: a model provider's authorization redirect, the address a Chrome extension pairs with, and the origin of calls on the API socket.
- A write, an API socket handshake or a terminal handshake whose `Sec-Fetch-Site` is present and is not `same-origin` is refused. The Agent API's keyed writes and the browser extension's pairing request stay exempt.
- The configuration, security and server API pages give the proxy contract: keep `Host`, overwrite `X-Forwarded-Proto` with one value, overwrite or strip `X-Forwarded-Host`, and serve the host with HSTS. They state that the transition applies to the desktop only, and which pages can reach the desktop's loopback port and what keeps them out.
