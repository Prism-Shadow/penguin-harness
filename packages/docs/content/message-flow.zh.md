---
title: 消息流转与时序
description: 消息在 Human、engine、LLM、Environment 与 Trace 之间的传递机制，每一处顺序保证与非保证，以及流序与上下文序的区别。
---

[OmniMessage 协议](/omni-message)定义了消息**是什么**，本页讲清消息**怎么传、以什么顺序可见**：传递路径、汇流机制、一轮内的可见时序、哪些顺序有保证、哪些没有，以及"流上的顺序"与"模型上下文的顺序"为何是两回事。源码依据：`packages/core/src/engine/context-engine.ts`。

## 一轮的传递路径

五个参与者：Human(SDK 调用方)、engine(context_engine)、LLM、Environment、Trace。一轮之内：

```text
Human ──run(newMessages)──► engine
                            engine ──写 Prompt──────────────────────► Trace
                            engine ──request_begin──► Human 与 Trace
                            engine ──streamGenerate(新消息)──► LLM
        ┌─────────────────  LLM 流式返回 partial_* 与完整消息  ────────┐
        │  engine 逐条转发:每条同时 ──► Human(yield)与 ──► Trace(写) │
        └─────────────────────────────────────────────────────────────┘
   完整 tool_call ──► engine:await approve(tc)(逐个)
                            engine ──approval_decision──► Human 与 Trace
                 allow ──► Environment.executeTool(并发,不阻塞 LLM 流)
        Environment ──partial_tool_call_output──► Human 与(完整时)Trace
   LLM 流结束:最后一条 token_usage,随即 request_end ──► Human 与 Trace
   仍在执行的工具继续流出输出(可晚于 request_end)
   全部输出齐 ──► 按原始调用顺序重排,作为下一轮 LLM 输入
```

要点：**每条消息在进入输出流的同时写入 Trace**，因此流序与 Trace 序一致(Trace 跳过分片与带 `origin` 的消息，见 [Session 与 Trace](/sessions-and-traces))。

## 单一汇流点：MergeQueue

一轮内存在多个并发生产者：消费 LLM 流的驱动任务，加上 N 个并发执行的工具。它们全部 push 进同一个合并队列，由**单一消费者**(`run` 生成器)按**到达顺序**逐条 yield；生产者全部完成且队列排空，这一轮才结束。

这一机制决定了消息传递的三条基本性质：

1. 消费方看到的是一条**全序**的消息流，不需要自己做多路归并；
2. 不同生产者的消息按到达时刻交错——工具输出的先后是**完成顺序**，与调用顺序无关；
3. 同一生产者内部的顺序被保留(LLM 流内部有序；单个工具的分片有序)。

## 一轮内的可见顺序

一个带两次工具调用的轮，消费方按序观察到(标注示例):

```text
 1   event     request_begin
 2   partial   partial_thinking(start → delta… → stop)
 3   complete  thinking                       ← stop 后立即跟完整消息
 4   partial   partial_text(start → delta… → stop)
 5   complete  text
 6   partial   partial_tool_call A(start → delta… → stop)
 7   complete  tool_call A
 8   event     approval_decision(allow, A)    ← 审批逐个,决策即产出;A 开始并发执行
 9   partial   partial_tool_call B(…)         ← LLM 流继续,不等 A
10   complete  tool_call B
11   event     approval_decision(allow, B)
12   partial   partial_tool_call_output B(…)  ← B 先有输出:完成顺序,非调用顺序
13   complete  tool_call_output B
14   event     token_usage                    ← LLM 流的最后一条
15   event     request_end(completed)         ← LLM 流结束即产出,不等工具
16   partial   partial_tool_call_output A(…)  ← 迟到输出出现在 request_end 之后
17   complete  tool_call_output A
     (A、B 输出齐 → 按 A、B 原始顺序进入下一轮输入 → 下一个 request_begin)
```

若某条 `tool_call` 被拒绝，第 8 行的决策为 `deny`，随即产出一条合成的 `aborted` `tool_call_output`(内容 `Tool call denied by user.`)，不派发执行。

