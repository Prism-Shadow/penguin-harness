# Backward compatibility in this batch

- **Date:** 2026-11-19
- **Type:** process
- **Scope:** `server`
- **PR:** [#1644](https://github.com/Prism-Shadow/penguin-harness/pull/1644)

[中文版](2026-11-19-backward-compatibility.zh.md)

Every compatibility decision of this batch is recorded here once; the feature entries reference this file instead of re-telling it.

## Runtimes and platforms on either side of the server seams

[Code plugins reach the server through one face](2026-11-19-plugin-server-seams.md). The agent browser's extension WebSocket became a contributed `HttpModule.upgrades` endpoint, and its pairing route's exemption from the same-origin write check became the route group's own `origin: "own"`. The runtime is not pushable and a platform is, so the two can be from either side of that change:

- **An older pushed platform under a newer runtime.** A runtime restores whatever platform was pushed last, older than itself included. Such a platform serves no WebSocket endpoints and cannot say which route groups judge their own origin. For it, the runtime still looks the extension's gate up by the names `BuiltinBrowserModule` / `BrowserExtensionGate` and runs the extension's handshake over it itself. It also still exempts `POST /api/builtin-browser/extension/pair` by its path. The handshake and the origin rule are a frozen copy in `packages/server/src/hmr/legacy-browser.ts`, so the runtime imports none of the browser's code.
- **A newer platform pushed onto an older runtime.** An installed runtime from before the seams only does that name lookup. So the browser module stays named `BuiltinBrowserModule` and keeps exporting `BrowserExtensionGate` with its `admit` / `connect` shape, beside its contributed endpoint.

### Scope

Every server whose runtime and pushed platform are from different sides of this change, on the extension's WebSocket (`/api/builtin-browser/extension/ws`) and its pairing route.

### What you need to do

Nothing.

### Lifetime

The server maintainers keep both until the next major version (1.0), and remove them together in that release's preparation:

- `packages/server/src/hmr/legacy-browser.ts`, the `fallback` it fills in `hmr/upgrade-seam.ts`, and the `legacyOwnOrigin` fallback in `src/app.ts`;
- the browser module's two names, which may then be renamed.
