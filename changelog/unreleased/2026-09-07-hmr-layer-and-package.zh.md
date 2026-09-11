# HMR 层：定名、成包、只剩 /api/hmr

- **Date:** 2026-09-07
- **Type:** improvement
- **Scope:** `hmr`, `server`, `desktop`, `tooling`
- **PR:** [#656](https://github.com/Prism-Shadow/penguin-harness/pull/656)

[English](2026-09-07-hmr-layer-and-package.md)

同一个目的：让「把产品行为放进只能靠重装才能送达的地方」这件事变难。

**这一层按它所做的事命名。** 「runtime」同时也指「正在运行的那个程序」，于是进程做的任何事听起来都像属于这一层。现在它在文档与标识符里都叫 HMR 层。模块树的节点名不改。

**机制就是 `packages/hmr`。** 版本仓库、`harness.json` 的原子提交、资源注册表，以及 park → boot → swap，住在一个看不见 platform 的包里：编译进程序的那份 bundle 是构造函数参数，platform 暴露的 api 是类型参数。它的 README 承载这一层的规矩；server 留下自己的那一半——能力契约、升级端点、接缝，以及 platform 本身。

**它的 HTTP 面只有 `/api/hmr`。** `/api/auth` 与 `/api/desktop` 现在是平台的路由组，和其他路由一样经接缝提供；平台的路由表不再携带要拒绝的前缀清单，`/api/auth` 下的未知路径答 404 而不是被 cookie 门拦成 401。

**平台把日志交给层。** 层的请求日志行经平台 api 上的 `log` 写出，每行经 host 解析到当前平台，而不是启动时按名字取一个 `Log` 节点、跨 swap 拿着不放。

**升级通道是平台声明的路由，协议归机制。** `/api/hmr` 和其他路由组一样贡献进平台的路由表（先网络门，再平台的鉴权，再 admin），而「一次推送是什么」——body 与应答——是 `packages/hmr` 的 `upgradeEndpoint`，任何一代都能经控制对象认领到。不服务该通道的一代在提交前被拒绝（`admitsUpgradeRoute`）：上一代继续，安装永远不会落到无法再推送的地步。层在接缝之上不再保留任何前缀。

**冻结的操作是 `hmrMain`，在包里。** 请求交给哪一代（含等待进行中的 swap）、推送如何落地、启动失败时怎么办、一代成为当前之后产品要刷新什么（新的一代，或失败后重新启动的上一代）——这些都在 `packages/hmr` 的 `main.ts`。server 的入口把 host、自己的刷新（解析节点用的那棵树）和启动交给它；接缝与升级路由只驱动控制对象，不再直接驱动 host。

**推送的做法和 `git push` 一样。** 推送原本每次都把所有部分内联带上——两个 bundle、整个 web dist、全部原生资产，以 base64 塞进一个 gzip JSON body——不管目标是否已经持有。现在存储按内容寻址（`store/blobs/<sha256>`，每份不同内容只存一次）：`POST /api/hmr/assets/probe { hashes }` 回答目标缺哪些 blob，`PUT /api/hmr/blobs/<sha256>` 以原始 body 收一个 blob、哈希对上名字才存，推送 body 形状不变，其中每个内容值——`platform`、`cli`、`web.files` 与 `assets.files` 的每一项——都可以写成 `{ sha }` 而不是内联，升级在任何东西启动之前先从存储解析；指名了存储里没有的 blob 会被拒绝并给出哈希，绝不物化成一个洞。`scripts/deploy.mjs` 先探测、只上传缺失的 blob，再推送一个只有名字的 body，于是一次推送只传上次之后变化的部分。没有探测端点的目标回应 404，收到全部内联内容，和它一直以来收到的推送一样。任何留存的资产集合都未记录的 blob 随旧集合一起清扫。

**registry 里的是平台的状态，id 也这么说。** 每个条目都是 `platform.<name>`。registry 是内存状态，改名即硬升级：带此改动的平台需要带此改动的层，反之亦然。
