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
│    failed/timeout/malformed ──► 同轮自动重连(≤5 次,          │
│                                 附 [turn_retried],工具不重跑) │
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
  thinkingLevel?: ThinkingLevelName;   // 本次 run 的思考等级(逐轮参数,覆盖到重连重试;压缩请求用默认值)
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
- **场景 B：模型输出未完成**——整轮压平为一段 `[turn_aborted]` 用户文本，携带已产生的部分输出。

补发内容只进入模型上下文，不写入 Trace——Trace 永远只记录真实发生的消息。

## 运行中插话(Steering)

Task 运行期间，宿主可通过 `session.steer(input)` 排队一条用户消息而不打断循环（`input` 是 OmniMessage 列表，与 `run` 接收 Prompt 的形状一致）：引擎在下一次输入组装时把它作为**独立的用户文本消息**送出，内容包裹在 `[user_steering]…[/user_steering]` 中，与该轮工具输出一起进入下一次请求（该轮没有工具调用时则单独作为继续输入，Task 不会就此结束）。输入中的用户文本成为标记块的正文，图片紧跟其后，作为普通用户图片消息送出，因此一张没有配文的图片本身就是一条完整的插话；模型不支持视觉时，图片改为折叠成 `[attached image: <path>]` 路径行写在标记块**内部**，与 Prompt 的图片走同一条路（标记块必须仍是整条文本，否则这条消息会丢掉插话身份、被当成新 Task）。插话是真实的用户输入：像 Prompt 一样写入 Trace、推送到输出流，恢复重放时按普通轮次输入处理；工具输出本身从不被改写。队列在**每次**输入组装时排空——包括运行中压缩完成后的那次，压缩请求期间到达的插话不会被吞掉。没有 Task 运行时 `steer` 返回 `false`（宿主转为发起普通 Task）；仅在运行退出（含中断）时丢弃队列。

## 输入图片

一张输入图片要么以图片消息的形态跟着请求走，要么变成一行 `[attached image: <路径>]`，指向会话 scratchpad 里的文件——模型再用 `read_image` / `describe_image` 去看，Web 则从路径还原出缩略图。这个转换是每个 Session 绑定一次的同一个函数（Session 是唯一同时知道 scratchpad 目录和模型能力的层），而**是否折叠由各输入路径自己决定**：

| 输入 | 何时折叠 | 折叠时机 |
| --- | --- | --- |
| Prompt(`run`) | 模型不支持图片 | `run` 入口，早于写 Trace 和取标题素材 |
| 插话(`steer`) | 模型不支持图片 | 投递时，即 turn 边界——入队必须保持同步，而中断时被丢弃的队列若已折叠会留下没人读的孤儿文件 |
| 目标(goal) | **总是** | 抽取 objective 之前，这样路径行才能活过每一轮的重新注入 |

目标模式是唯一的例外，因为它的目标每轮都作为文本重新注入：见[目标模式](/docs/goal-mode)。

## 自动重连

除 `auth` 外，LLM 侧的所有失败都会触发引擎内自动重连——`timeout`（网络超时、传输层断连、限流、5xx、瞬时的供应商额度错误）、`malformed`（流截断、JSON 解析失败），**以及 `failed`**。`failed` 也重试，尽管分类器判定它不是瞬时错误：那个判定本质是一张允许清单（已知错误码、状态码与消息措辞），所以用自己说法描述瞬时故障的网关（例如 `Upstream HTTP/2 stream failed`）会落到这一档，此前会直接终止本轮。重试一个真正的永久错误，代价是走完退避梯度后以同样的方式收场；而把瞬时错误直接中断，则毁掉这一轮。注意改的是**策略**而非**分类**：`failed` 请求在 `request_end` 与成本中心里仍然记为 `failed`，不会被改标成超时。重连时同一次 `run` 内重发原始输入，并附加 `[turn_retried]` 块携带上一次的部分输出，避免工具重复执行。默认最多重连 5 次，指数退避并设上限(基数 250ms、上限 30s：250ms、500ms、1s、2s、4s，总耐心约 7.75s——所有可重试类别共用一张时间表，向较慢的类别递增，头几步仍与传输层抖动所需的一样快)；超限后该轮以 `failed` 收场。每次失败的 `request_end` 会以 `retry_in_ms` 宣告计划中的等待(与实际休眠同一公式)、以 `attempt` 标注这是本轮第几次尝试(权威序号,CLI 与 Web 的重试行直接显示它)，Web App 据此实时倒计时，并提供「立即重试」(经 `Session.skipReconnectWait` 跳过剩余等待——重试计数不变)与「放弃」(普通中断；引擎的退避中中断路径结束本轮)两个内联按钮，CLI 则打印自己的 `[重试]` 行。三种可重试终态的渲染完全一致——用户看不见的重试，等于一次没有任何解释、也无从退出的卡顿。压缩请求是一次普通的 LLM 请求，默认沿用同一重连上限与退避阶梯（无效摘要也计入同一预算，见「上下文压缩」一节）；压缩放弃后保留原上下文、等下一次触发再试。鉴权错误在任何重试启发式之前判定、从不重试：请求以专属终态 `auth` 收场(Session 锁定的只是模型引用，凭据在会话装载时取自当前 Project 配置)，Web App 据此禁用该 Session 的输入框，直到该模型的凭据被更新(更新后自动解锁)或用户点击「重试」。工具错误从不重试——它们作为 `tool_call_output` 反馈给模型，由模型决定下一步。

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

