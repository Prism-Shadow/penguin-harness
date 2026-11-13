# 跟随会话时保持历史请求的重试间隔

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `amsp`
- **PR:** [#1333](https://github.com/Prism-Shadow/penguin-harness/pull/1333)

[English](2026-10-26-amsp-history-backoff.md)

历史请求暂时失败后，即使有新记录或心跳到达，`SessionReader` 也会等待重试间隔结束。关闭监听器会同时取消尚未执行的历史重试和流重连。从历史重新同步时，会取消上一次历史重试，避免它在新连接上提前发起请求。
