# LLM 请求错误呈现其底层原因

- **Date:** 2026-07-24
- **Type:** fix
- **Scope:** `core`
- **PR:** [#54](https://github.com/Prism-Shadow/penguin-harness/pull/54)

[English](2026-07-24-llm-request-errors.md)

失败的 LLM 请求此前记录的是像 `terminated` 这样光秃秃、无从下手的信息。Node 的 `fetch` 把真正的传输失败包装成 `TypeError: terminated`，而把实际原因——套接字关闭、`ECONNRESET`、Provider 中断了流——挂在错误的 `cause` 上；构造请求结果时只取 `.message`，就把它丢掉了。

结果信息现在会遍历 `cause` 链并追加每一层的 message 与错误 `code`，因此同一个失败会呈现为例如 `terminated: other side closed (UND_ERR_SOCKET)`。这会一路贯通到中止原因（`llm request error: …`）、成本中心的近期错误表以及 Trace。各段会去重，非 Error 类型的 cause 末端予以保留，遍历过程也防范了 `cause` 成环。由一个 `describeError` 单元测试覆盖。
