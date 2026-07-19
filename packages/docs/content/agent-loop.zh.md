---
title: Agent 运行循环
description: context_engine 的总体流程图与逐环节拆解——审批、并发工具执行、中断补发、自动重连与上下文压缩。
---

SDK 的唯一执行入口是 `session.run(newMessages, opts?)`：输入本次新增的 OmniMessage 列表(Prompt)，返回一个异步生成器，流式产出 [OmniMessage](/omni-message)。一次 `run` 自动跑完一个完整的 Task，直到模型给出不含工具调用的最终答复。

本页先给出 context_engine 的总体流程，再逐环节拆解；逐条消息级的可见时序与顺序保证见[消息流转与时序](/message-flow)。源码：`packages/core/src/engine/context-engine.ts`。

## 总体流程

```text
session.run(newMessages, { approve, signal })
  │  存在上次中断的补发内容?→ 前置到本轮输入
  ▼
┌── 轮循环(≤ max_turns,默认 100)──────────────────────────────┐
│                                                               │
│  request_begin                                                │
│  LLM.streamGenerate(newMessages)                              │
│    ├─ 流式产出 partial_* 分片 + 完整消息(thinking/text/…)     │
│    ├─ 每个完整 tool_call:                                     │
│    │     approve(toolCall) ──deny──► 合成 aborted 输出         │
│    │          │allow                (审批逐个;写审计事件)     │
│    │          ▼                                               │
│    │     Environment.executeTool ──► 并发执行,输出流式回传    │
│    └─ LLMOutcome:                                             │
│         timeout / malformed ──► 同轮自动重连(≤2 次,          │
│                                 附 <turn_retried>,工具不重跑) │
│  token_usage + request_end(LLM 流结束即产出,不等工具)         │
│                                                               │
│  工具输出按原始调用顺序重排 ──► 作为下一轮输入                 │
│  本轮无 tool_call?──► Task 结束,run 返回                      │
│  压缩触发(context/turns)?──► summarize/discard + Trace 轮转  │
└───────────────────────────────────────────────────────────────┘

signal 中断(任意时刻)──► 产出 abort 事件 + 构造补发内容 ──► run 返回
```

全程的每条消息与事件同时流向两个去处：实时输出给 Human，以及写入 [Trace](/sessions-and-traces)。

## 输入与输出

```ts
const agent = await createAgent({ agentId: "default_agent" });
const session = await agent.createSession({ workspaceDir: process.cwd() });

for await (const output of session.run([userText("整理 data/ 下的 CSV 文件")], {
  approve: async (toolCall) => "allow",
  signal: abortController.signal,
})) {
  // output: partial_* 分片、完整 model_msg、event_msg
}
```

```ts
interface RunOptions {
  signal?: AbortSignal;    // 中断信号(如 Ctrl-C)
  approve?: ApproveFn;     // 逐工具审批;未注入时默认全部拒绝(保守策略)
}
```

## 一轮(Turn)的生命周期

Task 由若干连续的 Request(轮)组成，每轮：

1. 产出 `request_begin`;
2. LLM 流式返回：`partial_*` 分片与完整消息依次产出；
3. 每个完整的 `tool_call` 恰好触发一次 `approve` 回调，决策以 `approval_decision` 事件记录；
4. 通过审批的工具交给 Environment **并发执行**(审批本身逐个进行)，输出按完成顺序流出；
5. LLM 流结束时，先产出其最后一条 `token_usage`，随即产出 `request_end(status)`——**不等待工具**，仍在执行的工具输出可出现在 `request_end` 之后；
6. 整批工具全部到达终态后，工具结果**按原始调用顺序**重排，作为下一轮输入——在此之前不会发起下一次 Request。

某轮不再产生 `tool_call` 时，Task 结束。拒绝(deny)会生成一条合成的 `aborted` 工具输出(内容为 `Tool call denied by user.`)，模型据此继续。

## 中断与补发(carry-over)

`signal` 触发中断后，引擎产出 `abort` 事件并立即返回，同时为下一次 `run` 构造补发内容：

- **场景 A：模型输出已完成**(该轮 `tool_call` 已提交)——已完成的工具结果按结构化 `tool_call_output` 补发；未执行完的调用补上 `[interrupted: tool aborted by user]` 占位，保证 `tool_call` 与输出严格配对；
- **场景 B：模型输出未完成**——整轮压平为一段 `<turn_aborted>` 用户文本，携带已产生的部分输出。

补发内容只进入模型上下文，不写入 Trace——Trace 永远只记录真实发生的消息。

## 自动重连

只有 LLM 侧的 `timeout`(网络超时、限流、5xx)与 `malformed`(流截断、JSON 解析失败)会触发引擎内自动重连：同一次 `run` 内重发原始输入，并附加 `<turn_retried>` 块携带上一次的部分输出，避免工具重复执行。默认最多重连 2 次，线性退避(基数 250ms)；超限后该轮以 `failed` 收场。工具错误从不重试——它们作为 `tool_call_output` 反馈给模型，由模型决定下一步。

## 上下文压缩(Compaction)

压缩配置由组装层从 `system_config.yaml` 填充默认值：

```ts
interface CompactionSettings {
  maxContextLength: number;   // 上下文 Token 阈值(取最近一次 token_usage 的 request.total);<=0 关闭
  maxSessionTurns: number;    // Session 累计轮数阈值(跨 Task 计数);<=0 不限制
  mode: "summarize" | "discard";
  prompt: string;             // summarize 模式使用的压缩 Prompt
}
```

三种触发方式(`compaction_begin.reason`):

| reason | 触发条件 |
| --- | --- |
| `context` | 上一轮 `token_usage.request.total` ≥ `maxContextLength`(默认 128000) |
| `turns` | Session 轮数 ≥ `maxSessionTurns`(默认 -1，即不限) |
| `manual` | 用户执行 `/compact` 或调用 `session.compact()` |

两种模式：`summarize`(默认)向旧上下文追加压缩 Prompt，提取 `<summary>` 后包装为 `<context_summary>` 用户文本，在**全新的模型上下文**中继续；`discard` 直接丢弃旧上下文。压缩时 [Trace 文件随之轮转](/sessions-and-traces)(`_002`、`_003`……)，一个 Trace 文件恒等于一个完整模型上下文。`session.compact()` 前可用 `compactability()` 探询可行性(`ok | unsupported | empty | just_compacted`)。

## 并发模型

- 同一轮内：审批逐个、执行并发、下一轮输入按原始顺序；
- 同一 Session：同时只有一个 Task 或一次压缩在运行(Server 侧以 409 拒绝并发请求);
- [Subagent](/tools) 是独立 Session，拥有自己的 Trace 与运行循环，消息以 `origin` 标记转发给父级。

## 相关旁路

- **Session 标题**:`session.generateTitle()` 走独立的一次性 LLM 调用(无工具、无系统 Prompt)，不进入历史与 Trace;
- **用量落账**：每轮的 `token_usage` 事件被 Server 逐条入库，构成成本统计的原始数据。
