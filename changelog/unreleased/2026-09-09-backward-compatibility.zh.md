# 本批次的向后兼容

- **Date:** 2026-09-09
- **Type:** compatibility
- **Scope:** `server`
- **PR:** [#656](https://github.com/Prism-Shadow/penguin-harness/pull/656)

[English](2026-09-09-backward-compatibility.md)

无需用户动手。在本版本之后再发布一个版本时移除——届时不再可能回滚到早于本批次的平台。

**`/api/auth` 与 `/api/desktop` 的回滚副本。** HMR 层仍在接缝之下挂着这两组路由，只在运行中的平台拒绝该前缀时应答——早于本批次的平台正是如此。届时从 `createHmrApp`（`packages/server/src/app.ts`）删去副本，并删掉接缝测试里固定它们的用例。
