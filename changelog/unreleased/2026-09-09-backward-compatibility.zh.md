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
