# 会话历史按帧加载，不再一次整包返回

- **Date:** 2026-10-30
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#1407](https://github.com/Prism-Shadow/penguin-harness/pull/1407)

[English](2026-10-30-session-history-streaming.md)

大转录会话（实测一个会话：2,274 条消息、2,493,866 B）的会话历史以单个 JSON body 返回，客户端在 body 到完之前就超时。现在窗口化的历史读取以 NDJSON 帧回答，逐行写出，首帧在其余帧还在构建时就已经发出。

一次响应包含三类帧。`page` 帧装窗口的信封——JSON 读取返回的那些字段，tail 读取还附带 live tail。`skeleton` 帧装整个转录的全部 unit 开点：普通 prompt 与插入型（steering chip、context_summary、Task 内 background 通知）一起，客户端一次就把所有行位置定死，插入型的行即刻落在终态位置、之后不再补插。`meat` 帧按时间序补发窗口的其余消息，切点只落在组边界——tool_call 永不与它的 tool_call_output 分开——每帧 64 KB 软上限、至少一个组。

每帧都带重入其窗口的 cursor。中断的流走普通的窗口化读取协议续传：重入响应带着客户端已持有的帧，客户端去重丢弃这些，序列从流停下的地方继续。实测最重的一个 unit（563 KB、614 条消息、74 轮连续工具调用、不可切）拆成 9 个 64–74 KB 的帧，不再卡死单次响应。

web 消费端逐行接收帧：骨架帧一次铺出全部行，肉帧填充已就位的行且不移动任何一行——折叠组的填充只更新徽标计数。
