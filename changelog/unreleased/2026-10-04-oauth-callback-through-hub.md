# Authorizing a provider key for a model on a remote machine came back through the hub

- **Date:** 2026-10-04
- **Type:** fix
- **Scope:** `server`, `web`

[中文版](2026-10-04-oauth-callback-through-hub.zh.md)

"Authorize a new API key" for a group on a remote machine named the machine's own loopback as the provider's callback, so after approving, the browser landed on a page that never loaded.

## Changes

- **The hub says where the browser is:** every request the hub forwards to a machine (`/server/<machineId>/api/…`) carries `X-Forwarded-Host`, `X-Forwarded-Proto` (the hub's own client-facing origin, read through its trusted proxy chain when `PENGUIN_TRUST_PROXY=1`) and `X-Forwarded-Prefix: /server/<machineId>`. A caller's own values of these headers are replaced, never passed on.
- **The machine believes it only from its hub:** a machine honours those headers only on a session minted from its data root (`penguin auth token`, which is how the hub signs in there) or behind its own trusted proxy. The callback becomes `<hub origin>/server/<machineId>/api/projects/<project>/model-oauth/callback?flow=…`. A browser's own session gets the request's own origin, whatever headers it sends.
- **The redirect gets through the hub without a session:** `GET /server/<machineId>/api/projects/<project>/model-oauth/callback` is forwarded without the hub's session — the system browser on the desktop holds none — as a bare GET; the machine's route only deposits the code, and the owner's poll still goes through the authenticated proxy. Every other proxied path still needs a session.
- **The API socket uses the page's host:** calls on the API socket are now made under the host and port the page addressed (honouring `X-Forwarded-*` behind a trusted proxy) instead of a bare `http://localhost`, so a callback started over the socket names the right port.
- **Fallback to the code:** when a machine is reached through a hub that names no browser host (an older hub), the start opens the flow in manual mode and answers `mode: "manual"`; the dialog switches to the one-time code field and says why. When the person comes back from the authorization page and nothing has arrived after a few seconds, the dialog offers to enter the code instead.
- The authorization dialog moved out of `models-page.tsx` into `model-oauth-dialog.tsx`.
