# 把 provider 的 429 与传输中断分开归类

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `core`
- **PR:** [#1114](https://github.com/Prism-Shadow/penguin-harness/pull/1114)

[English](2026-10-13-rate-limited-error-code.md)

429 与连接中断此前是同一个 `error_code`——`network`——于是下游无从区分「线路抖了一下，稍等再试」与「这个模型已经没有配额了，同一请求在每一级退避之后仍会 429」。

## 改了什么

- **`ErrorCode` 增加 `rate_limited`**：provider 回答了 429，即它的速率限制，或一份暂时耗尽的配额。`isRateLimitError`（与 `isFatalProviderRejection` 并列导出）沿错误 `cause` 链的任一层读出它，读法与 fatal 判定一致。
- **结果状态仍是 `retryable`。** 短暂的突发正是重连阶梯要处理的情形；这次分类不改变该轮何时放弃、重试什么，只是把原因命名出来。
- 词汇表其余部分不变：传输中断仍是 `network`，5xx 仍是 `network`，`request_end` 事件照旧以 `error_code` 携带该码。

## 宿主为什么需要它

两种故障需要不同的动作。一种等一等就过去了；另一种是「这段会话在别处还有地方可跑」——既然 harness 现在自带了会话内的模型切换（`Session.switchModel`、`model_switch` 记录，以及服务端的 `updateModel` 落库），在结果里把两者分开，正是做出这个判断的前提，也是「把被限流的会话迁到另一个模型、而不是把约 60 秒的阶梯耗在一份已经没有的配额上」的第一步。

它对可观测性同样直接生效：Cost 中心的错误面板按 `error_code` 分组，限流因此不再藏在 network 桶里。
