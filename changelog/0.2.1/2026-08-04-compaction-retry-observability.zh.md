# 压缩的抽取容忍、重试对齐与失败可观测性

- **Date:** 2026-08-04
- **Type:** fix
- **Scope:** `core`, `server`, `web`, `cli`
- **PR:** [#174](https://github.com/Prism-Shadow/penguin-harness/pull/174)
- **Issue:** [#170](https://github.com/Prism-Shadow/penguin-harness/issues/170)

[English](2026-08-04-compaction-retry-observability.md)

修复 [#170](https://github.com/Prism-Shadow/penguin-harness/issues/170)：deepseek-v4-flash 的会话变得完全不可用——模型把 `[summary][/summary]` 当作标题写出来，正文却放在闭合标签之后，抽取取到的是那个空标签对，而每一次重试又把模型自己已提交的坏输出再展示给它一遍——于是它逐字照抄，永无止境。`extractSummary` 现在施加一条容忍阶梯（首个非空标签对 → 剥离空 summary 区块之后剩下的内容 → 无标签的输出原样采用），同时保证对健康的历史 Trace 逐字节一致地重新抽取。

一次已提交但不可用的压缩响应，现在算作标准 `compactionMaxReconnects` 预算与指数退避阶梯上的又一次失败尝试——只有 `auth` 会不重试即停止——并会修复 tool_use 配对、在重发的提示词之前前置一条纠正性注记（仅追加，对提示词缓存安全）。被烧掉的成本变得可见：`compaction_end` 新增 `attempts`，每次尝试的 `token_usage` 都在压缩事件对之间呈现，而一次失败的压缩会作为一行成本中心错误落地。重试状态收敛为一个共享的 `RetryDetail` 形状（`error_message` / `attempt` / `retry_in_ms`），贯穿 `request_end` 与 `compaction_end`，由 CLI 与 Web 的重试展示直接读取，而不再在客户端自行计数。新建 Agent 会获得一份更短的压缩提示词，它以一个具体示例来展示格式；已有 Agent 保留其已存提示词，并由抽取救援与重试指引覆盖。
