# 向后兼容

- **Date:** 2026-10-02
- **Type:** process
- **Scope:** `core`, `server`
- **PR:** [#948](https://github.com/Prism-Shadow/penguin-harness/pull/948)
- **Breaking:** yes — 本版本之前写下的 `.project_config.toml` 会在第一次被读取时改写一次：分组内条目共有的 base URL、协议或 key 移到该分组的 `[providers.<id>]`

[English](2026-10-02-backward-compatibility.md)

[分组连接信息](2026-10-02-provider-connection.zh.md)先取模型自己的值，再取分组的 `[providers.<id>]`，此外不读任何来源，以此解析模型的 base URL、key 与协议。此前写下的每个 `.project_config.toml` 都把这些值存在条目上，在新的顺序下会被读成各模型自己的值。

## 旧形态：每个条目上的副本

- 预置条目带着目录协议（`client_type`）的副本，目录有端点时还带着端点（`base_url`）的副本，是新建 Project 或同步预置时写入的。
- 每一次按分组写 key（**填写密钥**、**连接**、Penguin Go 与 ModelScope 的授权、ModelScope 的 token 续期）都把同一把 key（`api_key`、`created_at`）写到分组的每个条目上。

原样读取，这些都是覆盖值。升级后写入分组的 key 永远到不了仍存着旧 key 的条目，ModelScope 续期后的 token 也一样；分组的 base URL 或协议对已存的条目不起作用；每个已连接的分组都会显示**未连接**。

## 迁移做了什么

`packages/core/src/state/project-config.ts` 中的 `hoistProviderConnections` 就地改写解析出的表，不读目录。`migrateProjectConfigTable` 在 [MMSP 0.5.0 的客户端类型迁移](2026-10-01-backward-compatibility.zh.md)之后调用它，因此比较的是 MMSP 的名字；文件的两个读取方随即把结果写回一次：core 的 `loadProjectConfig`（CLI、Session 的创建与恢复、机器管理）与服务端的 `ProjectConfigService.readTable`（全部路由与服务）。它只在没有 `providers` 键的文件上运行，而本版本写下的文件都有这个键：写入方总会写一个，没有分组设置任何值时写一个空的 `[providers]` 表。因此每个文件只迁移一次，用户之后设置的值也不会被误当成旧副本。

逐个处理条目中出现的分组（`custom` 除外）：

- **base URL。** 分组的每个条目都带 base URL 时，出现最多的那个值（须严格多于其他任一值，按 `sameEndpoint` 比较；并列则不移动）成为 `[providers.<分组>].base_url`，并从存着它的条目上删除；值不同的条目保留自己的。有条目不带 base URL 时不移动：跟随分组 base URL 会改变它的去向。
- **协议。** 每个条目都带协议且全部相同（`sameClientType`）时，它成为 `[providers.<分组>].client_type`，并从条目上删除。
- **key。** 分组里所有带 key 的条目 key 都相同，且经过 base URL 一步之后分组密钥能借给其中每一个（`groupKeyReaches`）时，这把 key 移到 `[providers.<分组>].api_key`，`created_at` 取这些条目中最晚的一个，并从条目上删除；否则每个条目保留自己的 key。
- 没有任何条目带的字段保持空缺，文件里的其他键全部保留，没有可迁移内容的文件不会被写。任何模型的请求都不变，只有 key 被移走的分组里原本没有自己 key 的模型，现在在能借到时使用分组密钥。

典型结果：OpenAI 兼容网关与 ModelScope 的分组上得到 base URL、协议与 key，条目不再带这些值；Penguin Go 的分组上得到中转 base URL 与 key，每个条目保留自己的协议；OpenCode Go 的分组上得到 Chat Completions 的 base URL 与 key，Messages 条目保留自己的端点，每个条目保留自己的协议；厂商分组只得到 key。

## 用户需要做什么

不需要做任何事。条目 key 各不相同的分组把它们保留为各模型自己的 key，在分组设置里填写分组密钥之前显示**未连接**。没有被移走的端点或协议保留为条目自己的值；**恢复默认**会把内置模型与分组恢复为新建 Project 时的形态。

## 何时可以移除

在 0.3.0 发布准备时，由负责该次发布的人与 [MMSP 0.5.0 的客户端类型迁移](2026-10-01-backward-compatibility.zh.md)一并移除。前提：0.3.0 的发布说明写明，最后一次打开早于「交付本迁移的那个版本」的 Project，须先在某个 0.2.x 版本上打开一次；任何一次读取（服务端启动、`penguin config model list`、一个 Session）都会完成改写。移除的内容：

- `hoistProviderConnections`、它在 `migrateProjectConfigTable` 中的调用，以及连同客户端类型迁移一起的这个包装函数（`packages/core/src/state/project-config.ts`）；
- `renderProjectConfigToml` 中空的 `[providers]` 标记；
- `loadProjectConfig` 与 `ProjectConfigService.readTable`（`packages/server/src/services/project-config-service.ts`）里的写回；
- `packages/core/test/state.test.ts` 与 `packages/server/test/models.test.ts` 中的迁移用例；
- 设计文档改动历史 2026-10-02 条目里关于本迁移的那句话。
