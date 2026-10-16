# 数据兼容

- **Date:** 2026-10-15
- **Type:** refactor
- **Scope:** `server`, `core`
- **PR:** [#1166](https://github.com/Prism-Shadow/penguin-harness/pull/1166)
- **Breaking:** yes — 环境变量改由 Project 配置的 `official` 标记决定，`PENGUIN_GO_API_KEY` / `PENGUIN_GO_BASE_URL` 不再读取，Penguin Go 的 MMSP 之前路由只由服务端迁移

[English](2026-10-15-backward-compatibility.md)

## 已有 Project 的 official 标记

在这个标记之前写下的 `.project_config.toml`，会在服务端第一次读取时补写一次。服务端启动时会把每个 Project 的配置读一遍，因此补写发生在任何会话打开文件之前。兼容的旧形态是没有 `official` 键的一方厂商分组，无论它有 `[providers.<id>]` 表，还是只由某个模型的 `provider` 提到。旧规则会借给其模型厂商 key 的分组得到 `official = true`：`base_url` 为空或为该厂商官方端点之一，且 `client_type` 为空或读取厂商变量；其余得到 `official = false`。带 base URL 而无协议的 official 分组，同时写入厂商官方客户端为 `client_type`。已经有该键的分组（由本版本写入或手工写入）保持不动，文件只写回一次。

只有服务端会迁移：只经 SDK 读取的文件不会补写标记，文件补上标记之前，其中无 key 的模型会被拒绝。

只有新规则不再覆盖的情形需要用户处理：custom 或自建分组里没有 base URL 的无 key 模型，以及把厂商端点写成自己 base URL 的无 key 模型，现在都需要在模型或分组上填写 key。依赖 `PENGUIN_GO_API_KEY` 的 Penguin Go 用户，请在分组标题栏重新连接，或把 key 粘贴到分组设置里；没有任何兼容代码读取该变量。

### 保留期限

在 0.3.0 发布准备时，由负责发布准备的人移除 `markOfficialGroups` 及其在 `ProjectConfigService.readTable` 中的调用，与 core 的 `migrateProjectConfigTable` 一并移除；前提是发布说明已写明：最后一次在本版本之前打开的 Project，须先在 0.2.x 的服务端上打开一次。启动时的全量读取（`migrateStoredConfigs`）随它服务的最后一项迁移一并移除。

## Penguin Go 的 MMSP 之前路由

对 MMSP 切换之前存下的 Penguin Go 路由（`token.penguin.ooo/api` 上的 `google-genai` / `deepseek-official`）的一次性迁移，现在只在服务端的读取路径（包括启动时的全量读取）中进行，core 的 `loadProjectConfig` 不再迁移。只经 SDK 读取的文件保留旧路由，直到服务端读取它。兼容的旧形态、生效范围与用户操作都与 [0.2.15 的记录](../0.2.15/2026-10-12-backward-compatibility.zh.md)相同：经服务端、桌面应用或 CLI 打开文件时无需处理。

### 保留期限

在 0.3.0 发布准备时，与上面的迁移一并移除 `ProjectConfigService.readTable` 中不带 `endpoint` 的调用、`migratePenguinGoRoutes` 中 `endpoint === undefined` 的分支，以及 `isPenguinGoEndpoint` 里 MMSP 之前的 origin 与路径。带 `endpoint` 的路径保留。
