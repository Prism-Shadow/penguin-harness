# 插件市场：注册表、共享索引格式与插件页

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#383](https://github.com/Prism-Shadow/penguin-harness/pull/383)

[English](2026-08-20-plugin-marketplace.md)

为 harness 加入了插件发现能力：服务端的注册表抽象、共享的插件索引格式，以及 Web App 中列出四个沙盒后端包的插件市场页。

## 细节

- 引入了**插件注册表（plugin registry）**概念：一个注册表即一个插件索引条目来源。本次实现两种——服务端包内嵌索引的**内置注册表（builtin registry）**，以及拉取 `index.json` URL 的 **HTTP 注册表**。两者共用同一个校验器，远端索引不会比内嵌索引获得更多信任。
- 所有注册表共享同一份**插件索引格式**，参考 typst/packages 的 `index.json` 模式：扁平数组，每个元素是插件的一个版本条目，含 `name`、`version`、`description`、`authors`、`license`，可选 `repository` / `homepage` / `keywords` / `categories` / `updatedAt`。条目的 `name` 就是运维写入 `plugins.json` 的包名。
- 新增 `GET /api/plugins`（任何已登录用户可访问），返回已配置注册表合并后的索引。注册表列表当前固定为内置注册表，其中列出四个沙盒后端：bubblewrap（Linux）、Seatbelt（macOS）、MXC（Windows）与 DSH 适配器。
- Web App 新增**插件市场**页，位于导航组中模型库之后：只读卡片网格，展示每个条目的包名、版本、描述、许可证与关键词标签。仅用于发现——安装插件仍是运维侧编辑 `plugins.json` 的操作。
