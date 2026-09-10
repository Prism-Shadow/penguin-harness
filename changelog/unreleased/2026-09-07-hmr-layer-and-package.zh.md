# HMR 层：定名、成包、只剩 /api/hmr

- **Date:** 2026-09-07
- **Type:** improvement
- **Scope:** `server`, `desktop`
- **PR:** [#656](https://github.com/Prism-Shadow/penguin-harness/pull/656)

[English](2026-09-07-hmr-layer-and-package.md)

同一个目的：让「把产品行为放进只能靠重装才能送达的地方」这件事变难。

**这一层按它所做的事命名。** 「runtime」同时也指「正在运行的那个程序」，于是进程做的任何事听起来都像属于这一层。现在它在文档与标识符里都叫 HMR 层。模块树的节点名不改。

**机制就是 `packages/hmr`。** 版本仓库、`harness.json` 的原子提交、资源注册表，以及 park → boot → swap，住在一个看不见 platform 的包里：编译进程序的那份 bundle 是构造函数参数，platform 暴露的 api 是类型参数。它的 README 承载这一层的规矩；server 留下自己的那一半——能力契约、升级端点、接缝，以及 platform 本身。

**它的 HTTP 面只有 `/api/hmr`。** `/api/auth` 与 `/api/desktop` 现在是平台的路由组，和其他路由一样经接缝提供；平台的路由表不再携带要拒绝的前缀清单，`/api/auth` 下的未知路径答 404 而不是被 cookie 门拦成 401。

**平台把日志交给层。** 层的请求日志行经平台 api 上的 `log` 写出，每行经 host 解析到当前平台，而不是启动时按名字取一个 `Log` 节点、跨 swap 拿着不放。

**冻结的操作是 `hmrMain`，在包里。** 请求交给哪一代（含等待进行中的 swap）、推送如何落地、启动失败时怎么办、一代成为当前之后产品要刷新什么（新的一代，或失败后重新启动的上一代）——这些都在 `packages/hmr` 的 `main.ts`。server 的入口把 host、自己的刷新（解析节点用的那棵树）和启动交给它；接缝与升级路由只驱动控制对象，不再直接驱动 host。

**registry 里的是平台的状态，id 也这么说。** 每个条目都是 `platform.<name>`。registry 是内存状态，改名即硬升级：带此改动的平台需要带此改动的层，反之亦然。
