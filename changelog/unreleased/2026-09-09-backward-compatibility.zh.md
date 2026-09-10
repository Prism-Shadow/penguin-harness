# 本批次的向后兼容

- **Date:** 2026-09-09
- **Type:** compatibility
- **Scope:** `server`
- **PR:** [#656](https://github.com/Prism-Shadow/penguin-harness/pull/656)

[English](2026-09-09-backward-compatibility.md)

两项都无需用户动手。两项都在本版本之后再发布一个版本时移除——届时不再有早于本批次的已安装层，也不再可能回滚到早于本批次的平台。

**`/api/auth` 与 `/api/desktop` 的回滚副本。** HMR 层仍在接缝之下挂着这两组路由，只在运行中的平台拒绝该前缀时应答——早于本批次的平台正是如此。届时从 `createHmrApp`（`packages/server/src/app.ts`）删去副本，并删掉接缝测试里固定它们的用例。

**`runtime:*` 资源 id。** 层把每个条目同时注册在新旧 id 下（`publish`），平台先认领新 id 再认领旧 id（`claimAny`）；否则推送到旧层会带着全新的停放状态启动，回滚到旧平台会在握手时被拒绝。届时删除 `packages/server/src/hmr/capabilities.ts` 里的 `LEGACY_RESOURCE_IDS`，把两个辅助函数折回 `register` 与 `claim`，并删掉 `hmr-resources.test.ts` 里的两个别名用例。
