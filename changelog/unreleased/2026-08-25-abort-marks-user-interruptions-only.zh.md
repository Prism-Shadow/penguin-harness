# abort 只标记用户中断

- **Date:** 2026-08-25
- **Type:** refactor
- **Scope:** `core`, `server`, `web`, `cli`
- **Breaking:** yes — 引擎不再为 LLM 与压缩失败产出 abort 事件(其终局记录是流上已有的 `request_end` / `compaction_end`),错误信息收敛为跨载荷统一的 `error_code` + `error_message` 对

[English](2026-08-25-abort-marks-user-interruptions-only.md)

abort 事件从此只有一个含义:用户中断了本次运行。LLM fatal、重试阶梯耗尽、任务中途压缩失败都不再产出 abort——每种失败的终局记录就是流上已有的事件:携带 status 与错误对的 `request_end`(且无 `retry_in_ms`——没有计划重试的非 completed 收尾**就是**运行的终点),或带状态与明细的 `compaction_end`。

错误信息本身收敛为一个形状,即 omnimessage 的 `ErrorInfo`:机器可读的 `error_code`(渲染层据此本地化)加原样展示的 `error_message`。它携带于 abort 载荷(`user_abort` / `backoff_interrupted` / `compaction_interrupted` 三种用户中断原因)、`request_end` 与 `compaction_end`(LLM 失败的分类原因:`timeout` / `network` / `malformed` / `auth` / `rejected` / `unsupported` / `invalid_input`,起源于 `LLMOutcome.errorCode`——status 回答"要不要重试",code 回答"是哪类错")、以及 `mcp_connect_end` 与其逐 Server results(`connect_failed`;原 `error` 字段更名为 `error_message`)。任何地方都不再解析散文:`parseAbortReason` 删除,旧 Trace 的 `reason` 文本(与 `error` 字段)按原样展示。

前端从这些记录渲染失败:Web 对 fatal 的 `request_end` 出错误横幅,对宣布不再重试的 retryable 收尾当场把重试提示落为"已放弃"并附最终错误,重连提示的原因措辞由 code 驱动(「连接超时」/「响应不完整」/「网络或服务暂时不可用」——四值 status 本身已表达不了的细分);CLI 打印同样的行。服务端异常观察器把挂起的 LLM 失败在下一个 `request_begin` 或运行收束时落定,记录文本由事件字段拼成,没有 abort 事件也保持同样的记录文本。goal 循环与子会话轮次上报共用 core 的 `RunCutoffObserver`,以终局 `request_end`、任务中途压缩失败或 abort 识别被切断的运行——坏掉的凭据依旧会终止 goal 而不是反复发起新轮,失败的子会话照常向父会话上报 `failed`。
