# Backward compatibility in this batch

- **Date:** 2026-09-09
- **Type:** compatibility
- **Scope:** `server`
- **PR:** [#656](https://github.com/Myriad-Dreamin/penguin-harness/pull/656)

[中文版](2026-09-09-backward-compatibility.zh.md)

## Rollback copies of /api/auth and /api/desktop

**What is kept:** the HMR layer still mounts `/api/auth` and `/api/desktop` — below the seam, where they answer only when the running platform declines the prefix.

**Why:** a platform older than [the move](2026-09-09-hmr-layer-http-surface.md) declines both prefixes. Rolling back to one on a layer with this change would otherwise leave the installation without login and the desktop shell without its shutdown.

**Scope:** every installation with this layer; nothing to do by hand. A newer platform on an older layer is unaffected — that layer answers the prefixes itself, above the seam.

**Until:** no platform older than the move can be rolled back to, i.e. one released version after this one is the oldest a deployment can hold. Remove the copies from `createHmrApp` (`packages/server/src/app.ts`) and the seam test that pins them.