两种模式：`summarize`(默认)向旧上下文追加压缩 Prompt，提取 `[summary]` 后包装为 `[context_summary]` 用户文本，在**全新的模型上下文**中继续；`discard` 直接丢弃旧上下文。系统标记统一写作 `[tag]…[/tag]`；读取旧 Trace 与旧压缩 Prompt 时仍识别早期的尖括号形式（`<summary>`、`<context_summary>` 等）。摘要提取自带容忍阶梯：优先取第一个非空的 `[summary]` 标签对；标签对全为空时，改取剥离标签后剩余的全部文本（兼容把正文写在闭合标签之后的模型）；完全没有标签则整段输出照用。压缩时 [Trace 文件随之轮转](/sessions-and-traces)(`_002`、`_003`……)，一个 Trace 文件恒等于一个完整模型上下文。`session.compact()` 前可用 `compactability()` 探询可行性(`ok | unsupported | empty | just_compacted`)。

压缩请求**保持会话工具集不变**——请求前缀（含工具列表）与普通轮次逐字节一致，确保上下文最大的时刻提供商的提示词缓存依然有效。只有得到有效摘要，压缩才算成功：若响应中出现工具调用、或提取出的摘要为空，视同一次普通的失败尝试——工具调用先以合成的失败输出逐一应答（保持 `tool_use`/`tool_result` 配对完整），重发的请求在压缩 Prompt 前附加一条纠正说明（已提交的历史只能追加、不能改写，改写会使提示词缓存失效）。所有失败——无效摘要与 `failed`/`timeout`/`malformed` 传输失败——共用上文「自动重连」一节的同一重连预算与退避阶梯；只有 `auth` 会让压缩当场停止。预算耗尽后压缩以 `failed` 结束，保留原上下文与 Trace 文件，等待下次触发；`compaction_end` 复用统一的重试详情块——`attempt`(最终尝试序号,失败尝试也计入)与失败时的 `error` 详情(聊天横幅与 CLI 直接展示)，压缩失败还会作为一条 `compaction_failed` 错误记录进入成本中心。首个**已提交**的尝试（无论被采纳还是被判无效）同时会把折叠进压缩请求的本轮输入（任务中途的工具结果、手动 `/compact` 折叠的补发内容）吸收进旧上下文：重试只重发修复输出与压缩 Prompt，压缩放弃后的续跑也不再重发已吸收的输入。

## 并发模型

- 同一轮内：审批逐个、执行并发、下一轮输入按原始顺序；
- 同一 Session：同时只有一个 Task 或一次压缩在运行(Server 侧以 409 拒绝并发请求);
- [Subagent](/tools) 是独立 Session，拥有自己的 Trace 与运行循环，消息以 `origin` 标记转发给父级。

## 相关旁路

- **Session 标题**:`session.generateTitle()` 走独立的一次性 LLM 调用(无工具、无系统 Prompt)，不进入历史与 Trace;
- **用量落账**：每轮的 `token_usage` 事件被 Server 逐条入库，构成成本统计的原始数据。
