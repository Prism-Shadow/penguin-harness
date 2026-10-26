# 取消后停止交付已缓存的消息流事件

- **Date:** 2026-10-25
- **Type:** fix
- **Scope:** `amsp`
- **PR:** [#1326](https://github.com/Prism-Shadow/penguin-harness/pull/1326)

[English](2026-10-25-amsp-abort-buffered-events.md)

调用方在两个事件之间取消 AMSP 消息流后，下一次读取会抛出原始取消原因。同一网络数据块中已缓存的后续事件不再继续交付，已缓存的 `[DONE]` 也不会再将已取消的请求报告为正常完成。
