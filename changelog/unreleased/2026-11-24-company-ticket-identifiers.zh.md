# 公司工单 ID 使用 ticket- 前缀

- **Date:** 2026-11-24
- **Type:** change
- **Scope:** Company mode, CLI, Web App

[English](2026-11-24-company-ticket-identifiers.md)

新工单的 ID 形如 `ticket-2026-11-24-launch-the-site`。看板、CLI 与 API 使用同一个 ID。日期取组织所在时区的立单日，同一天以相同 slug 再次立单时，ID 会追加 `-b` 等字母后缀。

打开或刷新工单书签会进入该工单的详情。旧 ID 的处理方式见[已有公司工单](2026-11-24-backward-compatibility.zh.md#已有公司工单)。
