# 存量安装兼容说明

- **Date:** 2026-11-24
- **Type:** change
- **Scope:** Company mode

[English](2026-11-24-backward-compatibility.md)

## 已有公司工单

以 `2026-09-02-launch-the-site` 立单的工单保留原 ID 和 Markdown 文件名。已有的看板书签、父工单、阻塞关系、频道引用和 Session 继续使用记录中的 ID。新旧工单可以相互引用，无需迁移或手动操作。

只要已有文件或外部引用仍使用日期开头的 ID，服务端和客户端就继续支持它。维护者只有在另行确认并完成覆盖这些引用的迁移后，才可移除这项支持。
