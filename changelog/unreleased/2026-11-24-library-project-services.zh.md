# Project 领域的服务并入 library project 包

- **Date:** 2026-11-24
- **Type:** refactor
- **Scope:** `server`, `library/project`, `library/model`, `core`

[English](2026-11-24-library-project-services.md)

服务端的 Project 服务移入此前落地的 project 词汇包。`@prismshadow/penguin-library-project` 收下 Project 服务（创建、列表、删除、成员授权、初始 Project 供给）、访问判定、项目事件通知、项目模型请求路径、`.project_config.toml` 存储及其迁移与预设、连接期默认报价与模型协议、视觉探测助手。`@prismshadow/penguin-library-model` 收下工具模型连通性测试。配置存储读取所经的原始 TOML 解析从 core 以 `parseProjectConfigToml` 导出，读这份文件的各方共用同一个解析器。

这些由 server 导入；library 侧不 import server。移动的服务在绑定 server 能力处保留其服务端装配：Provider Module 留下，服务类移走——Project 服务、配置存储与事件通知器的端口（数据根路径、预装模块、应用种子、用户频道枢纽）由 Provider 绑定。API 导出面靠 re-export 保持完整——仍在使用的仓内转发让旧导入路径继续可用。

## Details

- `library/project` 新增：`ports`、`access`、`events`、`project-service`、`model-requests`、`project-config-service`、`project-config-migrations`、`project-config-seed`、`connect-default-offer`、`protocol-detect` 与 `vision-detect`。
- `library/model` 新增：`tool-model-test`，并 type re-export MMSP 流事件类型，使请求路径无需直接依赖 MMSP。
- `core` 新增：`parseProjectConfigToml`，typed 配置加载器背后的原始表读取。
- 路由层留在 server：models 与 projects 路由依赖尚无 library 归属的 server 机制（machines、余额、工具绑定）。
- 涉及的每个接口类都在 `@Interface` 装饰器下声明成员。
