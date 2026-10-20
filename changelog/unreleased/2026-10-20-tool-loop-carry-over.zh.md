# 被 tool-loop 检测停下的 run 会把工具输出留给下一轮

- **Date:** 2026-10-20
- **Type:** fix
- **Scope:** `core`

[English](2026-10-20-tool-loop-carry-over.md)

`tool_loop` 熔断停下 run 时没有保留停住那一轮的工具输出（连同为其下一轮输入准备的后台通知和 steering 一起丢了）。有状态历史于是停在没人回答的 tool call 上，下一轮请求被 Provider 拒绝（`No tool output found for function call`）——而且每次重试都被拒，会话就此卡死。

## 改动

熔断现在把 `[...stashed, ...turn.toolOutputs, ...injected]` 留作 carry-over——与正常 next-input 组装完全一致——下一轮运行时会带着它们和用户消息一起重发，tool call 与其输出保持配对。
