# 新对话 Workspace 沿用

- **Date:** 2026-10-20
- **Type:** feature
- **Scope:** `web`
- **PR:** #TBD

[English](2026-10-20-sticky-new-chat-workspace.md)

发出去的对话，其 Workspace 现在会和模型选择一起沿用到下一个草稿：新建对话的输入框默认落在上一次发送时的 Workspace（及其所在机器），不再每次都从 Project 默认值重播。

## Details

- 沿用值写在按用户隔离的草稿缓存槽位里，发送成功时写入；路由明示（Workspace 分组的 "+" 或 Agent 卡片）仍然优先，保存 Project 的 `[default_chat]` 块仍然会释放缓存的 Workspace，让下一个草稿从默认值重播。
- 选了临时 Workspace（""）会原样沿用 ""。
- 服务端默认值不变：创建时不带 Workspace 的会话（API、CLI、转交）仍然得到临时目录。
