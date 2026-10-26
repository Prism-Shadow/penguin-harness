# Backward compatibility

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1336](https://github.com/Prism-Shadow/penguin-harness/pull/1336)

[中文版](2026-10-26-backward-compatibility.zh.md)

## An `Origin` a Penguin Remote hop rewrote to `http://`

A desktop released before [the public origin](2026-10-26-oauth-callback-port.md) trusts no proxy and compares a write's `Origin` with the request's own origin: the connection's scheme, plain HTTP, with its `Host`. So that those desktops take writes through Penguin Remote, a hop of the relay, today the Penguin Remote client on the user's machine, rewrites a browser `Origin` of `https://u<N>.go.penguin.ooo` to `http://u<N>.go.penguin.ooo` when it names the tunnel's own host. A server with the public origin expects `https://`, so it accepts the request's own origin as well, and keeps working behind that rewrite.

### Scope

The origin check on writes (`/api/*` and `/server/*`), on the API socket and terminal WebSocket handshakes, and on a workbench's handler. Without a trusted proxy the two origins are the same, and nothing changes.

### What you need to do

Nothing on a desktop. The Penguin Remote client keeps the rewrite while desktops from before this change connect through the relay.

### Lifetime

Before 0.3.0, the Penguin Remote client stops rewriting `Origin` and instead sets `X-Forwarded-Proto: https` and `X-Forwarded-Host: <public host>`, overwriting any value already there. In 0.3.0 the server maintainers delete the acceptance of the request's own origin (`acceptsOrigin` in `packages/server/src/http/public-origin.ts`), and the check accepts the public origin alone.
