---
title: 消息流转与时序
description: 消息如何在一轮的五个参与者之间传递，哪些顺序有保证、哪些没有，以及流序为何不同于上下文序。
---

[OmniMessage 协议](/omni-message)定义了消息是什么，本页讲消息怎么传、以什么顺序可见：一轮内的传递路径、背后的汇流机制和一轮内的可见时序。随后说明哪些顺序有保证、哪些没有，以及「流上的顺序」与「模型上下文的顺序」为何是两回事。源码：`packages/core/src/engine/context-engine.ts`。

## 一轮的传递路径

一轮有五个参与者：Human（SDK 调用方）、engine（`context_engine`）、LLM、Environment 和 Trace。一轮之内：

```text
Human ──run(newMessages)──► engine
                            engine ──write Prompt──────────────────► Trace
                            engine ──request_begin──► Human and Trace
                            engine ──streamGenerate(new messages)──► LLM
        ┌────────────  LLM streams partial_* and complete messages ────────┐
        │  engine forwards each: simultaneously ──► Human (yield)          │
        │                                      and ──► Trace (write)       │
        └──────────────────────────────────────────────────────────────────┘
   complete tool_call ──► engine: await approve(tc) (one at a time)
                            engine ──approval_decision──► Human and Trace
                 allow ──► Environment.executeTool (concurrent, never blocks the LLM stream)
        Environment ──partial_tool_call_output──► Human, and (complete) ──► Trace
   LLM stream ends: token_usage (completed requests only) is its last message, request_end follows at once
   still-running tools keep streaming output (possibly after request_end)
   all outputs settled ──► reordered to original call order as the next turn's LLM input
```

> [!NOTE]
> 每条消息在进入输出流的同时写入 Trace，因此流序与 Trace 序一致；Trace 只是跳过分片和带 `origin` 的消息，见 [Session 与 Trace](/sessions-and-traces)。

