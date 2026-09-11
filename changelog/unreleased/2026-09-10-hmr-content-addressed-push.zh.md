# 推送按哈希指名各部分、只上传目标缺少的 blob，未引用的 blob 会被回收

- **Date:** 2026-09-10
- **Type:** feature
- **Scope:** `hmr`, `server`, `tooling`
- **PR:** [#656](https://github.com/Prism-Shadow/penguin-harness/pull/656)

[English](2026-09-10-hmr-content-addressed-push.md)

热推送原本每次都把所有部分内联带上——两个 bundle、整个 web dist、全部原生资产，以 base64 塞进一个 gzip JSON body——不管目标是否已经持有。现在存储按内容寻址，推送的做法和 `git push` 一样：先问目标缺什么，只上传缺的，然后一切以哈希指名。

## blob 逐个、原样上传

`store/blobs/<sha256>` 每份不同内容只存一次。`PUT /api/hmr/blobs/<sha256>` 以原始 body 收一个 blob，边落盘边算哈希：内容对不上名字的字节会被丢弃，绝不以一个承诺了别的内容的名字存下；已持有的 blob 原样保留。`POST /api/hmr/assets/probe { hashes }` 回答目标缺哪些 blob。两者和推送一样属于机制层：`HMR_PROBE_PATH`、`HMR_BLOBS_PATH`、`probeEndpoint` 与 `blobEndpoint` 在 `packages/hmr` 中，平台的路由把请求交给控制对象。

## 推送按哈希指名各部分

`platform`、`cli`、`web.manifest` 与 `assets.manifest` 的每一项都可以写成 `{ sha }` 而不是内联内容；升级在任何东西启动之前先从存储解析它们，指名了存储里没有的 blob 会被拒绝并给出哈希和该做什么，绝不物化成一个洞。`scripts/deploy.mjs` 先探测、上传缺失的 blob，再推送一个只有名字的 body，于是一次推送只传上次之后变化的部分：配合 vite 带内容哈希的 chunk 名，改一行 web 代码只传一个 chunk。物化出的资产目录记录所用的 blob（`.manifest.json`）。没有探测端点的目标——比这更老的代际——回应 404，于是收到全部内联内容，和它一直以来收到的推送完全一样。

## 清理未使用的资产

存储原本就只保留当前与一个回滚的资产集合；现在在此之后还会清扫 blob：任何剩余集合都未记录的 blob 会被删除，半写的临时文件也一并清除。记录出现之前物化的集合不通过 blob 存储维持任何东西的存活，其自身也不受影响。
