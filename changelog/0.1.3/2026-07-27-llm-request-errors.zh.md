# Core 与 Web App：传输与配额错误带可见倒计时重连，认证失败可恢复地锁定 Session

- **Date:** 2026-07-27
- **Type:** fix
- **Scope:** `core`, `server`, `web`
- **PR:** [#82](https://github.com/Prism-Shadow/penguin-harness/pull/82)

[English](2026-07-27-llm-request-errors.md)

有两类现场故障此前会直接以 `[Aborted]: llm request error: …` 中止该轮——连接掉线（`terminated: other side closed (UND_ERR_SOCKET)`）与网关配额拒绝（`403 … no active subscription (insufficient_user_quota)`）。两者都不是对该 Session 的终审判决：套接字掉线只是网络问题，而配额错误在余额充值后就会痊愈。现在两者都走引擎的运行内重连（即 `[turn_retried]` 流程：把该轮输入连同已产出的内容一并重发）。

分类器对错误形态变得诚实了：可重试性会探查 `cause` 链（Node 的 `fetch` 会包装真正的传输失败——`UND_ERR_SOCKET` 之类就活在 `cause` 上），以及在 OpenAI 与 Anthropic SDK 各自嵌套层级中解析出的 Provider 响应体；光秃秃的 `terminated` 只有在伴随传输类词汇时才算数，因此「terminated by content filter」这样的文案不会触发重试。配额的特例保持收紧——402/403 且带 `insufficient_user_quota` / `insufficient_quota` 错误码，或消息中点名配额/订阅——而且**认证信号会被优先检查**：确凿的认证错误码绝不会被配额关键词启发式吞进重试路径。

重试遵循同一条共享的指数阶梯，`min(250ms × 2^(n−1), 30s)`，最多 **8 次重连（合计约 62 秒的耐心）**——前两次尝试与此前一样快，因此一次传输抖动仍能在一秒内恢复，而尾部则长到足以让配额窗口真正关闭。压缩请求保留其自己的 3 次上限（约 1.75s）：一次失败的压缩本就保留了原上下文并会在下次触发时重试，因此快速失败胜过拖住会话。在较长的等待进行时，重试行会显示**实时倒计时**（整秒，以客户端时钟为准，由 `request_end` 上新增的增量字段 `retry_in_ms` 驱动——它与实际休眠用的是同一个公式计算），并带两个行内控件：**立即重试**（`POST /api/sessions/:id/retry-now`，跳过剩余等待且不消耗一次尝试次数）与**放弃**（即普通的中止）。`request_end` 还携带失败细节（`message`），因此即便随后发生了重试，成本中心的错误面板记录的也是真实原因——那个 403 响应体，而不是笼统的「超时」。

认证错误不重试；它们以 `StopReason` 的第六个取值呈现——结果与流式 `request_end.status` 上的 `auth`（中止事件仍只带 reason，不新增字段）——并且输入区会锁定，但是**可恢复地**锁定。Session 在创建时固定的是模型*引用*，而凭证是在加载时从当前 Project 配置读取的，因此在模型页修好 key 才是真正的解法：模型更新现在会使该 Project 中所有已缓存的运行时失效（此前只有 vault 编辑会这样做——一个修好的 key 可能要等最长 30 分钟的空闲清扫才被启用），并广播一个 `credentials_updated` 事件，使打开着的标签页即刻解锁。跨页面刷新时，这个锁是一道以最近一次主会话 `request_end("auth")` 时间戳为键的时间门——只有当该失败比凭证文件的 mtime 更新时才处于死锁状态——因此修好的 key 保持修好、仍然错误的 key 会在下次失败时重新锁定，而之后任何一次成功的请求也会清除该状态。该提示的主操作会打开模型页，另有「重试」与「新建会话」作为出口，卡住的草稿仍可选中。子 Agent 的认证失败绝不会锁定父级。端到端验证：一次配额 403 会在可见且递减的倒计时中重试（点击「立即重试」可提前触发），而一次 401 会锁定输入区，在经 API 更新 key 的那一刻无需任何点击即自动解锁，并在刷新之后保持解锁。
