# 在收到 stop 之前离开生成流时取消上游请求

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `core`
- **PR:** [#1354](https://github.com/Prism-Shadow/penguin-harness/pull/1354)

[English](2026-10-26-llm-stream-cleanup.md)

在收到 `stop` 事件之前离开 `GenerativeModel.streamGenerate()` 迭代器时，无论是调用方提前退出、请求被中断或出错，还是放弃一个不响应的上游，都会取消上游请求并关闭其迭代器：供应商不再继续生成，同一模型也能接受下一个请求。清理不会等待忽略它的上游。已经收到 `stop` 的请求不做任何处理，其响应流照常结束，连接得以复用。
