# abort 只标记用户中断

- **Date:** 2026-08-25
- **Type:** refactor
- **Scope:** `core`, `server`, `web`, `cli`
- **Breaking:** yes — 引擎不再为 LLM 与压缩失败产出 abort 事件;其终局记录是流上已有的 `request_end` / `compaction_end`

[English](2026-08-25-abort-marks-user-interruptions-only.md)

abort 事件从此只有一个含义:用户中断了本次运行。LLM fatal、重试阶梯耗尽、任务中途压缩失败都不再产出 abort——每种失败的终局记录就是流上已有的事件:携带 `status`、`error_message` 与 `attempt` 的 `request_end`(且无 `retry_in_ms`——没有计划重试的非 completed 收尾**就是**运行的终点),或带状态与明细的 `compaction_end`。abort 载荷保持 `{type, reason}`,引擎的 reason 拼写收敛为用户中断集合(`aborted by user` / `user`、`aborted during reconnect backoff`、`aborted during compaction`)。

前端改从这些记录渲染失败:Web 对 fatal 的 `request_end` 出错误横幅(中文界面 `[错误]:模型请求错误:…`),对宣布不再重试的 retryable 收尾当场把重试提示项落为"已放弃"并附最终错误;CLI 打印同样的两种行。abort 横幅本身从此只说"用户中断了什么",经 `parseAbortReason` 本地化——解码器仍识别废弃的失败拼写,此拆分之前写下的 Trace 渲染不变(过渡版本同时写了两种记录的 Trace 去重为一行)。

幕后:服务端异常观察器把挂起的 LLM 失败改在下一个 `request_begin` 或运行收束时落定,记录文本由事件字段拼成(fatal → `llm request error: …`、耗尽 → `llm request failed after N retries: …`、计划中的重试被用户打断则保留原文),没有 abort 事件也保持同样的记录文本;goal 循环改以终局 `request_end`(或任务中途压缩失败)识别被切断的轮次——坏掉的凭据依旧会终止 goal,而不是对着它反复发起新轮。
