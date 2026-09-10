# Backward compatibility in this batch

- **Date:** 2026-09-09
- **Type:** compatibility
- **Scope:** `server`
- **PR:** [#656](https://github.com/Prism-Shadow/penguin-harness/pull/656)

[中文版](2026-09-09-backward-compatibility.zh.md)

Nothing to do by hand. It goes one released version after this one, once no platform a deployment can roll back to predates this batch.

**Rollback copies of `/api/auth` and `/api/desktop`.** The HMR layer still mounts both groups below its seam, where they answer only when the running platform declines the prefix — as a platform older than this batch does. Remove them from `createHmrApp` (`packages/server/src/app.ts`) and the seam test that pins them.
