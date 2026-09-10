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

## The `runtime:*` resource ids, as aliases

**What is kept:** the HMR layer registers every capability and parked entry under its new id and its old `runtime:…` id (`publish` in `packages/server/src/hmr/capabilities.ts`), and a platform claims the new id first, then the old one (`claimAny`). The map is `LEGACY_RESOURCE_IDS`.

**Why:** an id is a wire contract between generations. A platform pushed onto an installed layer built before [the rename](2026-09-09-resource-ids-say-which-layer.md) finds only the old ids; a platform older than the rename, rolled back to on a layer with it, looks only for the old ids. Without the aliases the first would boot with fresh parked state (a reprinted first-login link, a re-imported plugin host) and the second would be refused at the handshake.

**Scope:** every installation; nothing to do by hand.

**Until:** no installed layer and no platform a deployment can roll back to predates the rename — one released version after this one. Remove `LEGACY_RESOURCE_IDS`, fold `publish` and `claimAny` back into plain `register` and `claim`, and drop the two tests that pin the aliases in `hmr-resources.test.ts`.