## 顺序保证与非保证

**有保证：**

| 保证 | 说明 |
| --- | --- |
| 分片纪律 | 每段严格 `start → delta* → stop`，完整消息紧随其后；全部 delta 拼接 ≡ 完整消息 |
| 审批位次 | `approval_decision` 在其 `tool_call` 之后、该工具任何输出之前 |
| 配对完整 | 每个已提交的 `tool_call` 恰好对应一条完整 `tool_call_output`(拒绝为合成输出) |
| LLM 流收尾 | `token_usage` 是 LLM 流的最后一条，`request_end` 紧随其后 |
| 提交判据 | `request_end.status === "completed"` ⇔ 该轮已被网关提交(回放据此取舍) |
| 流序 = Trace 序 | 逐条"边流边写";Trace 只是滤掉分片与 `origin` 消息 |
| 传输有序 | SSE 按通道单调 id 投递，断线按 `Last-Event-ID` 补发或 `resync_required`，见 [Server API](/server-api) |

**无保证(渲染层不得依赖):**

| 非保证 | 说明 |
| --- | --- |
| 工具输出顺序 | 到达顺序是完成顺序；多工具的分片可交错，须按 `tool_call_id` 归属 |
| `request_end` ≠ 轮结束 | 仍在执行的工具输出可出现在 `request_end` 之后、下一个 `request_begin` 之前 |
| 事件与内容的相对间隔 | `approval_decision` 与首条工具输出之间可能插入 LLM 流的后续消息 |

## 流序与上下文序

同一批工具输出存在两种顺序，服务两个不同的消费者：

- **流序(完成顺序)**——面向 Human：谁先完成谁先可见，保证实时性；
- **上下文序(原始调用顺序)**——面向模型：进入下一轮输入前按 `tool_call` 的原始顺序重排，保证与 Provider 的配对约定一致。

因此**渲染层不得用到达顺序重建上下文**——按 `tool_call_id` 把输出挂回对应调用即可；上下文顺序由 engine 负责。

## 边界情形的时序

| 情形 | 流上可见的顺序 |
| --- | --- |
| 用户中断 | (已产出的消息)→ `abort` 事件——`run` 返回前的最后一条；补发内容只进模型上下文，不上流、不进 Trace |
| 自动重连 | `request_end(timeout \| malformed)` → 新的 `request_begin`;`<turn_retried>` 块仅模型可见 |
| 上下文压缩 | `compaction_begin` → 压缩请求在旧上下文中执行(其流式输出**不上行**，只写 Trace)→ 该请求的 `token_usage` → `compaction_end(status)` |
| 达到 max_turns | 长度提示消息 → 结束；未提交的输入按补发保留 |
| Prompt 本身 | 写入 Trace，但不回流(输入方已有) |
| session_meta | 主 Session 的输出流不产出它(存在于 Trace 与历史接口中);Subagent 子流的**第一条**是子 Session 的 `session_meta` |

## 跨 Session:origin 链

`run_subagent` 派生的子 Session 有自己的完整消息流。转发给父级时，每条子消息的 `origin` 前插一跳子 Session id，与父级本地消息**按到达时刻交错**；渲染层按 `origin` 归入对应子会话卡片。子消息不写父 Trace——父 Trace 只保留 `subagent` 指针事件，子 Session 的流序记录在它自己的 Trace 里。

## 传输层顺序(SSE)

Server 把上述输出流原样(单行 JSON)推入 per-Session SSE 通道：事件 id 单调递增，有界缓冲支持断线补发，重放窗口失效时以 `resync_required` 通知客户端重拉历史。事件次序：重连时补发的缺口(或 `resync_required`)在前，随后才是权威的 `task_state` 快照与未决审批；全新连接不重放缓冲，首条即为 `task_state` 快照。细节见 [Server API](/server-api) 的流式接口一节；自带 Web App 的"连接先行 + 去重"消费模式亦在该页。
