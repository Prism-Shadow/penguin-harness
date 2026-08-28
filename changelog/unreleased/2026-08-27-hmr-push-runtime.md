# A push carries the runtime too, taken up at the next start

- **Date:** 2026-08-27
- **Type:** feature
- **Scope:** `server`, `tooling`

[中文版](2026-08-27-hmr-push-runtime.zh.md)

A hot push carried the platform, the CLI and the web dist. It could not carry the runtime — the server executing all three — so a machine's runtime only ever advanced by installing a published release. `POST /api/hmr/upgrade` now accepts a fourth artifact, `runtime`, committed to the store with the rest and adopted at the next start.

## Details

- The runtime is the one artifact the receiving process cannot adopt: it IS that process. So it is content-addressed into `store/runtime/` and pointed at by `harness.json`'s new `runtime` field, and the packaged entry asks `hmr/launch.ts` before anything else starts — importing the pushed bundle when the store names one, becoming the process.
- A push carrying a runtime this process is not running answers `restartRequired: true` alongside `persisted`. The push is complete on disk and pending in effect; nothing restarts on its own, because a restart drops every connection the server is holding. `scripts/deploy.mjs` says so on the summary line.
- A push that carries no runtime leaves the committed pointer in place. Dropping it would return the machine to its packaged runtime at the next start — a downgrade nobody asked for.
- Every failure in the launcher falls back to the packaged runtime and says why: a missing file, a manifest naming a path outside the store, a bundle that throws on import. A CLI that cannot load its bundle can exit; a server that cannot start is a machine with nothing serving, so a push must not be able to take one off the air.

## Compatibility

`runtime` is optional in both directions. An older pusher sends none and its pushes behave exactly as before; a server without this change ignores the field. A root whose `harness.json` has no `runtime` entry starts its packaged runtime, which is what every root does today.
