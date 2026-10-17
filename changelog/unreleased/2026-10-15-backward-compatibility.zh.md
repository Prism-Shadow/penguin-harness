# 数据兼容

- **Date:** 2026-10-15
- **Type:** refactor
- **Scope:** `server`, `core`
- **PR:** [#1166](https://github.com/Prism-Shadow/penguin-harness/pull/1166), [#1167](https://github.com/Prism-Shadow/penguin-harness/pull/1167)
- **Breaking:** yes — Penguin Go 的 MMSP 之前路由只由服务端迁移，只经 SDK 读取时保持原样

[English](2026-10-15-backward-compatibility.md)

## DeepSeek 与 MiniMax 预设写入的厂商端点

DeepSeek 预设自 2026-09-10 起、MiniMax 预设自 2026-08-18 起，直到 2026-10-03，分别带有 `base_url = "https://api.deepseek.com"` 与 `base_url = "https://api.minimax.io/v1"`，旁边各固定了厂商的客户端（`deepseek-v4` / `minimax-m3`，后更名为 `deepseek-official` / `minimax-official`）。分组级连接信息随后把这样的一对值提升到 `[providers.deepseek]` 或 `[providers.minimax]` 上。按[新的凭据规则](2026-10-15-environment-keys-without-base-url.zh.md)，没有 key、却要发往文件里 base URL 的模型会被拒绝，这类 Project 的默认模型在升级后的第一个会话就会失败。

- **兼容的旧形态：** `deepseek` 或 `minimax` 分组上、或组内某个条目上的这一对值，即同一张表上的厂商 URL 与厂商客户端。服务端的读取路径（以及启动时对每个 Project 的读取）删除这一对值并写回文件。key 与其他内容原样保留。旁边没有厂商客户端的 URL（在模型库页面填写的，页面不提供厂商客户端）、代理、厂商的第二个主机与其他分组同样保留，因此迁移只发生一次，不会撤销用户之后的选择。
- **生效范围：** 只在删掉这一对值不改变任何去向时生效。涉及的 id 须自行路由到厂商官方客户端，其缺省端点正是这个 URL；条目的一对值只在分组没有指定其他 URL 或协议时删除；分组的一对值只在跟随它的模型都落到这个客户端、且没有模型在分组的 origin 上保留自己的 base URL（否则会失去分组密钥）时删除。
- **用户操作：** 经服务端或桌面应用打开的 Project 无需处理。只由 CLI 或 SDK 使用的 Project 保留这个 URL，组内无 key 的模型会被拒绝，提示写出两种解决办法：清掉 base URL（`penguin config model add --provider deepseek --clear-base-url`），或把 key 写进文件。
- **边界情况：** 服务端环境里设置的 `DEEPSEEK_BASE_URL` 或 `MINIMAX_BASE_URL`（例如指向代理）现在会对这些模型生效，因为文件里不再写明它们的端点。

### 保留期限

在 0.3.0 发布准备时，由负责发布准备的人与 core 的 `migrateProjectConfigTable` 一并移除：`migratePresetVendorEndpoints` 及其在 `ProjectConfigService.readTable` 中的调用、目录导出的 `MINIMAX_BASE_URL`、启动时的全量读取（`ProjectConfigStore.migrateStoredConfigs` 及其在 `Startup.setup` 中的调用，它只为这些一次性迁移而存在），以及服务端 `project-config-migrations.test.ts` 中的场景。

## Penguin Go 的 MMSP 之前路由

对 MMSP 切换之前存下的 Penguin Go 路由（`token.penguin.ooo/api` 上的 `google-genai` / `deepseek-official`）的一次性迁移，现在只在服务端的读取路径（包括启动时的全量读取）中进行，core 的 `loadProjectConfig` 不再迁移。只经 CLI 或 SDK 读取的文件保留旧路由，直到服务端读取它。兼容的旧形态与生效范围都与 [0.2.15 的记录](../0.2.15/2026-10-12-backward-compatibility.zh.md)相同；用户操作收窄为：经服务端或桌面应用打开文件时无需处理。

### 保留期限

在 0.3.0 发布准备时，由负责发布准备的人与 core 的 `migrateProjectConfigTable` 一并移除 `ProjectConfigService.readTable` 中不带 `endpoint` 的调用、`migratePenguinGoRoutes` 中 `endpoint === undefined` 的分支，以及 `isPenguinGoEndpoint` 里 MMSP 之前的 origin 与路径。带 `endpoint` 的路径保留。执行这两项服务端迁移的启动时全量读取随之一并移除（见上文）。
