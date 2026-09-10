# 本批次的向后兼容

- **Date:** 2026-09-09
- **Type:** compatibility
- **Scope:** `server`
- **PR:** [#656](https://github.com/Myriad-Dreamin/penguin-harness/pull/656)

[English](2026-09-09-backward-compatibility.md)

## /api/auth 与 /api/desktop 的回滚副本

**保留了什么：** HMR 层仍挂着 `/api/auth` 与 `/api/desktop`——放在接缝之下，只在运行中的平台拒绝该前缀时应答。

**为什么：** 早于[这次搬迁](2026-09-09-hmr-layer-http-surface.zh.md)的平台会拒绝这两个前缀。在带有本改动的层上回滚到那样的平台，安装会因此失去登录，桌面 shell 失去停机接口。

**生效范围：** 每个带有本层的安装；用户无需动手。更新的平台跑在更旧的层上不受影响——那样的层自己在接缝之上应答这些前缀。

**何时移除：** 不再可能回滚到早于这次搬迁的平台之后，即本版本之后再发布一个版本、它成为部署可持有的最旧版本时。届时从 `createHmrApp`（`packages/server/src/app.ts`）删去副本，并删掉接缝测试里固定它们的用例。

## `runtime:*` 资源 id，作为别名

**保留了什么：** HMR 层把每个能力与停放条目同时注册在新 id 与旧的 `runtime:…` id 下（`packages/server/src/hmr/capabilities.ts` 里的 `publish`），平台先认领新 id、再认领旧 id（`claimAny`）。对照表是 `LEGACY_RESOURCE_IDS`。

**为什么：** id 是两代之间的线上契约。推送到早于[改名](2026-09-09-resource-ids-say-which-layer.zh.md)的已安装层上的平台只能找到旧 id；在带有改名的层上回滚到早于改名的平台，则只会寻找旧 id。没有别名，前者会带着全新的停放状态启动（重新打印首次登录链接、重新导入插件宿主），后者会在握手时被拒绝。

**生效范围：** 每个安装；用户无需动手。

**何时移除：** 不再有早于改名的已安装层、也不再可能回滚到早于改名的平台之后，即本版本之后再发布一个版本时。届时删除 `LEGACY_RESOURCE_IDS`，把 `publish` 与 `claimAny` 折回普通的 `register` 与 `claim`，并删掉 `hmr-resources.test.ts` 里固定别名的两个用例。
