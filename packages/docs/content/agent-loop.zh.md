---
title: Agent 运行循环
description: session.run 如何驱动 Task 与轮次：审批、工具并发执行、钩子、运行中插话、自动重连与上下文压缩。
---

SDK 唯一的执行入口是 `session.run(newMessages, opts?)`：输入是本次新增的记录列表（Prompt），返回值是一个异步生成器，流式产出 [AMSP 记录](/amsp-records)。一次 `run` 驱动一个完整的 Task，直到模型给出不含工具调用的最终答复；若 [Stop hook](#stop-hook) 要求继续，同一次 `run` 会接连驱动多个 Task。

本页先给出 `context_engine` 的总体流程，再逐个环节拆解；逐条消息的可见时序与顺序保证见[消息流转与时序](/message-flow)。源码：`packages/core/src/engine/context-engine.ts`。

## 总体流程

下图追踪一次 `run` 调用从进入到返回的全过程。

```text
session.run(newMessages, { approve, signal })
  │  carry-over from a previous interrupt? → prepend to this run's input
  │  the user's own Prompt? → user_prompt hooks; each context follows it
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
  userPrompt?: UserPromptFn;  // user-prompt hook consult, called once with the Prompt before the first request
}
```

`preToolUse` 与 `userPrompt` 由 Session 根据 Agent 已安装的钩子包自行填入（见 [Pre-tool-use hook](#pre-tool-use-hook) 与 [User-prompt hook](#user-prompt-hook)）。

生成器的返回值说明本次运行如何结束：正常跑完为 `null`，否则是一个 `RunCutoff`：

```ts
interface RunCutoff {
  kind: "abort" | "llm_failure" | "compaction_failure" | "max_turns";
  errorCode?: ErrorCode;
  errorMessage?: string;
}
```

`compaction_failure` 只有一种成因：Task 中途根本无法开启新的上下文，压缩要关闭的上下文因此原样保留，本轮尚未了结的输入成为补发内容。请求被拒后的交接同样如此（见[请求被拒时的交接](#请求被拒时的交接)）；成功开启新上下文的交接不算截断。摘要取不到从不结束运行（见[取不到摘要时](#取不到摘要时)）。

## 一轮的生命周期

Task 由若干连续的 Request（轮）组成。每一轮：

1. 引擎产出 `request_begin`。
2. LLM 流式返回 `partial_*` 分片，随后是完整消息。
3. 每个完整的 `tool_call` 先交给已安装的 `pre_tool_use` 钩子，再恰好触发一次 `approve` 回调（钩子已作出决定时除外）；决策记为一条 `approval_decision` 事件。
4. 通过审批的调用在 Environment 中并发执行，审批本身则逐个进行；工具输出按完成顺序流出。
5. LLM 流结束时，正常完成的请求（或停在输出上限的请求）先产出最后一条 `token_usage`，随即产出 `request_end(status)`。这一步**不等待工具**：仍在执行的工具输出可以出现在 `request_end` 之后。未完成的请求不产出 `token_usage`。
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
| A | 模型输出已完成：该轮的 `tool_call` 已提交 | 工具结果按结构化 `tool_call_output` 补发；运行中被中断的调用自有一条 `aborted` 结果，装着已产出的内容和中断提示。没有结果的调用补上 `[interrupted: tool aborted by user]` 占位，保证 `tool_call` 与输出严格配对。 |
| B | 模型输出未完成 | 整轮压平为一段 `[turn_aborted]` 用户文本，携带已产生的部分输出。 |

中断若发生在 Request 发出之前，输入原样保留为补发内容，不压平，多模态输入因此不会丢失。

补发内容只进入模型上下文，不写入 Trace：Trace 永远只记录真实发生的消息。

## 钩子

**钩子**是 Session 在循环的固定点上执行的函数。目前有三个钩子点：

| 钩子点 | 触发时机 | 小节 |
| --- | --- | --- |
| `stop` | 一个 Task 结束的那一刻：模型给出不含工具调用的最终答复，或被掐断（用户中断、LLM 失败、达到 `max_turns` 上限） | [Stop hook](#stop-hook) |
| `pre_tool_use` | 每个工具调用审批之前 | [Pre-tool-use hook](#pre-tool-use-hook) |
| `user_prompt` | 用户每次提交 Prompt 时，在 Task 的首个请求之前 | [User-prompt hook](#user-prompt-hook) |

Session 咨询的钩子，就是安装在 Agent 的 `agent_state/hooks/` 目录里的钩子包，无论是[插件](/skills#钩子包)携带的，还是有人（包括 Agent 自己）手写进去的。它们像 Skill 一样，连同 `hooks.enabled` 开关，在每个模型上下文开启时从磁盘读取：创建 Session 时、每次压缩之后，以及恢复时。新上下文的钩子整体替换旧的，因此对话中写入的钩子包从下一个上下文起生效。SDK 嵌入方也可以经 `SessionConfig.hooks.stop` / `.preToolUse` / `.userPrompt` 注册进程内函数。

已安装的钩子是纯 Node 脚本，像 Claude Code 运行 command hook 那样以子进程运行。这个子进程与命令完全一样，在 Session 的[沙盒](/settings#沙盒)下运行：同一份策略，同一个后端。沙盒无法封禁它时，该次钩子失败，reason 以 `hook failed: sandbox:` 开头，脚本绝不会脱离封禁运行。它只被告知去哪里看，其余一切都由它从 Trace 推导：Token 用量、轮数、Task 的结束方式，以及它自己的状态文件。退出码非零即为失败，stderr 的末尾成为 reason；超时的脚本会被终止，超时时长取清单里的 `timeout`，缺省 60 秒。

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
- 每条非空回答都会记录为一条 [`hook` 事件](/amsp-records#eventmsg)，字段包括 `hook`、`name`（包名）、`decision`、`reason` 和 `output`。事件推到流上并写入 Trace。注入的输入不在事件里，它是紧随其后的那条 user 消息。
- 第一个 `continue` 生效。它的输入带上 [`sender: "harness"`](/amsp-records#modelmsg完整消息) 标记先推到流上，再在同一次 `run` 调用内驱动下一个 Task。普通运行从不产出自己的输入，宿主据流渲染这条注入的输入；说明它来自 harness 的是这一标记，而不是文本内容。无人 `continue` 时调用返回。
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

第三个钩子点 `user_prompt` 在**用户每次提交 Prompt 时**运行：`run` 的输入含用户本人的文本（`sender` 缺省或为 `"user"` 的 user 文本）即触发。别人写下的输入不触发：定时任务、公司模式触发这类 `server` 输入，子 Agent 收到的 `parent_agent` 输入，stop hook 的续跑输入，后台任务的完成回报，以及运行中插话。引擎在 Prompt 写入 Trace 之后、Task 的首个请求之前咨询一次，钩子包按包名顺序执行，同一个包的命令按清单顺序执行。

```text
stdin   { "hook": "user_prompt", "session_id", "trace_path", "scratchpad_dir", "prompt" }
stdout  nothing = nothing to add; otherwise
        { "context": "<text sent right behind the user's message>" }
exit    non-zero = failure (stderr's tail becomes the reason); a timeout (default 60 s) kills it
```

`prompt` 是用户的文本，开头的标记块（例如 `[use_skills]`）已剥离，多条文本以换行相连。没有 Trace 的 Session 不带 `trace_path`。

每个非空的 `context` 成为一条带 [`sender: "harness"`](/amsp-records#modelmsg完整消息) 标记的 user 文本，按钩子顺序紧随用户自己的消息：推到流上，紧随 Prompt 写入 Trace，并与 Prompt 一起在 Task 的首个请求中发出；宿主把它渲染为紧凑的折叠卡片。这条消息本身就是记录，成功的钩子不留 `hook` 事件。钩子失败（退出码非零、打印的不是 JSON、超时或抛错）时，在同一位置记为一条 `hook: "user_prompt"` 的 `hook` 事件，以错误信息为 `reason`，并按无意见处理，永远不会拖垮运行。

脚本跑在每条 Prompt 的热路径上：要轻快，在清单里设置较小的 `timeout`，context 也要简短，因为每条 Prompt 模型都要读它。

**宿主触发的命令。** `user_prompt` 命令可以在 `hooks.json` 里带 `"trigger": "host"`，缺省为 `"prompt"`。这样的命令不参与上述咨询，只在宿主按包名启动该包自己的流程时，经 `Session.runUserPromptHook(name, prompt, extras)` 运行：Session 自己补上 id、Trace 路径与 scratchpad 目录，宿主的 `extras` 并入 stdin 字段。调用返回钩子的回答（空回答为 `{}`）；包未安装、或没有宿主触发的命令时返回 `null`。随后由宿主自己把 `context` 以 `sender: "harness"` 标记紧随用户消息、作为普通的 Task 输入发出；这条路径同样不记 `hook` 事件。进程内的 `UserPromptHook` 也有同一个可选字段 `trigger`。

[目标模式](/goal-mode)是 `host` 的唯一内置用途：goal 插件的 `start.mjs` 标记为 `"trigger": "host"`。服务端收到 `goal: { budget }` 时经 `runUserPromptHook` 运行它，并在 stdin 里附上 `budget`；脚本写下 `GOAL.json`，并以第 1 轮的协议消息作答。启动目标的那条 Prompt 仍是用户提交的 Prompt，因此其他钩子包的 `user_prompt` 钩子照常运行，它们的 context 排在 goal 的协议消息之后。

## 运行中插话

Task 运行期间，宿主可以用 `session.steer(input)` 排队一条用户消息（`input` 是记录列表，与 `run` 接收 Prompt 的形状一致），而不打断循环。到下一次组装输入时，引擎把它随那一轮送出。

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

- 供应商拒绝按原样发出的请求，即 HTTP `400`、`413`、`415` 或 `422`（`rejected`），例如参数无效，或提示词超出模型能接受的长度；上下文已有完成的轮次时，这种拒绝改为交接（见[请求被拒时的交接](#请求被拒时的交接)）；
- 供应商其余确定性的 `4xx`，例如 `402`（余额）、`403`（权限）或 `404`（模型不存在）（`denied`）：供应商不为该账号或模型提供服务。`401` 归为 `auth`，`408` 与 `429` 照常重试；
- 凭据失败（`auth`）；
- 客户端确定性的拒绝，例如在没有 fast 档位的模型上开启 fast 模式（`unsupported`）；
- 无法组装成请求的输入（`invalid_input`）。

同样的请求只会以同样的方式失败，走退避阶梯只会推迟用户本可据以处理的错误信息。

响应完整送达却停在输出上限（`finish_reason` 为 `length`），以 `retryable` 收尾，`error_code` 为 `output_truncated`；以客户端无法识别的 finish reason（`unknown`）结束的响应，同样以 `retryable` 收尾，错误码为 `malformed`。两者都不提交：LLM 接口把这一轮移出 MMSP 的历史。两者照常计量：供应商已为这次尝试计费并报告了用量，它的 `token_usage` 照常产出，只是不算作 Session 的一轮。引擎按同一阶梯、与其他可重试失败相同的规则重试，重试块里的 `[request_error]` 行写明原因，模型据此可以换一种更短的写法。

只有一种拒绝仍会重试：输入带图片的请求被供应商拒绝（`rejected`）。供应商对这类拒绝的措辞五花八门，按文字匹配并不可靠，因此只要本轮输入带图片，引擎就把这类拒绝一律视为图片被拒（`image_rejected`）：把每张图片换成一句固定说明，写明带图的请求被拒、已去图重发（供应商的报错原文经重试输入的 `[request_error]` 行到达模型，见下文）；该次尝试记为 `retryable`、`retry_in_ms: 0`，清理后的输入立即重发。清理后的输入此后一直是本轮的输入，中断或下一条消息都不会再发送这张图。恢复 Session 时也做同样的替换。输入不带图片的请求被拒（包括去图重发后再次被拒）时，上下文已有完成的轮次就改为交接，否则照常是 fatal：被拒的图片已在已提交的历史中时，重试也去不掉它。`denied` 的请求从不去图重发。

### 请求被拒时的交接

上下文已有完成的轮次时，供应商拒绝按原样发出的请求（`rejected`）不会结束运行。这个上下文的前缀此前已被接受，变化的只有增长的历史或这次发出的输入，同样的补发内容在之后每次运行都会被拒：通常是上下文超出了模型的真实窗口，因为模型的 `context_window` 配置得比供应商实际提供的更大。harness 自己的 Token 计数分辨不出这种情况，所以识别只看 HTTP 状态码，从不看供应商的措辞。引擎不发压缩请求（此时已无法发出）就关闭这个上下文，并以[交接说明](#取不到摘要时)开启下一个上下文：

- 被拒的那次尝试记为一次重试：`request_end` 为 `retryable`、`error_code: "rejected"`、`retry_in_ms: 0`。
- 随后是一个不含请求的压缩区间：`compaction_begin`（reason 为 `context`，mode 为 `summarize`），然后是 `completed` 的 `compaction_end`，带 `error_code: "rejected"` 与供应商的 `error_message`，不带 `attempt`。
- 交接说明引述供应商的报错，并要求模型不要重建同样的输入，而是分段读取大文件和大段输出，免得产出过一次超大输出的模型再产出一次。
- 被拒的那一轮排在交接说明之后重发，仍算同一轮：不占 `max_turns`，它的尝试继续计入 10 次的上限。只有它的文本随之重发（Prompt、插话、通知）；它的工具输出与已关闭上下文中的调用配对，因此不带，交接说明改为引述最后一轮的输出。

只有同时满足以下条件才交接：拒绝为 `rejected`，上下文已有完成的轮次，Session 能开启新上下文（没有接入压缩的 SDK 嵌入方照旧结束运行），且本次运行的此类交接少于 3 次。阈值与 `compaction.mode` 不起作用：阈值关闭时、`discard` 模式下，请求被拒照样交接，因为交接说明不花模型调用，否则这个 Session 将再也发不出任何请求。恢复的上下文从 Trace 计算已完成的轮次，因此供应商拒绝重放历史时同样交接。

以下情况绝不交接：`denied`、`auth`、`unsupported`、`invalid_input` 以及任何 `retryable` 失败；一个上下文的第一个请求（全新的 Session，或任何压缩、交接、模型切换之后的第一个请求），因此连续第二次被拒会以供应商的报错结束运行；一次运行中的第四次拒绝。输入带图片时先走图片规则，去图后再次被拒才交接。压缩自己的请求另有阶梯（见[取不到摘要时](#取不到摘要时)）。新上下文无法开启时，区间以 `fatal` 结束，上下文保留，运行以 `compaction_failure` 结束，与任何压缩相同。

你会看到：一行重试记录（「[已重试]：已发起第 2/10 次请求（模型服务拒绝了请求，HTTP 400）」），没有报错；一行**压缩完毕**，其状态图标说明留给压缩的空间不足；输入框上方的一条提示，附**打开 Agent 设置**。CLI 的完成行给出同样的说明，成本中心记下一条预期内的 `context_refused`。修正办法是两个数值之一：更正模型的上下文窗口，或调低 Agent 的压缩阈值（见[供应商拒绝请求时](/configuration#供应商拒绝请求时)）。

### 一轮如何重试

重连时，引擎重发原始输入，并附加 `[turn_retried]` 块携带上一次的部分输出；这个块把累积的输出带进每一次重试，因此工具不会重复执行。块末有一行 `[request_error code=…]…[/request_error]`，原文引述最近一次失败的错误码与报错；它在每次尝试时重新生成，重试五次也只有一行，模型因此能读到请求为何失败，而不是在一无所知的情况下再收到一遍同样的输入。请求失败后构造的 `[turn_aborted]` 块也带同样的一行，下一条消息或「重试」会告诉模型这一轮为什么被重发。

### 退避阶梯

默认的上限与等待时间：

| 属性 | 值 |
| --- | --- |
| 连续无进展重连的上限 | 5 |
| 退避基数 | 2 秒 |
| 退避上限 | 30 秒 |
| 等待序列 | 2 秒、4 秒、8 秒、16 秒、30 秒 |
| 总耐心 | ≈ 60 秒 |
| 每轮绝对上限 | 10 次尝试 |

所有可重试失败共用这一张时间表。这样定是为了让供应商重启、限流这类瞬时故障有真正的恢复时间，同时每次计划等待都不低于 Web App 2 秒的倒计时下限，重试始终可见。

断开前**收到过内容**的尝试（例如响应中途的 `terminated: other side closed (UND_ERR_SOCKET)`）说明连接已建立、模型正在产出，所以它的失败让阶梯从 2 秒重新起步，而不是继续攀升：同一轮里断两次 socket，不该累加成放弃的理由。给这种归零兜底的是另一条绝对上限，单轮总尝试 10 次，「每次吐几个字就断」的端点会撞上它，一再停在输出上限的响应也会。`attempt` 始终累计每一次尝试，不随阶梯归零回退。

### 运行何时放弃

运行在两种情况下放弃：`fatal` 失败，以及重试耗尽的 `retryable` 失败。两种情况都不产出 `abort` 事件，因为 `abort` 只标记用户中断与轮次上限：`request_end` 即终局记录，本轮尚未了结的状态保留为下一次运行的补发内容。

- `fatal` 失败的终局 `request_end` 状态为 `fatal`，并带 `error_code` 与 `error_message`。
- 重试耗尽时，终局 `request_end` 状态为 `retryable`，带 `attempt` 与错误字段，但没有 `retry_in_ms`；重试输入（原始输入加上它的 `[turn_retried]` 块）保留为补发内容。

Session 创建时锁定的只有模型引用，凭据在 Session 装载时取自当前 Project 配置，因此凭据失败后，用户更新该模型的 API key 再发送即可。

### 重试状态与用户控制

每个将要重试的失败都在 `request_end` 上以 `retry_in_ms` 宣告计划等待（与实际休眠同一公式），每个失败都标注 `attempt`：本次重试序列内的权威序号，从 1 开始，CLI 与 Web App 直接显示它。等待刻意做成可见的：用户看不见的重试，等于一次没有任何解释、也无从退出的卡顿。

Web App 把等待渲染成一行「23 秒后发起第 3/10 次请求」：到下一次尝试的实时倒计时，分母是引擎每轮的尝试上限；原因与服务方原话收在带圈问号里，并提供两个操作：

| 操作 | 效果 |
| --- | --- |
| **立即重试** | 经 `Session.skipReconnectWait` 跳过剩余等待，尝试计数不变 |
| **放弃重试** | 普通中断；引擎的退避中中断路径会结束本轮 |

CLI 则打印自己的 `[retry]` 行。

### 压缩请求的重试

压缩请求是一次普通的 LLM 请求，但有自己的预算。传输类失败沿用同一退避阶梯重试，上限为 `compactionMaxReconnects`（默认与普通轮次相同，为 5），在整个压缩内累计：收到过内容不会让它归零。其余情形都不原样重发：不是摘要的已提交响应经应答后作为一个工具轮再问（见[压缩请求](#压缩请求)），停在输出上限的响应、被拒的请求与耗尽的阶梯则以交接说明结束压缩（见[取不到摘要时](#取不到摘要时)）。

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
  maxRounds?: number;         // how many times the harness asks again before the summary; absent or <=0 = none
  reminder?: string;          // sent behind the tool outputs when it asks again; blank = no line
  handoffNote?: string;       // the hand-off note's template; blank = the quoted data alone
}
```

三种触发方式（记在 `compaction_begin.reason`）：

| reason | 条件 |
| --- | --- |
| `context` | 上一轮的 `token_usage.request.total` ≥ 生效的上下文阈值 |
| `turns` | Session 轮数 ≥ `maxSessionTurns`（默认 -1，即不限） |
| `manual` | 用户运行 `/compact` 或调用 `session.compact()`，或在会话内切换模型（切换先用当前模型压缩） |

请求被拒后的交接同样记为 reason `context`，但它不由这些设置触发：无论设置如何都会发生，阈值关闭与 `discard` 模式也不例外（见[请求被拒时的交接](#请求被拒时的交接)）。

`context` 触发的生效阈值取 `maxContextLength`（默认 256000）与「模型 `context_window` − 预留」中的较小者。预留为窗口的八分之一，至少 8192、至多 32768 Token，是压缩本身在窗口下方需要的空间：触发压缩那一轮尚未发出的输出、压缩 Prompt、模型写出的摘要，以及一段余量。32k 的本地 vLLM 因此在 24,576 处压缩，200k 窗口的模型在 175,000 处压缩；窗口不小于 288,768 的模型则在配置的 256000 处触发。条目没有可用的 `context_window`（未配置或小于 4096）时，按 128000 的假定窗口推导，即 112,000。

两种模式：

| 模式 | 行为 |
| --- | --- |
| `summarize`（默认） | 向旧上下文追加压缩 Prompt，允许模型先用由 harness 计数的几个工具轮写下交接文件，再提取 `[summary]`（取不到时由 harness 写一份交接说明）包装为 `[context_summary]` 用户文本，在全新的模型上下文中继续 |
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
- 已装钩子包，连同 `hooks.enabled` 开关；
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
| 不限制层 | 审批模式；`compaction` 一节（`max_context_length`、`max_session_turns`、`mode`、`prompt`、`max_rounds`、`reminder`、`handoff_note`） | 逐次决策或在每个压缩检查点重读，修改立即生效，且不触及请求。 |

- 每次 LLM 请求取 Session 钉住的思考等级（Web App 对话内的选择器，或 CLI 的 `--thinking` / `/thinking`），未钉住时取上下文开启时读到的 Agent 配置缺省值。选择器会提醒先压缩，因为中途更换会让供应商的消息缓存失效。
- 审批模式逐次决策时从数据库重读，因此修改即刻生效。
- 引擎在每个压缩检查点（每次请求回报 Token 用量之后，以及手动 `/compact` 时）从 `system_config.yaml` 重读 `compaction` 一节，并按文件 mtime 缓存，因此调低 Agent 的阈值对已在运行的对话立即生效，不必等轮换。读盘失败时沿用已生效的配置，不会让运行失败。一次压缩只用开始它的那个检查点读到的这一节，压缩进行中保存的修改从下一次压缩起生效；请求被拒的交接开始前同样先重读。
- 压缩配置本就不属于请求前缀：它决定上下文何时结束，而不是上下文长什么样。
- vault、工具的 `r`/`rw` 权限和 Project 的命令策略都不进入模型请求，但随同一轮换节奏，在每个上下文开启时读取一次。

### 重新装备 Environment

轮换时，Environment 随之重新装备：

- vault 的值直接进入此后每条命令的子进程环境；已在运行的进程保留启动时的环境。
- MCP Server 按配置缓存：条目未变的保持连接与已发现的工具，被删除或改动的关闭，只有新增、改动或上次连接失败的才去连接，等待期间流式发出与首次运行相同的 `mcp_connect_begin` / `mcp_connect_end` 事件对，随后是新的 `tool_list_ready`。

轮转出的新 Trace 文件以记录本上下文所用提示词的 `session_meta` 开头，随后是连接事件对（如有）与工具集记录。

整个 Session 生命周期内固定的只有 Session 自身：id、Workspace 与来源。模型条目（含凭据、窗口与逐模型标注）按上下文固定：普通轮换沿用当前条目，会话内切换模型时按磁盘上的 Project 配置解析目标条目（见 [Session 与 Trace](/sessions-and-traces#会话内切换模型)）。

新上下文先开启，压缩才宣告完成，因此 Trace 里不会出现一次已完成、对应的上下文却并不存在的压缩。Agent State 无法装配（例如配置文件已无法解析）时，不换模型的轮换不再因此结束运行：新上下文沿用正在生效的配置开启，即在新的模型对象上使用同一份系统提示词与工具集。stderr 会记下一行，下一次轮换时会再读一次这个文件。模型切换在目标模型上没有正在生效的配置可沿用，因此此时压缩以 `fatal` 结束，Session 保持原模型。根本无法开启新上下文（例如无法为模型构建客户端）时，压缩同样以 `fatal` 结束，旧上下文保持为当前上下文。新建 Session，以及恢复时发现上下文已被完成的压缩关闭（见 [Session 与 Trace](/sessions-and-traces)），都没有可沿用的配置，仍以该错误结束。

### 压缩请求

压缩请求**保持 Session 的工具集不变**：请求前缀（含工具列表）与普通轮次逐字节一致，确保上下文最大的时刻供应商的提示词缓存依然有效。

每个已提交的响应只分两类，摘要与不是摘要：

| 响应包含 | 判为 |
| --- | --- |
| 没有工具调用 | 摘要（按上文的提取阶梯），提取结果为空时除外 |
| 工具调用，以及标签内已闭合的非空摘要 | 摘要。其中的调用照常应答（执行或拒绝），此后不再发送任何请求 |
| 其余情形 | 不是摘要。其中的文本只是开场白，不会被采纳，harness 再问（见下） |

已提交的历史只做追加，因此压缩的每个请求都是对上一个请求的延伸，提示词缓存不受影响。输入带图片的请求被供应商拒绝时，与普通轮次一样去掉图片再发一次。

首个**已提交**的响应还会把折进压缩请求的本轮输入（Task 中途的工具结果，或手动 `/compact` 折入的补发内容）吸收进旧上下文的历史。此后的请求只携带应答上一个响应的输出与提醒行，不再重发已吸收的输入。

### 交接文件：摘要之前的工具轮

一两段摘要装不下计划、决定记录或草稿，因此 `summarize` 压缩可以在给出摘要之前先走工具轮。默认压缩 Prompt 要求模型把这类细节写成本 Session scratchpad 下 `<scratchpad>/handoff/` 里的文件（能与摘要写在同一个回复里时就一并写；每个交接文件都起新名字，不覆盖之前写的文件，因此不必先读），约三个工具轮内完成，并把一步所需的调用放进同一个回复，再按固定小节给出摘要：请求、决定与约束、进展、错误与修正、文件（每个交接文件写绝对路径）、下一步。同意不带入下一个上下文：需要授权的事在那里重新询问。

- **只有一条规则。** 已提交的响应不是摘要、且已应答的不足 `compaction.max_rounds` 个（默认 8）时，harness 应答它的工具调用，在输出之后追加 `compaction.reminder`，一并作为下一请求的输入，不再追加压缩 Prompt：这就是一个工具轮。轮数由 harness 计数，模型不必自己数；默认的提醒行只写已用几轮、不写总数，免得这个数字变成计划。空响应（没有调用，也没有摘要）与调用全部被拒的响应同样用掉一轮。`reminder` 空白时只发工具输出，空响应此时没有可发的内容，即转入交接说明。
- **轮数用尽后**（`max_rounds` 为 `0` 或更小即没有轮），工具调用立即以 `fatal` 的 `[tool error] the compaction request expects a summary, not tool calls` 应答，既不经过工具门也不经过审批回调；此后仍不是摘要的响应以交接说明结束压缩。
- **摘要与它的写入可以在同一个回复里。** 同时包含标签内摘要与交接文件写入的响应，一个请求就结束压缩：其中的调用照常应答（执行或拒绝），此后不再向旧上下文发送任何请求。
- 工具轮能做什么由组合层的工具门决定：`read_file`，以及绝对路径位于本 Session scratchpad 内的 `write_file` / `edit_file`；其余调用以 `fatal` 的 `[tool error]` 应答并说明允许什么，既不询问也不执行。
- 工具门放行的调用与普通轮次一样经审批回调（`always-ask` 下用户逐个批准交接文件的写入），再由 Environment 执行；沙盒照常适用，`read-only` 下写入失败，模型随之直接给出摘要。
- 一轮的输出与提醒行就是下一请求的全部输入，仍发在同一个 LLM 对象上：请求只向它延续的上下文追加，提示词缓存不受影响。每轮按缓存读价重读已缓存的前缀，外加它追加的内容。
- 工具轮中被中断时，正在运行的工具随之中止，每个未应答的调用都得到应答，旧上下文保持可配对；已写下的文件留在 scratchpad 中，随 Session 存续。

`[context_summary]` 块内摘要之后空一行，追加一行被压缩上下文的 Trace 指针：`Trace file of the compacted context (JSONL, one record per line): <路径>`；没有 Trace（不写 Trace 的 SDK 嵌入方）时块内只有摘要。指针只给出路径与格式，不写查询方法。怎样精确查询 Trace 由内置插件 `trace-lookup` 的同名 Skill 说明：`default_agent` 初始化时预装，其余 Agent（含插件出现之前就已初始化的 `default_agent`）在创建时选装或经插件库安装才有。没有它，指针照常可用；指针与交接说明都不点名该 Skill，模型切换的 `[model_switch_from]` 块指向它的 Trace 文件时同此。指针属于下一个上下文的开头，从不改变运行中上下文的前缀；恢复时按被重放文件自身的路径重新生成，分叉时连同交接文件路径一起改写为分叉自己的副本。

### 取不到摘要时

一次已经开始的 summarize 压缩只有三种结局：新上下文已开启（`completed`）、用户中断了它（`aborted`），或者根本无法开启新的上下文（`fatal`）。「放弃摘要、保留旧上下文」不在其中：轮数用尽后响应仍不是摘要，或请求最终失败——被拒（不论状态码，压缩所用的模型不可用亦然）、停在输出上限（一次即转入，已写出的文字不被采用）、传输重试阶梯耗尽之后仍失败——时，新上下文以 harness 手头最好的文本开头，依次取以下两级中的第一级：

1. **完整的摘要。**
2. **交接说明**：Agent 的 `compaction.handoff_note`，harness 不调用模型，依据被关闭的 Trace 文件填好——没有摘要的原因（压缩结束时的统一错误对，被拒时即供应商的原话）、该上下文的第一条与最后三条用户消息、最后完成的一轮的文本及其最后四个工具调用与输出，以及 Trace 文件的路径，每项引述按固定字数截断（占位符见 [summarize 压缩的流程](/configuration#summarize-压缩的流程)）。普通请求被拒时直接取这一级，区间内没有请求（见[请求被拒时的交接](#请求被拒时的交接)）。

两者都是同一种 `[context_summary]` 用户文本，带法与摘要完全相同；交接说明的块内只有填好的说明。恢复时按恢复时的模板由被关闭的文件重建交接说明，因为该上下文此时才第一次开启。模型切换的最后一级是自己的 Trace 交接块（见 [Session 与 Trace](/sessions-and-traces#会话内切换模型)）。用户中断从不走这条阶梯：它保留旧上下文，应答已提交压缩响应的输出排在旧上下文下一个请求的最前面。

无论取到哪一级，运行都会继续：Task 中途，下一个请求带着这段开头发往新上下文；在 Task 边界上，这段开头等到下一次运行再发出。

`compaction_end` 复用统一的重试详情块：`attempt`（最终尝试序号，失败尝试也计入；区间内没有请求时缺省）与错误字段（聊天横幅与 CLI 行直接展示）。`completed` 的结束事件带有错误字段，表示压缩完成但没有完整的摘要，并说明原因；重放只读这一个事实来重建同样的开头，因此不带错误字段的 `completed` 与此前的重放完全一致。没有完整摘要的完成会作为一条 `compaction_degraded`（预期内）错误记录进入成本中心，供应商拒绝了请求（`rejected`）时则记为 `context_refused`；无法开启新上下文的压缩记为 `compaction_failed`。

以 `fatal` 结束时，旧上下文与它的 Trace 文件保持不变：

- Task 中途：运行以 `RunCutoff{kind: "compaction_failure"}` 结束。本轮尚未发出的输出保留为补发内容，下一条消息把它与用户输入合并重发，阈值依然超标，压缩在那里再次触发。这类运行的终局记录是 `compaction_end`，只有用户中断了压缩时才会跟着 `abort` 事件。
- Task 边界上或手动 `/compact` 时：运行照常返回，等下一次触发再试。

旧 Trace 里仍可能有以 `retryable` 或 `fatal`（或 `failed`）结束的压缩，那是此规则之前被放弃、保留了上下文的压缩，各处都照此解读。

### 工具与 Task 中途压缩

**Task 中途**触发的压缩绝不抢在工具前面：`runTurn` 要等本轮全部工具调用执行完毕才返回，因此到达检查点时结果已经就绪，也已与 `tool_call` 配对。

这些结果随后随压缩请求本身发出，排在压缩 Prompt 之前，保持原始调用顺序：工具产出什么（正常结果、`[tool error]`、拒绝回执），摘要就据此写成。需要审批或要跑几分钟的工具只会让压缩延后，由于压缩请求尚未发出，没有任何计时在跑。全程不插入任何合成消息去闭合这次交换。

### 观察压缩过程

压缩运行期间，每个请求的 `request_begin` / `request_end` 与 `token_usage`，以及它写出的思考与摘要，都会上行到输出流，位于成对的压缩事件之间：思考与摘要以普通的 `partial_thinking` 与 `partial_text` 出现（不产出流式消息的 LLM 实现则为完整的 `thinking` / `text`）；本次压缩的每个工具调用，无论执行还是被拒绝，其调用、审批决定与输出都与普通轮次一样上行。不新增事件类型；压缩 Prompt 与提醒行只写 Trace，新上下文开头的那段文本同样如此。压缩请求与其他每次 LLM 请求一样携带 Session 钉住的思考等级；未钉住时取该模型上下文开启时的等级。

Web App 把压缩行呈现为一个运行中的工作分组，两层里只展开一层：

- 组头的标题兼作状态：进行中为**压缩中**（或**清空中**），结束后为**压缩完毕**（或**清空完毕**），与工作分组组头的**运行中**/**运行完毕**同一写法；标题还带 wall time，进行中实时计时，结束后定格。
- 压缩运行期间，该行展开，其中各节不展开：**思考**（请求产出了思考时才有）、**工作**（压缩调用了工具时才有：每个调用一行工具行，例如写下的交接文件；有调用等待审批时附「允许 / 拒绝」并自行展开；被拒绝的调用显示为一行失败的工具行，内容是拒绝说明）与**压缩结果**（最后一个请求的文本），各是一条折叠的行，各自带标签。读者能看到它们存在、各花了多久，而压缩请求的原始过程不会落进正文。
- 没有完整摘要的完成，看起来与普通的完成一样，标题与 wall time 都不变，呈现只有一种：只有组头的状态图标改用 attention 色调，悬停提示说明未能生成完整摘要，新上下文改以 Trace 交接说明开头，并附原因。留给压缩的空间不足时，即供应商拒绝了请求（`rejected`），或摘要停在输出上限（`output_truncated`），悬停提示改为说明这一点，并请你更正该模型的上下文窗口或调低压缩阈值；供应商拒绝时还附上它的原话。**思考**与**工作**两节保留，没有**压缩结果**一节。
- Session 最近一次压缩由供应商拒绝请求引起时，输入框上方出现一条提示：供应商拒绝了上一次请求，对话已改由交接说明接续，请更正该模型的上下文窗口或调低 Agent 的压缩阈值，并提供**打开 Agent 设置**和**忽略**。它占用窗口过小提示的位置，两者不会同时出现；忽略只对这一次有效，之后以其他方式结束的压缩会让它自行消失。

压缩结束后，该行自行收起，只留下一行摘要。summarize 压缩一开始就带上折叠箭头，读者展开任一节即可实时观看请求的过程，或事后阅读结果。

历史重建从压缩区间已记录的思考、输出与工具调用读回同一段内容，刷新后与实时视图一致。渲染对话的消费方本就把区间内的模型消息视为压缩内部消息，所以不会漏进正文。CLI 不打印其中任何内容；压缩完成但没有完整摘要时，它的完成行末尾注明「（没有完整摘要，改用 Trace 交接说明：原因）」，留给压缩的空间不足时，括号内再接「；留给压缩的空间不足，请更正该模型的 context_window 或调低 compaction.max_context_length」。

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
