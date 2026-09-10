# 推送只传目标缺少的 blob，未引用的 blob 会被回收

- **Date:** 2026-09-10
- **Type:** feature
- **Scope:** `hmr`, `server`, `tooling`
- **PR:** [#656](https://github.com/Prism-Shadow/penguin-harness/pull/656)

[English](2026-09-10-hmr-content-addressed-push.md)

热推送原本每次都把全部原生资产内联带上，不管目标是否已经持有。现在目标上的资产按内容寻址，推送方只发目标缺少的部分。

## 推送只传目标缺少的部分

`store/blobs/<sha256>` 每份不同内容只存一次，物化出的资产目录由这些 blob 组装而成并记录所用（`.manifest.json`）。推送前 `scripts/deploy.mjs` 用 `POST /api/hmr/assets/probe { hashes }` 询问目标缺哪些 blob，只发这些，其余以哈希指名（`assets.manifest` + `assets.blobs`）。探测和推送一样属于机制层：`HMR_PROBE_PATH` 与 `probeEndpoint` 在 `packages/hmr` 中，平台的路由把请求交给控制对象。清单指名了存储里没有的 blob 会被拒绝并给出说明，绝不物化成一个洞。没有探测端点的目标——比这更老的代际——回应 404，于是收到全部内联文件，和它一直以来收到的推送完全一样。因此未变的原生模块与技能库不会重复过线。

## 清理未使用的资产

存储原本就只保留当前与一个回滚的资产集合；现在在此之后还会清扫 blob：任何剩余集合都未记录的 blob 会被删除，半写的临时文件也一并清除。记录出现之前物化的集合不通过 blob 存储维持任何东西的存活，其自身也不受影响。
