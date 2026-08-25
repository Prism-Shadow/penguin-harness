# stop_reason 收敛为四值

- **Date:** 2026-08-24
- **Type:** refactor
- **Scope:** `core`, `server`, `web`, `cli`
- **Breaking:** yes — `StopReason` 移除 `failed` / `timeout` / `malformed` / `auth`，改为 `retryable` / `fatal`；`LLMOutcome.permanent` 删除；Web 输入区的鉴权置灰门控退役

[English](2026-08-24-stop-reason-converges-to-four-values.md)

LLM 的停止原因协议从六值收敛为四值：`completed` / `aborted` / `retryable` / `fatal`。停止原因现在只回答一个问题——该不该重试；具体错误一律由 `error_message` 承载（`LLMOutcome.errorMessage` → `request_end.error_message`），不再编码在原因值里。

**`retryable`** 覆盖一切值得再试的失败：传输断开、空闲超时、408/429/5xx、响应不完整或解析异常，以及所有无法归类的错误——fatal 判定是确定性白名单，网关用自己的措辞表达瞬态故障时必须保住重试。引擎沿既有退避阶梯 reconnect，行为不变。

**`fatal`** 覆盖重试无法修复的失败：Provider 的 4xx 拒绝（408/429 除外）、凭据错误、无 fast tier 的模型开启 fast mode、输入无法组装成请求。引擎直接停止并立即呈现错误信息。此前确定性的 400 被归为 `failed`、烧完整条五级阶梯用户才看到可行动的报错——这正是排查 Vertex 混合内容 400 时暴露的直接动因。

## 细节

- `LLMOutcome.permanent` 删除：`fatal` 本身就是分类，不是分类上的旗标。引擎的 fatal 分支取代了原先的 `auth` 分支与 permanent-failed 分支。
- 独立的 `auth` 状态删除，随之退役的还有 Web 输入区的鉴权置灰门控（由 `credentials_updated` 解锁的时间门控）：fatal 的原因经中断横幅呈现，改好 key 后直接再次发送即可。`credentials_updated` 保留为提示性广播；其宣告的服务端运行时缓存失效逻辑不变。
- 工具结果刻意保留自己的词表（`completed` / `failed` / `aborted` / `timeout`，现为独立类型 `ToolStopReason`）：工具失败作为内容回灌给模型，不适用重试语义。`compaction_end.status` 同样独立为三值（`completed` / `failed` / `aborted`）：压缩的 `failed` 意为「本次放弃、下次触发再试」，既非 `retryable` 也非 `fatal`。
- 服务端的 LLM 异常记录重划错误码：`llm_fatal`（unexpected）、`llm_failed`（重试耗尽，unexpected）、`llm_retried`（被阶梯吸收，expected）。旧的 `llm_auth` / `llm_timeout` / `llm_malformed` / `llm_failed_retried` 不再产生。重试耗尽现在记为 unexpected——此前耗尽的 timeout 仍按 expected 归档。
- 模型连通性探测放宽：任何流出过真实内容的 `retryable` 结束都判通过（此前只有 `malformed` 形态享此待遇）——内容到达本身就是连通性测试要测的东西。
- 旧 Trace 保持可读：重放判定只与 `completed` 比较，Web / CLI / 轨迹分析对废弃拼写保留渲染——包括压缩区间内 `failed` 的旧「快速失败」时代特判。
