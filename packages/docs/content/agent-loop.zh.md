---
title: Agent 运行循环
description: session.run 如何驱动 Task 与轮次：审批、工具并发执行、钩子、运行中插话、自动重连与上下文压缩。
---

SDK 唯一的执行入口是 `session.run(newMessages, opts?)`：输入是本次新增的 OmniMessage 列表（Prompt），返回值是一个异步生成器，流式产出 [OmniMessage](/omni-message)。一次 `run` 驱动一个完整的 Task，直到模型给出不含工具调用的最终答复；若 [Stop hook](#stop-hook) 要求继续，同一次 `run` 会接连驱动多个 Task。

本页先给出 `context_engine` 的总体流程，再逐个环节拆解；逐条消息的可见时序与顺序保证见[消息流转与时序](/message-flow)。源码：`packages/core/src/engine/context-engine.ts`。

## 总体流程

下图追踪一次 `run` 调用从进入到返回的全过程。

```text
session.run(newMessages, { approve, signal })
  │  carry-over from a previous interrupt? → prepend to this run's input
  ▼
┌── turn loop (≤ max_turns; default -1 = no cap) ───────────────┐
│                                                               │
│  request_begin                                                │
│  LLM.streamGenerate(newMessages)                              │
│    ├─ streams partial_* fragments + complete msgs             │
│    ├─ for each complete tool_call:                            │
│    │     pre_tool_use hooks (if installed), then              │
│    │     approve(toolCall) ──deny──► synthetic aborted output │
│    │          │allow           (approvals sequential;         │
│    │          ▼                 decision audited)             │
│    │     Environment.executeTool ──► runs concurrently,       │
│    │                                 output streams back      │
│    └─ LLMOutcome:                                             │
│         retryable ──► reconnect within the turn               │
│          (≤5 fruitless, with [turn_retried]; tools not rerun) │
│         fatal ──► keep carry-over, run returns (no abort)     │
│  token_usage + request_end (at LLM-stream end; not waiting    │
│                              for tools)                       │
│                                                               │
│  tool outputs reordered to original call order ──► next turn  │
│  no tool_call this turn? ──► Task ends                        │
│  compaction trigger (context/turns)? ──► summarize/discard    │
│                                          + Trace rotation     │
└───────────────────────────────────────────────────────────────┘
  │
  ▼
stop hooks (each answer → a `hook` event; the first `continue` ──► its input
becomes the next Task's user message, same run) ── no continue? ──► run returns

signal fires (any point) ──► emit abort + build carry-over ──► run returns
```

全程的每条消息与事件同时流向两个去处：实时推给 Human，同时写入 [Trace](/sessions-and-traces)。

## 输入与输出

```ts
const agent = await createAgent({ agentId: "default_agent" });
const session = await agent.createSession({ workspaceDir: process.cwd() });

for await (const output of session.run([userText("Clean up the CSV files under data/")], {
  approve: async (toolCall) => "allow",
  signal: abortController.signal,
})) {
  // output: partial_* fragments, complete model_msg, event_msg
}
```

```ts
interface RunOptions {
  signal?: AbortSignal;       // interrupt (e.g. Ctrl-C)
  approve?: ApproveFn;        // per-tool approval; denies everything when omitted (conservative default)
  preToolUse?: PreToolUseFn;  // pre-tool-use hook consult, called before approve for each complete tool_call
}
```

`preToolUse` 由 Session 根据 Agent 已安装的钩子包自行填入（见 [Pre-tool-use hook](#pre-tool-use-hook)）。

生成器的返回值说明本次运行如何结束：正常跑完为 `null`，否则是一个 `RunCutoff`：

```ts
interface RunCutoff {
  kind: "abort" | "llm_failure" | "compaction_failure" | "max_turns";
  errorCode?: ErrorCode;
  errorMessage?: string;
}
```

## 一轮的生命周期

Task 由若干连续的 Request（轮）组成。每一轮：

1. 引擎产出 `request_begin`。
2. LLM 流式返回 `partial_*` 分片，随后是完整消息。
3. 每个完整的 `tool_call` 先交给已安装的 `pre_tool_use` 钩子，再恰好触发一次 `approve` 回调（钩子已作出决定时除外）；决策记为一条 `approval_decision` 事件。
4. 通过审批的调用在 Environment 中并发执行，审批本身则逐个进行；工具输出按完成顺序流出。
5. LLM 流结束时，正常完成的请求先产出最后一条 `token_usage`，随即产出 `request_end(status)`。这一步**不等待工具**：仍在执行的工具输出可以出现在 `request_end` 之后。未完成的请求不产出 `token_usage`。
6. 整批工具调用全部到达终态后，工具结果**按原始调用顺序重排**，作为下一轮的输入；在此之前不会发起下一次 Request。

某一轮不再产生 `tool_call` 时，Task 结束。

拒绝会生成一条合成的 `aborted` 工具输出，供模型据此继续。输出文本取决于拒绝方：

| 拒绝方 | 模型收到的工具输出 |
| --- | --- |
| 审批回调 | `Tool call denied by user.` |
| [命令策略](/configuration#命令策略)的 `forbidden` 决策（见 [ApproveFn](/interfaces#approvefn)） | `Tool call denied by policy.` |
| `pre_tool_use` 钩子 | `Tool call denied by the <name> hook: <reason>.` |

## 中断与补发

`signal` 触发后，引擎产出 `abort` 事件并立即返回，同时为下一次 `run` 构造补发内容。以 `fatal` 收场的请求会构造同样的补发内容，但不产出 `abort` 事件（见[自动重连](#自动重连)）。

补发什么，取决于这一轮进行到了哪一步：

| 场景 | 条件 | 补发内容 |
| --- | --- | --- |
| A | 模型输出已完成：该轮的 `tool_call` 已提交 | 已完成的工具结果按结构化 `tool_call_output` 补发；未执行完的调用补上 `[interrupted: tool aborted by user]` 占位，保证 `tool_call` 与输出严格配对。 |
| B | 模型输出未完成 | 整轮压平为一段 `[turn_aborted]` 用户文本，携带已产生的部分输出。 |

中断若发生在 Request 发出之前，输入原样保留为补发内容，不压平，多模态输入因此不会丢失。

补发内容只进入模型上下文，不写入 Trace：Trace 永远只记录真实发生的消息。

## 钩子

**钩子**是 Session 在循环的固定点上执行的函数。目前有三个钩子点：

| 钩子点 | 触发时机 | 小节 |
| --- | --- | --- |
| `stop` | 一个 Task 结束的那一刻：模型给出不含工具调用的最终答复，或被掐断（用户中断、LLM 失败、达到 `max_turns` 上限） | [Stop hook](#stop-hook) |
| `pre_tool_use` | 每个工具调用审批之前 | [Pre-tool-use hook](#pre-tool-use-hook) |
| `user_prompt` | 用户提交 Prompt 时 | [User-prompt hook](#user-prompt-hook) |

Session 咨询的钩子，就是安装在 Agent 的 `agent_state/hooks/` 目录里的钩子包，由[插件](/skills#钩子包)携带，像 Skill 一样每个 Session 都重新读取。SDK 嵌入方也可以经 `SessionConfig.hooks.stop` / `.preToolUse` / `.userPrompt` 注册进程内函数。

已安装的钩子是纯 Node 脚本，像 Claude Code 运行 command hook 那样以子进程运行。它只被告知去哪里看，其余一切都由它从 Trace 推导：Token 用量、轮数、Task 的结束方式，以及它自己的状态文件。退出码非零即为失败，stderr 的末尾成为 reason；超时的脚本会被终止，超时时长取清单里的 `timeout`，缺省 60 秒。

### Stop hook

```text
stdin   { "hook": "stop", "session_id": "…", "trace_path": "/abs/…/<session>_001.jsonl" }
stdout  nothing = no opinion; otherwise
        { "decision": "continue" | "stop",   // continue: `input` becomes the next Task's user message
          "input": "…",
          "reason": "one line for people",
          "output": { "…": scalars },        // the hook's own record
          "subagent": { "prompt": "…", "agent_id": "…" } }   // ask for a detached background subagent
exit    non-zero = failure (stderr's tail becomes the reason); a timeout (default 60 s) kills it
```

`trace_path` 是正在写入的 Trace 文件，即当前的上下文分段；压缩会换到新文件。没有 Trace 的 Session 不带这个字段。

规则如下：

- 每个 Task 结束后，钩子按注册顺序逐个执行。
- 每条非空回答都会记录为一条 [`hook` 事件](/omni-message#eventmsg)，字段包括 `hook`、`name`（包名）、`decision`、`reason` 和 `output`。事件推到流上并写入 Trace。注入的输入不在事件里，它是紧随其后的那条 user 消息。
- 第一个 `continue` 生效。它的输入带上 [`sender: "harness"`](/omni-message#modelmsg完整消息) 标记先推到流上，再在同一次 `run` 调用内驱动下一个 Task。普通运行从不产出自己的输入，宿主据流渲染这条注入的输入；说明它来自 harness 的是这一标记，而不是文本内容。无人 `continue` 时调用返回。
- Task 被掐断之后，或 signal 已中止时，`continue` 只记录、不执行：用户的中断压过一切钩子。
- `subagent` 回答让 Session 派生一个游离的后台子 Session（同一 Agent，或 `agent_id` 指定的 Agent），以该 prompt 为第一条 user 消息。它继承本次运行的审批回调，输出流被丢弃（它自己的 Trace 才是记录），其 Session id 以 `output.session_id` 记在事件上。
- 钩子失败（崩溃、打印的不是 JSON，或超时）时，以错误信息为 `reason` 记录，按无意见处理，永远不会拖垮运行。

插件库内置两个钩子包：

- [目标模式](/goal-mode)：它的 stop 钩子读取目标文件、作出判定，并交回下一轮的协议消息。
- **`continual-learning`** 插件（不预装）：刚结束的 Task 跑了超过 30 个完成的轮次、且 Agent 至少装有一个 Skill 时触发。它把该 Task 浓缩成摘录（user 与 assistant 文本、工具调用与参数、工具输出，各自截断，不含思考与图片），并以 `subagent` 请求作答：prompt 里给出 Skill 目录与该 Task 调用过的 Skill，请子会话把值得沉淀的发现写进相关 `SKILL.md`，或者什么都不改。

continual-learning 的窗口就是 Task 本身：Trace 里自它的输入消息起的记录；压缩在 Task 中途换了文件时，窗口即新文件所含的内容。因此一个 Task 至多在结束时触发一次，短 Task 从不触发。

### Pre-tool-use hook

钩子包还可以声明 `pre_tool_use` 命令，写在它的 `hooks.json` 里（由插件的 `hooks.pre_tool_use` 生成）。引擎在每个完整的工具调用上、审批回调**之前**咨询一次，沿用同一套子进程契约，调用本身随 stdin 给出：

```text
stdin   { "hook": "pre_tool_use", "session_id", "trace_path",
          "tool_name": "exec_command", "tool_call_id": "…", "arguments": "<raw argument JSON>" }
stdout  nothing = no opinion; otherwise
        { "decision": "allow" | "deny",   // deny: refuse the call; allow: approve it without asking
          "reason": "one line for people",
          "output": { "…": scalars } }    // the hook's own record
```

规则与 stop 点一致：每个非空回答记一条 `hook` 事件，第一个决定生效，崩溃、非 JSON 输出或超时都记录下来并按无意见处理。另有三条自己的规则：

- **deny** 不咨询审批回调，直接拒绝调用；模型在工具输出里读到拒绝，其中含钩子名与 `reason`。
- **allow** 不询问宿主，直接放行。但[命令策略](/configuration#命令策略)仍然压过它：钩子包在 Agent 可写的状态里，策略是 Project 持有的安全配置，被策略否决的调用无论钩子怎么答都保持 `forbidden`。deny 只会收窄原本会执行的范围。
- 脚本跑在**热路径**上：每个工具调用执行前都要咨询一次。脚本要轻快，并在清单里设置较小的 `timeout`。

没有内置插件使用这个钩子点，它留给自定义守卫：项目专属的沙箱规则、审计日志，或为已知安全的调用跳过审批弹窗的放行清单。

### User-prompt hook

第三个钩子点 `user_prompt` 用来扩展提交的 Prompt。钩子只在 core 里运行：宿主接受某个包所负责流程的用户 Prompt 时，经 `Session.runUserPromptHook(name, prompt, extras)` 触发它，Session 自己补上 id 与 scratchpad 目录。

```text
stdin   { "hook": "user_prompt", "session_id", "scratchpad_dir", "prompt", …host extras (goal: "budget") }
stdout  { "context": "<text appended after the user's message>" }
```

回答里的 `context` 紧随用户自己的消息之后、以 harness 标记发出，渲染为紧凑的折叠卡片。包未安装、或没有声明 `user_prompt` 命令时，调用返回 `null`。这个钩子点不记 `hook` 事件，扩展出的那条消息本身就是记录。

[目标模式](/goal-mode)的启动是唯一的内置用途：goal 插件的 `start.mjs` 就是它的 `user_prompt` 命令。服务端收到 `goal: { budget }` 时请 Session 运行它，它写下 `GOAL.json`，并以第 1 轮的协议消息作答。

## 运行中插话

Task 运行期间，宿主可以用 `session.steer(input)` 排队一条用户消息（`input` 是 OmniMessage 列表，与 `run` 接收 Prompt 的形状一致），而不打断循环。到下一次组装输入时，引擎把它随那一轮送出。

### 插话消息如何送达

- 引擎把它作为一条**独立的用户文本消息**送出，内容包裹在 `[user_steering]…[/user_steering]` 中。
- 它与该轮的工具输出一起发送；该轮没有工具调用时，它单独作为继续输入发送，Task 不会就此结束。

### 插话消息中的文本与图片

- 输入中的用户文本成为标记块的正文。
- 图片紧跟其后，作为普通的用户图片消息送出，因此一张没有配文的图片本身就是一条完整的插话。
- 模型不支持视觉时，图片折叠成 `[attached image: <path>]` 行，写在标记块**内部**，与 Prompt 的图片走同一条路。标记块必须仍是整条文本，否则这条消息会丢掉插话身份，被当成新 Task。

### 送达保证

- 插话是真实的用户输入：像 Prompt 一样写入 Trace、推送到输出流，恢复重放时按普通轮次输入处理；工具输出本身从不被改写。
- 队列在**每次**组装输入时排空，包括运行中压缩完成后的那一次；压缩请求期间到达的插话照样送达，不会被吞掉。
- 排队中的后台任务完成回报在同样的组装点送达，排在插话之前，用户自己的话总在最后。
- 队列只在运行退出（含中断）时丢弃。

### 插话 API

| 调用 | 效果 | 返回值 |
| --- | --- | --- |
| `session.steer(input)` | Task 运行期间把输入排入队列 | 没有 Task 在运行时返回 `false`，宿主此时改为提交普通 Task |
| `session.unsteer(input)` | 在送达之前撤回已排队的输入 | 输入已送达或运行已退出时返回 `false` |

## 输入图片

一张输入图片要么以图片消息随请求发送，要么变成一行 `[attached image: <path>]`，指向会话 scratchpad 里的文件；模型再用 `read_file` 查看，Web App 则从路径还原缩略图。这个转换是每个 Session 绑定一次的同一个函数（Session 是唯一同时知道 scratchpad 和模型能力的层），各输入路径自行决定是否应用它：

| 输入 | 折叠条件 | 应用时机 |
| --- | --- | --- |
| Prompt（`run`） | 模型没有视觉能力 | `run` 入口，早于写 Trace 和取标题素材 |
| 插话（`steer`） | 模型没有视觉能力 | 投递时，即轮次边界：入队必须保持同步，而且若入队时就折叠，中止时被丢弃的队列会留下孤儿文件 |

目标模式没有自己的规则：随目标附带的图片在第 1 轮随用户消息发出，像 Prompt 的图片一样折叠；之后的轮次只重新注入目标文本。见[目标模式](/goal-mode)。

## 自动重连

只有 `retryable` 的 LLM 失败会触发同一次运行内的重连；`fatal` 失败立即结束运行。

### 可重试失败与致命失败

`retryable` 这一类有意划得很宽，包括：

- 传输中断与空闲超时；
- `408`、`429` 和 `5xx` 响应；
- 解析失败或被截断的响应，例如响应 JSON 解析失败、流被干净地截断；
- 分类器无法归类的一切错误。

fatal 判定是一份确定性的白名单，所以用自己的说法描述瞬时故障的网关（例如 `Upstream HTTP/2 stream failed`）照样能重试。可重试失败的具体原因记在请求的 `error_code`（`timeout`、`network` 或 `malformed`）与 `error_message` 上。

`fatal` 失败立即停止运行、不重试，包括：

- 供应商确定性的 `4xx` 拒绝，例如参数无效或配额耗尽（`408` 与 `429` 除外）；
- 凭据失败（`auth`）；
- 客户端确定性的拒绝，例如在没有 fast 档位的模型上开启 fast 模式（`unsupported`）；
- 无法组装成请求的输入（`invalid_input`）。

同样的请求只会以同样的方式失败，走退避阶梯只会推迟用户本可据以处理的错误信息。

### 一轮如何重试

重连时，引擎重发原始输入，并附加 `[turn_retried]` 块携带上一次的部分输出；这个块把累积的输出带进每一次重试，因此工具不会重复执行。

### 退避阶梯

默认的上限与等待时间：

| 属性 | 值 |
| --- | --- |
| 连续无进展重连的上限 | 5 |
| 退避基数 | 2 秒 |
| 退避上限 | 30 秒 |
| 等待序列 | 2 秒、4 秒、8 秒、16 秒、30 秒 |
| 总耐心 | ≈ 60 秒 |
| 每轮绝对上限 | 20 次尝试 |

所有可重试失败共用这一张时间表。这样定是为了让供应商重启、限流这类瞬时故障有真正的恢复时间，同时每次计划等待都不低于 Web App 2 秒的倒计时下限，重试始终可见。

断开前**收到过内容**的尝试（例如响应中途的 `terminated: other side closed (UND_ERR_SOCKET)`）说明连接已建立、模型正在产出，所以它的失败让阶梯从 2 秒重新起步，而不是继续攀升：同一轮里断两次 socket，不该累加成放弃的理由。给这种归零兜底的是另一条绝对上限，单轮总尝试 20 次，只有「每次吐几个字就断」的端点才够得着。`attempt` 始终累计每一次尝试，不随阶梯归零回退。

### 运行何时放弃

运行在两种情况下放弃：`fatal` 失败，以及重试耗尽的 `retryable` 失败。两种情况都不产出 `abort` 事件，因为 `abort` 只标记用户中断：`request_end` 即终局记录，本轮尚未了结的状态保留为下一次运行的补发内容。

- `fatal` 失败的终局 `request_end` 状态为 `fatal`，并带 `error_code` 与 `error_message`。
- 重试耗尽时，终局 `request_end` 状态为 `retryable`，带 `attempt` 与错误字段，但没有 `retry_in_ms`；重试输入（原始输入加上它的 `[turn_retried]` 块）保留为补发内容。

Session 创建时锁定的只有模型引用，凭据在 Session 装载时取自当前 Project 配置，因此凭据失败后，用户更新该模型的 API key 再发送即可。

### 重试状态与用户控制

每个将要重试的失败都在 `request_end` 上以 `retry_in_ms` 宣告计划等待（与实际休眠同一公式），每个失败都标注 `attempt`：本次重试序列内的权威序号，从 1 开始，CLI 与 Web App 直接显示它。等待刻意做成可见的：用户看不见的重试，等于一次没有任何解释、也无从退出的卡顿。

Web App 把等待渲染成实时倒计时，并提供两个按钮：

| 按钮 | 效果 |
| --- | --- |
| **立即重试** | 经 `Session.skipReconnectWait` 跳过剩余等待，尝试计数不变 |
| **放弃** | 普通中断；引擎的退避中中断路径会结束本轮 |

CLI 则打印自己的 `[retry]` 行。

### 压缩请求的重试

压缩请求是一次普通的 LLM 请求，默认沿用同一重连上限与退避阶梯，无效摘要也计入同一预算（见[上下文压缩](#上下文压缩)）；唯一的区别是收到过内容不会让压缩的阶梯归零。放弃的压缩保留原上下文，等下一次触发再试。

工具错误从不重试：它们作为 `tool_call_output` 反馈给模型，由模型决定下一步。

## 上下文压缩

压缩不只是缩短历史：**每次压缩都会轮换出一个全新的模型上下文**。压缩完成后，Agent 的全部运行配置按此刻的 Agent State 重新装配，与新建 Session 的首个上下文完全相同，Trace 随之开启新文件。一个 Trace 文件恒等于一个模型上下文。

因此，对话进行中对 Agent 配置的修改会在下一次压缩后生效。唯一的例外是 `compaction` 一节本身：引擎在每个压缩检查点重读它，修改立即对进行中的对话生效。

### 设置、触发条件与模式

压缩配置由组装层从 `system_config.yaml` 填充：

```ts
interface CompactionSettings {
  maxContextLength: number;   // context-token threshold (last token_usage's request.total); <=0 disables
  maxSessionTurns: number;    // cumulative Session turn threshold (counted across Tasks); <=0 = unlimited
  mode: "summarize" | "discard";
  prompt: string;             // the Prompt used by summarize compaction
}
```

三种触发方式（记在 `compaction_begin.reason`）：

| reason | 条件 |
| --- | --- |
| `context` | 上一轮的 `token_usage.request.total` ≥ 生效的上下文阈值 |
| `turns` | Session 轮数 ≥ `maxSessionTurns`（默认 -1，即不限） |
| `manual` | 用户运行 `/compact` 或调用 `session.compact()`，或在会话内切换模型（切换先用当前模型压缩） |

`context` 触发的生效阈值取 `maxContextLength`（默认 256000）与模型 `context_window` − 2048 中的较小者：32k 的本地 vLLM 因此在约 30.7k 处压缩，而不是先撞上窗口上限；1M 窗口的模型则在配置的 256000 处触发。条目没有可用的 `context_window`（未配置或小于 4096）时，按 128000 的假定窗口推导，即约 126k。

两种模式：

| 模式 | 行为 |
| --- | --- |
| `summarize`（默认） | 向旧上下文追加压缩 Prompt，提取 `[summary]` 后包装为 `[context_summary]` 用户文本，在全新的模型上下文中继续 |
| `discard` | 直接丢弃旧上下文。Task 进行中会等到 Task 结束再丢弃，否则这个 Task 就无法继续 |

系统标记统一写作 `[tag]…[/tag]`；读取旧 Trace 与旧的持久化压缩 Prompt 时，仍识别早期的尖括号形式（`<summary>`、`<context_summary>` 等）。

摘要提取自带容忍阶梯：

1. 优先取第一个非空的 `[summary]` 标签对。
2. 标签对全为空时，改取剥离标签后剩余的文本，兼容把正文写在闭合标签之后的模型。
3. 完全没有标签时，整段输出原样使用。

压缩时 [Trace 文件](/sessions-and-traces)随之轮转（`_002`、`_003`……），一个 Trace 文件恒等于一个完整的模型上下文。调用 `session.compact()` 之前，可以用 `compactability()` 探询可行性（`ok | unsupported | empty | just_compacted`）。

### 组装新上下文

新上下文**按此刻的 Agent State 整体装配**，与新建 Session 的首个上下文完全相同，包括：

- 整份 `system_config.yaml`：提示词模板及各节提示词与开关、内置工具条目与 MCP Server、压缩配置、`max_turns`、模型默认参数；
- `AGENTS.md`；
- vault；
- 已装 Skill 的元数据；
- Memory 索引；
- 定时任务名单；
- 环境字段中的日期。

因此旧上下文期间的修改，无论是模型改自己的配置，还是用户在 Agent 设置里手改，都在下一次压缩时生效，不必等下一个 Session。

### 运行时参数分层

运行参数分三层：

| 层级 | 参数 | 规则 |
| --- | --- | --- |
| 严格层 | 系统提示词、工具集（含 MCP）、模型引用 | 在运行中的上下文内绝不改变。它们构成请求前缀，上下文的前缀自开启固定到关闭，因此整个 Trace 文件内供应商的提示词缓存始终有效。 |
| 软限制层 | 思考等级 | 纯粹的逐请求参数，允许在上下文中途更换，不记入 Trace，代价是供应商的消息缓存失效。 |
| 不限制层 | 审批模式；`compaction` 一节（`max_context_length`、`max_session_turns`、`mode`、`prompt`） | 逐次决策或在每个压缩检查点重读，修改立即生效，且不触及请求。 |

- 每次 LLM 请求取 Session 钉住的思考等级（Web App 对话内的选择器，或 CLI 的 `--thinking` / `/thinking`），未钉住时取上下文开启时读到的 Agent 配置缺省值。选择器会提醒先压缩，因为中途更换会让供应商的消息缓存失效。
- 审批模式逐次决策时从数据库重读，因此修改即刻生效。
- 引擎在每个压缩检查点（每次请求回报 Token 用量之后，以及手动 `/compact` 时）从 `system_config.yaml` 重读 `compaction` 一节，并按文件 mtime 缓存，因此调低 Agent 的阈值对已在运行的对话立即生效，不必等轮换。读盘失败时沿用已生效的配置，不会让运行失败。
- 压缩配置本就不属于请求前缀：它决定上下文何时结束，而不是上下文长什么样。
- vault、工具的 `r`/`rw` 权限和 Project 的命令策略都不进入模型请求，但随同一轮换节奏，在每个上下文开启时读取一次。

### 重新装备 Environment

轮换时，Environment 随之重新装备：

- vault 的值直接进入此后每条命令的子进程环境；已在运行的进程保留启动时的环境。
- MCP Server 按配置缓存：条目未变的保持连接与已发现的工具，被删除或改动的关闭，只有新增、改动或上次连接失败的才去连接，等待期间流式发出与首次运行相同的 `mcp_connect_begin` / `mcp_connect_end` 事件对，随后是新的 `tool_list_ready`。

轮转出的新 Trace 文件以记录本上下文所用提示词的 `session_meta` 开头，随后是连接事件对（如有）与工具集记录。

整个 Session 生命周期内固定的只有 Session 自身：id、Workspace 与来源。模型条目（含凭据、窗口与逐模型标注）按上下文固定：普通轮换沿用当前条目，会话内切换模型时按磁盘上的 Project 配置解析目标条目（见 [Session 与 Trace](/sessions-and-traces#会话内切换模型)）。

Agent State 无法装配（例如配置文件已无法解析）时，本次运行以该错误结束，引擎保持旧上下文，与新建 Session 遇到的是同一个错误。恢复时发现上下文已被完成的压缩关闭，同样按此规则开启新上下文（见 [Session 与 Trace](/sessions-and-traces)）。

### 压缩请求

压缩请求**保持 Session 的工具集不变**：请求前缀（含工具列表）与普通轮次逐字节一致，确保上下文最大的时刻供应商的提示词缓存依然有效。

只有得到有效摘要，压缩才算成功。响应里调用了工具、或提取出的摘要为空，都算一次失败的尝试：

- 其中的工具调用先以合成的失败输出逐一应答，保持 `tool_use`/`tool_result` 配对完整。
- 重发的请求在压缩 Prompt 前附加一条纠正说明：已提交的历史只能追加，改写会使提示词缓存失效。

无效摘要与 `retryable` 失败共用上文[自动重连](#自动重连)中的同一重连预算与退避阶梯。

首个**已提交**的尝试（无论被采纳还是被判无效）还会把折进压缩请求的本轮输入（Task 中途的工具结果，或手动 `/compact` 折入的补发内容）吸收进旧上下文的历史：重试只重发修复输出与压缩 Prompt，此后也不再重发已吸收的输入。

### 压缩何时放弃

预算耗尽后，压缩以 `retryable` 结束（即本次放弃），保留原上下文与 Trace 文件，等待下次触发。`fatal` 失败让压缩立即以 `fatal` 结束：配置或凭据改变之前，下次触发也会撞上同一堵墙。用户中断则以 `aborted` 结束。

`compaction_end` 复用统一的重试详情块：`attempt`（最终尝试序号，失败尝试也计入），失败时还有最后一次的 `error_code` 与 `error_message`（聊天横幅与 CLI 行直接展示）。以 `retryable` 或 `fatal` 结束的压缩，还会作为一条 `compaction_failed` 错误记录进入成本中心。

被放弃的压缩**留待补做**，而不是就地凑合：

- Task 中途：运行结束。本轮尚未了结的状态按同一条「是否已提交」规则保留为补发内容，下一条消息把补发内容与用户输入合并重发，阈值依然超标，压缩在那里再次触发。这类运行的终局记录是 `compaction_end`，只有用户中断了压缩时才会跟着 `abort` 事件。
- Task 边界上：直接结束本次运行，保留原上下文。

两种情形都不会合成任何东西，让循环在本该缩小的上下文上硬跑下去。

### 工具与 Task 中途压缩

**Task 中途**触发的压缩绝不抢在工具前面：`runTurn` 要等本轮全部工具调用执行完毕才返回，因此到达检查点时结果已经就绪，也已与 `tool_call` 配对。

这些结果随后随压缩请求本身发出，排在压缩 Prompt 之前，保持原始调用顺序：工具产出什么（正常结果、`[tool error]`、拒绝回执），摘要就据此写成。需要审批或要跑几分钟的工具只会让压缩延后，由于压缩请求尚未发出，没有任何计时在跑。全程不插入任何合成消息去闭合这次交换。

### 观察压缩过程

压缩请求运行期间，每次尝试的 `token_usage`，以及它写出的思考与摘要，都会上行到输出流，位于成对的压缩事件之间：思考与摘要以普通的 `partial_thinking` 与 `partial_text` 出现（不产出流式消息的 LLM 实现则为完整的 `thinking` / `text`）。不新增事件类型，压缩请求的其他原始消息一如既往只写 Trace。压缩请求与其他每次 LLM 请求一样携带 Session 钉住的思考等级；未钉住时取该模型上下文开启时的等级。

Web App 把压缩行呈现为一个运行中的工作分组，两层里只展开一层：

- 组头的标题兼作状态：进行中为**压缩中**（或**清空中**），结束后为**压缩完毕**（或**清空完毕**），与工作分组组头的**运行中**/**运行完毕**同一写法；标题还带 wall time，进行中实时计时，结束后定格。
- 压缩运行期间，该行展开，其中两节不展开：**思考**（请求产出了思考时才有）与**压缩结果**各是一条折叠的行，各自带标签与自己的 wall time。读者能看到它们存在、各花了多久，而压缩请求的原始过程不会落进正文。

压缩结束后，该行自行收起，只留下一行摘要。summarize 压缩一开始就带上折叠箭头，读者展开任一节即可实时观看请求的过程，或事后阅读结果。

历史重建从压缩区间已记录的思考与输出读回同一段内容，刷新后与实时视图一致。渲染对话的消费方本就把区间内的模型消息视为压缩内部消息，所以不会漏进正文，CLI 也不打印其中任何内容。

### 未完成的压缩区间

用户中途退出程序导致没写完的压缩（进程死在请求中途，留下没有配对 end 的 `compaction_begin`），就是一次**被放弃的压缩**。Session 下次加载时，恢复流程在续写任何内容之前先以 `retryable` 的 `compaction_end` 收束该区间，并**丢弃写了一半的摘要**：不做任何重建，原上下文照旧，阈值依然超标，压缩留待下次触发时补做。

收束区间正是让其后对话保持可见的关键：所有读取方都把成对事件之间的消息当作压缩内部消息。Web App 同时从压缩行里丢掉那段半成品草稿，不把截断的摘要摆成已被采纳的样子。

## 并发模型

- 一轮之内：审批逐个进行，执行并发，下一轮输入保持原始顺序。
- 同一 Session 内：同时只有一个 Task 或一次压缩在运行。Task 运行中或压缩进行中时，Server 对新 Task 返回 `409`；请求设置了 `queueIfBusy` 时，则把它作为后续任务排队。
- [子 Agent](/tools) 是独立的 Session，拥有自己的 Trace 与运行循环，消息以 `origin` 标记转发给父级。

## 旁路通道

- **Session 标题**：`session.generateTitle()` 是一次性的旁路 LLM 调用（无工具、无系统提示词、不开思考），不进入历史与 Trace。
- **用量落账**：每轮的 `token_usage` 事件由 Server 逐条入库，构成成本统计的原始数据。