其中几条路径是并发的，它们的输出如何汇成一条有序的流，见[单一汇流点：MergeQueue](#单一汇流点mergequeue)。

## 单一汇流点：MergeQueue

一轮内有多个并发生产者：消费 LLM 流的驱动任务，加上 N 个并发执行的工具。它们全部推入同一个合并队列，由唯一的消费者（`run` 生成器）按**到达顺序**逐条产出。所有生产者都结束且队列排空，这一轮才结束。

开启上下文时产生的记录也走同一个泵：首次运行的 bootstrap 和压缩后的 `openNextContext` 都经它发布连接事件对与工具集记录，因此这些记录同样实时流出。

这一机制决定了消息传递的三条基本性质：

- 消费方看到的是一条**全序**的消息流，不需要自己做多路归并。
- 不同生产者的消息按到达时刻交错：工具输出的先后是**完成顺序**，与调用顺序无关。
- 同一生产者内部的顺序保持不变：LLM 流内部有序，单个工具的分片也有序。

## 一轮内的可见顺序

一个带两次工具调用的轮次，消费方按序观察到：

```text
 1   event     request_begin
 2   partial   partial_thinking(start → delta… → stop)
 3   complete  thinking                       ← the complete message right after stop
 4   partial   partial_text(start → delta… → stop)
 5   complete  text
 6   partial   partial_tool_call A(start → delta… → stop)
 7   complete  tool_call A
 8   event     approval_decision(allow, A)    ← approvals are sequential; A starts executing
 9   partial   partial_tool_call B(…)         ← the LLM stream continues, not waiting for A
10   complete  tool_call B
11   event     approval_decision(allow, B)
12   partial   partial_tool_call_output B(…)  ← B produces output first: completion order
13   complete  tool_call_output B
14   event     token_usage                    ← the LLM stream's last message
15   event     request_end(completed)         ← emitted when the LLM stream ends, not waiting for tools
16   partial   partial_tool_call_output A(…)  ← late output lands after request_end
17   complete  tool_call_output A
     (A and B settled → re-fed in A, B original order → next request_begin)
```

### 拒绝与否决

某个 `tool_call` 遭拒时，第 8 行记录拒绝决策，随即产出一条合成的 `aborted` `tool_call_output`，不派发执行。决策和输出文本都写明是谁拒绝的：

| 拒绝方 | `approval_decision` | 合成输出 |
| --- | --- | --- |
| 审批回调 | `deny` | "Tool call denied by user." |
| 命令策略 | `forbidden` | "Tool call denied by policy." |
| `pre_tool_use` 钩子 | `deny` | "Tool call denied by the <name> hook: <reason>." |

钩子作答时，`approval_decision` 之前会紧挨着记录一条 `hook` 事件。

## 顺序保证与非保证

下面两张表分别列出消费方可以依赖和不可依赖的顺序。

### 有保证

| 保证 | 含义 |
| --- | --- |
| 分片纪律 | 每段严格 `start → delta* → stop`，完整消息紧随其后；全部 delta 拼接 ≡ 完整消息 |
| 审批位次 | `approval_decision` 在其 `tool_call` 之后、该工具的任何输出之前 |
| 配对完整 | 每个已提交的 `tool_call` 恰好对应一条完整的 `tool_call_output`（被拒绝的是合成输出） |
| LLM 流收尾 | 请求正常完成时，`token_usage` 是 LLM 流的最后一条，`request_end` 紧随其后；未完成的请求不产出 `token_usage` |
| 提交判据 | `request_end.status === "completed"` ⇔ 该轮已被网关提交（回放据此取舍） |
| 流序 = Trace 序 | 边流边写；Trace 只滤掉分片与 `origin` 消息 |
| 传输有序 | SSE 按通道投递，事件 id 单调递增；断线重连时从 `Last-Event-ID` 补发，或收到 `resync_required`，见 [Server API](/server-api) |

### 无保证

渲染层不得依赖以下顺序：

| 非保证 | 含义 |
| --- | --- |
| 工具输出顺序 | 到达顺序是完成顺序；多个工具的分片会交错，须按 `tool_call_id` 归属 |
| `request_end` ≠ 轮结束 | 仍在执行的工具输出可以出现在 `request_end` 之后、下一个 `request_begin` 之前 |
| 事件与内容的相对间隔 | `approval_decision` 与该工具首条输出之间可能插入 LLM 流的后续消息 |

## 流序与上下文序

同一批工具输出存在两种顺序，服务两个不同的消费者：

- **流序**（完成顺序）面向 Human：谁先完成谁先可见，保证实时渲染。
- **上下文序**（原始调用顺序）面向模型：进入下一轮输入之前，输出按 `tool_call` 的原始顺序重排，符合供应商的配对规则。

> [!WARNING]
> 渲染层不得按到达顺序重建上下文。按 `tool_call_id` 把每条输出挂回对应的调用即可，上下文顺序由 engine 负责。

## 边界情形的时序

以下情形在流上可见的顺序：

| 情形 | 流上可见的顺序 |
| --- | --- |
| 用户中断 | （已产出的消息）→ `abort` 事件，这是本次运行中 engine 的最后一条消息（其后只可能出现 stop 钩子的 `hook` 事件）；补发内容只进模型上下文，不上流、不进 Trace |
| 自动重连 | 携带 `retry_in_ms` 的 `request_end(retryable)` → 新的 `request_begin`（最多连续 5 次无进展的重试，指数退避、上限 30 秒）；`[turn_retried]` 块仅模型可见 |
| LLM 失败导致运行结束 | `request_end(fatal)`，或重试耗尽后不带 `retry_in_ms` 的 `request_end(retryable)`，是本次运行中 engine 的最后一条消息（其后只可能出现 stop 钩子的 `hook` 事件）；不会再有 `abort` 事件，因为 `abort` 只标记用户中断 |
| 上下文压缩 | `compaction_begin` → 压缩请求在旧上下文中执行（压缩请求的原始消息只写 Trace，例外是每次尝试的 `token_usage`，以及正在生成的思考与摘要，它们以普通的 `partial_thinking`/`partial_text` 或 `thinking`/`text` 在区间内转发）→ `compaction_end(status)` |
| 达到 max_turns | 长度提示（`[reached max turns (N); stopping]`）→ 运行结束；未提交的输入按补发保留 |
| Prompt 本身 | 写入 Trace，但不回流（调用方已经有了） |
| `session_meta` | 主 Session 的输出流只在会话内切换模型时产出它，作为切换的最后一条：新上下文的 meta，记录 Session 此后所用的模型。其余时候它在 Trace 与历史接口中。子 Agent 子流的第一条消息是子 Session 的 `session_meta` |

## 跨 Session：origin 链

`run_subagent` 派生的子 Session 有自己完整的消息流。转发给父级时，每条子消息的 `origin` 前插一跳子 Session id，并与父级自己的消息按到达时刻交错；渲染层按 `origin` 把消息归入对应的嵌套卡片。

子消息不写入父 Trace：父 Trace 只保留 `subagent` 指针事件，子 Session 的流序记录在它自己的 Trace 里。

## 传输层顺序（SSE）

Server 把上述输出流原样（单行 JSON）推入每个 Session 的 SSE 通道。事件 id 单调递增，有界缓冲区支持断线补发；重放窗口已失效时，Server 发送 `resync_required`。

重连时，补发的缺口（或 `resync_required`）在前，随后才是权威的 `task_state` 快照与未决审批；全新连接不重放，首个事件就是 `task_state`。

细节见 [Server API](/server-api)，自带 Web App 的「连接先行 + 去重」消费模式也在该页。
