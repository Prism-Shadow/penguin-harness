# ModelScope refresh token 向后兼容

- **Date:** 2026-09-21
- **Type:** process
- **Scope:** `server`, `model-catalog`
- **PR:** [#814](https://github.com/Prism-Shadow/penguin-harness/pull/814)

[English](2026-09-21-backward-compatibility.md)

[ModelScope 授权改动](2026-09-21-modelscope-authorization.zh.md)新增服务端 refresh 元数据，同时不修改 Project TOML schema，也不让既有模型凭据失效。

## 既有数据

数据库 migration 10 新增 `model_provider_auth_tokens` 表，用于保存 refresh token 与 access token 到期时间。既有 `.project_config.toml` 文件无需迁移：当前凭据继续使用既有的 `api_key` 字段，本次改动前保存的 access token 在到期前仍然可用。既有 Project 通过**同步预置**加入 ModelScope 预置模型。

## 回滚

旧版本会忽略新表，并继续使用 Project 文件中的 access token。数据库回滚到版本 10 以下会删除已保存的 refresh 元数据，因此 ModelScope 请求只能继续到该 access token 过期；重新升级到当前版本后再次授权，即可恢复静默续期。

## 移除计划

只要仍支持从 schema 9 或更早版本升级，版本 10 的 migration 代码与版本 9 fixture 就会保留。将最低支持数据库基线提升到 9 以上的发布负责移除该 migration 代码与 fixture。只要模型组令牌刷新仍依赖 `model_provider_auth_tokens` 表，该表就继续保留在当前 schema 中。
