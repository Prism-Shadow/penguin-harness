# 模型目录从 core 移到服务端

- **Date:** 2026-10-15
- **Type:** refactor
- **Scope:** `core`, `server`, `web`, `cli`, `model-catalog`
- **PR:** [#1167](https://github.com/Prism-Shadow/penguin-harness/pull/1167)
- **Breaking:** yes — 移除 `@prismshadow/penguin-core/model-catalog`，core 的默认 Project 配置不再带模型

[English](2026-10-15-model-catalog-server.md)

内置模型目录从 `packages/core` 移到 `packages/server`，包括各模型条目、分组表、计价与分时段规则、预置与同步辅助，以及界面辅助。core 不再特判任何模型、分组或网关，唯一例外是网关归因头。

## 位置

- 目录位于 `packages/server/src/model-catalog/`，以不含 Node 依赖的子路径 `@prismshadow/penguin-server/model-catalog` 发布，Web App、CLI 与组件画廊都从这里引用。它运行时只引用 core 的 `@prismshadow/penguin-core/model-connection` 与 MMSP 的 `@prismshadow/mmsp/credentials`，服务端因此新增对 MMSP 的依赖。目录按关注点拆分：目录数据与查询、界面所需的 MMSP 客户端事实（原样转出的 MMSP 路由、各客户端的请求路径与快速模式协议）、模型读取的环境变量名（向 MMSP 询问），以及 Project 种子。
- 移除了 core 的 `@prismshadow/penguin-core/model-catalog` 子路径，以及 core 根入口对目录的再导出。
- `attributionHeaders`（OpenRouter、TokenDance，以及 OpenCode 的 `x-opencode-session`）移入 core 独立的应用归因模块 `llm/app-attribution.ts`，由 `GenerativeModel` 附加到每个请求上。`APP_URL` 由 core 根入口导出。

## Project 配置的种子

- 服务端按目录写入新 Project 的配置文件：默认模型（`PRESET_DEFAULT_MODEL`，仍为 `deepseek/deepseek-flash`）、各内置分组的 `[providers.<id>]` 表（一方厂商分组没有）与预置条目。「恢复默认」与 onboarding 时的补齐写入同样的种子。
- core 的 `defaultProjectConfig()` 只含出厂命令策略，不带分组、模型与默认模型。`loadProjectConfig` 遇到不存在的文件即返回它。

## 迁移

Penguin Go 路由迁移（`migratePenguinGoRoutes`）从 core 的 `loadProjectConfig` 路径移到服务端的读取路径，以及应用启动时对每个 Project 的一遍读取。见[数据兼容](2026-10-15-backward-compatibility.zh.md)。

## 兼容性

- 从 `@prismshadow/penguin-core` 或 `@prismshadow/penguin-core/model-catalog` 引用目录的 SDK 代码，改从 `@prismshadow/penguin-server/model-catalog` 引用。连接辅助（`effectiveConnection`、`groupKeyReaches`、`resolveEntryCredential`、`canonicalClientType`）仍在 core。
- 只有 SDK 使用的数据根一开始没有模型与默认模型。创建会话之前先用 `addModel` 添加模型并设置默认模型；没有 key、且模型与分组都不带 base URL 的模型使用厂商环境变量。由服务端、桌面应用或 CLI 拉起的服务端创建的 Project 照旧带种子。
- 对配置文件不存在的 Project 运行 `penguin config model …`，从空表开始，而不是从目录预置开始。
