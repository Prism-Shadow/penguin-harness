# Backward compatibility

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1336](https://github.com/Prism-Shadow/penguin-harness/pull/1336)

[中文版](2026-10-26-backward-compatibility.zh.md)

## An `Origin` the Penguin Remote relay rewrote to `http://`

A desktop released before [the public origin](2026-10-26-oauth-callback-port.md) trusts no proxy and compares a write's `Origin` with the request's own origin: the connection's scheme, plain HTTP, with its `Host`. To let those desktops take writes through Penguin Remote, the relay rewrites the browser's `https://u<N>.go.penguin.ooo` Origin to `http://u<N>.go.penguin.ooo`. A server with the public origin expects `https://`, so it accepts the request's own origin as well, and keeps working behind that rewrite.

### Scope

The origin check on writes (`/api/*` and `/server/*`), on the API socket and terminal WebSocket handshakes, and on a workbench's handler. Without a trusted proxy the two origins are the same, and nothing changes.

### What you need to do

Nothing on a desktop. The relay keeps the rewrite while desktops from before this change connect through it.

### Lifetime

The relay's maintainers drop the rewrite once every desktop that connects through Penguin Remote runs a release with this change. In the release after that, the server maintainers remove the acceptance of the request's own origin (`acceptsOrigin` in `packages/server/src/http/public-origin.ts`), and the check accepts the public origin alone.
