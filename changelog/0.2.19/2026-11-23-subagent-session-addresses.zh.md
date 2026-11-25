# 用 Session ID 联系子智能体

- **Date:** 2026-11-23
- **Type:** feature
- **Scope:** `core`, `server`, `web`
- **PR:** [#1766](https://github.com/Prism-Shadow/penguin-harness/pull/1766)

[English](2026-11-23-subagent-session-addresses.md)

委派返回子会话的完整 Session ID 和短地址。同一机器、同一 Project 中，有权限的其他对话可以用完整 ID 或至少八位的唯一后缀继续联系该子智能体，也可以停止它的当前轮。归档、重连和重启服务均保留原地址。智能体面板可以复制完整 Session ID。
