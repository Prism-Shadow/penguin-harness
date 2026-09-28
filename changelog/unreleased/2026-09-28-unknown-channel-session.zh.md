# 组织：认不出会话的频道消息会被拒绝

- **Date:** 2026-09-28
- **Type:** fix
- **Scope:** `server`
- **PR:** [#865](https://github.com/Prism-Shadow/penguin-harness/pull/865)

[English](2026-09-28-unknown-channel-session.md)

用控制环境的 API token 调 `POST …/organizations/:orgId/channels/:channelId/messages`，若 `sessionId` 指的不是本组织某位员工的会话，现在回 400 `unknown_session`，什么也不写。以前这条消息会以 token 主人自己的名字、`hop` 0 记下——本该出自员工的消息显示成了人写的，而且不论前面的链多深都会投递。

## Details

- 服务器没有这个会话、会话属于别的 Project、或会话的 Agent 不是本组织的员工，这三种都会被拒。
- 不变的部分：不带 `sessionId` 的消息算调用者自己的；用登录 cookie 发送时这个字段照旧被丢弃，所以 Web App 发的消息仍是人的；`tickets/:id/attach` 仍把这个字段读作要挂接的会话。
