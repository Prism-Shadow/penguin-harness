# Agent API 设置数据库升级

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `server`
- **PR:** [#1111](https://github.com/Prism-Shadow/penguin-harness/pull/1111)

[English](2026-10-13-backward-compatibility.md)

增加了第 17 号迁移，为现有 `agent_api` 记录补齐可空的模型、思考等级和工作区字段。保留了已有 API 开关、审批模式和密钥。未设置的字段继续使用原来的会话创建默认值，无需重置。

## 保留期限

迁移 17 保留至最低支持的数据库版本高于 16。提升版本基线的维护者在所有受支持的数据目录均已具备新字段后移除这项升级。回滚保留新增字段及其值，旧版本忽略这些字段。
