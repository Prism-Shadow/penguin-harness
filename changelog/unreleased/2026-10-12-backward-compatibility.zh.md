# 向后兼容：Penguin Go 路由

- **Date:** 2026-10-12
- **Type:** process
- **Scope:** `core`, `server`
- **PR:** [#1063](https://github.com/Prism-Shadow/penguin-harness/pull/1063)

[English](2026-10-12-backward-compatibility.md)

Penguin Go 保存的旧路由直接切换到 MMSP。[MMSP 路由](2026-10-12-penguin-go-mmsp.zh.md)在 Project 加载配置时迁移；授权和目录同步还会应用平台下发的 MMSP 端点。

## 迁移范围

内置 `penguin-go` 分组 ID 和 Go 所属端点共同限定迁移范围。现有配置迁移流程更新分组和模型级覆盖项，不发网络请求、不依赖保存的 key，也包含已退役的模型 ID。迁移幂等，保留其他字段、用户自建分组和改为其他服务器的端点。不进行能力协商，也不回退旧协议。

## 移除条件

0.3.0 发布准备时，由准备发布的人与 AgentHub 客户端类型迁移一并移除（同一条件：发布说明写明，在此版本之前最后打开过的 Project 须先在某个 0.2.x 版本上打开一次）。移除范围：`migrateProjectConfigTable` 里加载时的调用、`migratePenguinGoRoutes` 不带 endpoint 的分支（带 endpoint 的分支保留，授权和同步用它应用平台下发的 MMSP 端点）、`isPenguinGoEndpoint` 里 MMSP 之前的域名与路径，以及迁移相关的测试。用户无需操作。使用此版本 Harness 时，Penguin Go 必须已经支持 MMSP。
