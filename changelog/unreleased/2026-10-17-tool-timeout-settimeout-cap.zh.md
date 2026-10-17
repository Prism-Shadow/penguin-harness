# 超过 setTimeout 上限的超时会等到真正的截止时刻

- **Date:** 2026-10-17
- **Type:** fix
- **Scope:** `core`
- **PR:** [#1184](https://github.com/Prism-Shadow/penguin-harness/pull/1184)

[English](2026-10-17-tool-timeout-settimeout-cap.md)

工具超时、后台等待或模型空闲预算超过 2^31-1 毫秒（约 24.8 天）时，不再立刻结束。Node 会把这样的延迟夹成约 1 毫秒；现在定时器会卡在上限以内并反复续期，直到截止时刻真正到达。短预算的路径与以前相同。

## 细节

- Environment 的每工具 `timeoutMs`、`WakeSignal.wait` 以及模型空闲 `requestTimeoutMs` 共用同一个续期辅助函数。
- MCP 仍把 SDK 自己的每请求超时推到同一上限，让 Environment 继续单独计时。
