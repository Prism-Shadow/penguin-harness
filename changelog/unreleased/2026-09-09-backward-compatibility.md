# Backward compatibility in this batch

- **Date:** 2026-09-09
- **Type:** compatibility
- **Scope:** `server`
- **PR:** [#656](https://github.com/Prism-Shadow/penguin-harness/pull/656)

[中文版](2026-09-09-backward-compatibility.zh.md)

Nothing to do by hand for either item. Both go one released version after this one, once no installed layer and no platform a deployment can roll back to predates this batch.

**Rollback copies of `/api/auth` and `/api/desktop`.** The HMR layer still mounts both groups below its seam, where they answer only when the running platform declines the prefix — as a platform older than this batch does. Remove them from `createHmrApp` (`packages/server/src/app.ts`) and the seam test that pins them.

**The `runtime:*` resource ids.** The layer registers every entry under its new id and its old one (`publish`), and a platform claims new-then-old (`claimAny`); without that, a push onto an older layer would boot with fresh parked state and a rollback to an older platform would be refused at the handshake. Remove `LEGACY_RESOURCE_IDS` in `packages/server/src/hmr/capabilities.ts`, fold the two helpers back into `register` and `claim`, and drop the two alias tests in `hmr-resources.test.ts`.
