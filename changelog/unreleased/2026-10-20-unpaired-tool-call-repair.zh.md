# 历史停在没人回答的 tool call 上时，下一个请求会先把它配平

- **Date:** 2026-10-20
- **Type:** fix
- **Scope:** `core`

[English](2026-10-20-unpaired-tool-call-repair.md)

失败的请求会让 Provider 客户端的历史停在他发起之前的样子：MMSP 只在流的 `stop` 事件到达时才提交这一轮的消息，所以失败请求的入参——本该用来回答模型已提交的 `tool_calls` 的那些工具输出——永远落不下去。历史于是停在一个 `tool_calls` 无人回答的 assistant 轮上，**之后每一个请求都被 Provider 拒绝**（`An assistant message with 'tool_calls' must be followed by a tool message answering each call`）。会话就此卡死，重试也无用：同样的请求每次都被同样地拒掉，而引擎没有任何办法够到真正存着这些未配对调用的 LLM 历史。

## 改动

每个请求发出前，`GenerativeModel` 会检查客户端历史里有没有没人回答的 `tool_calls`，为每个补一个占位结果——修复必须落到历史里，而随请求入参发出的 tool result 正是 Provider 用来和已提交的 assistant 轮配对的东西。

占位结果明说工具没有产出（`[no result: the request that ran this tool failed before its output was recorded — treat the tool as not run]`），模型不会把这次配对误读成一次成功执行，可以放心重发该调用。

本次请求入参里已经回答过的 id 会被跳过：引擎手里握有真实输出时会把它们作为 carry-over 重发（`tool_loop` 熔断会把它们留给下一轮），同一个调用出现第二个结果会被判为重复而拒绝。
