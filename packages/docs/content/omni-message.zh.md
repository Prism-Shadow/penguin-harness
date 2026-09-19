---
title: OmniMessage 协议
description: OmniMessage 是统一的消息协议：SDK 产出它，Trace 存储它，Server 经 SSE 原样推送它。
---

OmniMessage 是 PenguinHarness 的统一消息协议。SDK 产出 OmniMessage 对象，Trace 逐行存储，Server 经 SSE 原样推送。流出去的、存下来的和模型看到的是同一种结构，前端、后端与存储之间没有第二套格式。

本页先讲信封和三类消息，再逐字段列出全部 payload，最后是贯穿整个协议的规则：流式纪律、`stop_reason`、`origin` 与保真字段。类型定义见 `packages/core/src/omnimessage/types.ts`。

## 信封

每条消息共用同一个信封，只有 `payload` 不同：

```ts
interface OmniMessage<P extends OmniPayload = OmniPayload> {
  timestamp: string;        // ISO 8601 UTC
  type: "session_meta" | "model_msg" | "event_msg";
  payload: P;
  origin?: string[];        // child-Session chain (outer→inner); absent = main Session
}
```

三类消息各自承载的内容：

| type | 含义 | 数量 |
| --- | --- | --- |
| `session_meta` | 一个模型上下文的完整运行时配置 | 每个上下文恰好一条 |
| `model_msg` | 模型上下文内的内容（文本、思考、工具调用和结果） | 主体 |
| `event_msg` | 上下文之外的运行时事件（审批、用量、压缩、中断、钩子回答） | 伴随出现 |

可选的 `origin` 字段用来路由子 Agent 的消息，见 [origin：子 Session 链](#origin子-session-链)。

## session_meta

一条 `session_meta` 消息描述**一个模型上下文**：

```ts
interface SessionMetaPayload {
  session_id: string;
  provider: string;                       // one half of the model-identity pair
  model_id: string;                       // the upstream request id sent to AgentHub
  model_context_window: number | string;
  system_prompt: string;                  // fully assembled, placeholders substituted
  agent_state: string;                    // absolute path of the Agent State
  workspace: string;                      // absolute path of the Workspace
  source?: "subagent" | "schedule" | "benchmark"; // spawned by a subagent / a scheduled task / a Benchmark run; absent = user-created
}
```

Workspace 在整个 Session 生命周期内不变，模型与系统提示词则按上下文固定：会话内切换模型时，新上下文开在另一个模型上，所用模型只记在这条记录里。

每个 Trace 文件都以一条 `session_meta` 开头。压缩开启新上下文时，新文件的 `session_meta` 记录的系统提示词，按当时的 Agent State 为这个上下文重新装配（见[上下文压缩](/agent-loop#上下文压缩)）。恢复 Session 时，引擎以最新文件里的 `session_meta` 作为运行时配置，见 [Session 与 Trace](/sessions-and-traces)。

思考等级不在 meta 里，它是逐请求的参数：每次请求取 Session 钉住的等级，这个等级可以在上下文中途更换，从下一次请求起生效；没有钉住时，取上下文开启时读到的 Agent 配置缺省值。思考等级不作任何记录。旧 Trace 里出现的 `thinking_level` 字段只用于展示，不会被读回。

工具 schema 同样**不在 meta 里**。工具集要等 MCP Server 连接完成才能确定，而 meta 不应等待。完整的工具定义以独立的 `tool_list_ready` 事件下发（见 [event_msg](#eventmsg)）：

- 首次运行时下发一次；
- 压缩开启的每个上下文，在其 Trace 文件开头、紧随 `session_meta` 之后再发一次。

拆分之前写入的 Trace 在 meta 里内嵌了 `tools` 字段。这个字段已不再读取，这些 Trace 的工具记录也不再展示。

## model_msg：完整消息

内容 payload 共七种，以 `payload.type` 区分。两个可选字段各类共用：`stop_reason` 标注非正常收尾的终态（见 [stop_reason](#stopreason)），`fidelity` 是不透明的供应商保真负载（见[保真字段](#保真字段)）：

```ts
type Fidelity = Record<string, unknown>;  // opaque provider-fidelity payload (see below)

interface TextPayload {
  type: "text";
  role: "user" | "assistant";
  text: string;
  sender?: "user" | "parent_agent" | "harness" | "server"; // who produced a user-role text; absent = the human user
  fidelity?: Fidelity;        // e.g. { phase } segment marker (GPT-5), { signature }
  stop_reason?: StopReason;
}

interface ThinkingPayload {
  type: "thinking";
  role: "assistant";
  thinking: string;
  fidelity?: Fidelity;        // required by some models to replay history
  stop_reason?: StopReason;
}

interface InlineThinkingPayload {
  type: "inline_thinking";
  role: "assistant";
  data: string;               // reasoning content as base64-encoded bytes
  mime_type: string;
  fidelity?: Fidelity;
  stop_reason?: StopReason;
}

interface ToolCallPayload {
  type: "tool_call";
  role: "assistant";
  name: string;
  arguments: string;          // arguments as a JSON string
  tool_call_id: string;
  fidelity?: Fidelity;
  stop_reason?: StopReason;
}

interface ToolCallOutputPayload {
  type: "tool_call_output";
  role: "user";
  output: string;
  images?: string[];          // data:<mime>;base64,… URLs (e.g. read_file's image results)
  tool_call_id: string;
  stop_reason?: StopReason;
}

interface ImageUrlPayload {
  type: "image_url";
  role: "user";
  image_url: string;          // web URL or base64 data URL
  stop_reason?: StopReason;
}

interface InlineDataPayload {
  type: "inline_data";
  role: "user" | "assistant";
  data: string;               // other binary content, base64-encoded
  mime_type: string;
  fidelity?: Fidelity;
  stop_reason?: StopReason;
}
```

`sender` 区分 user 角色文本的来源：真人用户（`user`）、驱动子 Agent 的父 Agent（`parent_agent`）、harness 的自动注入（`harness`，例如后台任务的完成回报和钩子 `continue` 注入的输入），以及 Server 自己的触发（`server`，例如定时任务）。这个字段不会发给供应商。

`tool_call` 与 `tool_call_output` 通过 `tool_call_id` 严格配对。一轮内的调用构成一个批次，输出按原始调用顺序回填（见 [Agent 运行循环](/agent-loop)）。

## model_msg：流式分片

四种 `partial_*` payload 与完整消息一一对应，并携带 `event_type` 标记分片阶段：

```ts
type StreamEventType = "start" | "delta" | "stop";

interface PartialTextPayload {
  type: "partial_text";
  role: "assistant";
  event_type: StreamEventType;
  text: string;                 // the text added by this fragment
  stop_reason?: StopReason;
}

interface PartialThinkingPayload {
  type: "partial_thinking";
  role: "assistant";
  event_type: StreamEventType;
  thinking: string;
  stop_reason?: StopReason;
}

interface PartialToolCallPayload {
  type: "partial_tool_call";
  role: "assistant";
  event_type: StreamEventType;
  name: string;
  arguments: string;            // incremental fragment of the arguments JSON
  tool_call_id: string;
  stop_reason?: StopReason;
}

interface PartialToolCallOutputPayload {
  type: "partial_tool_call_output";
  role: "user";
  event_type: StreamEventType;
  output: string;
  images?: string[];            // images are not incremental — one delta carries the whole set
  tool_call_id: string;
  stop_reason?: StopReason;
}
```

### 流式纪律

每段流式内容都遵守同一条时序规则，`stop` 之后紧跟对应的完整消息：

```text
partial_text(start) → partial_text(delta) → … → partial_text(stop) → text (complete)
                      └── concatenation of all deltas ≡ the complete message ──┘
                          (truncation applies to both alike)
```

因此渲染层可以边收 delta 边绘制，收到完整消息后原地替换。Trace 只记录完整消息，不存分片。接口实现在内部把结构闭合好，从不向上层泄漏未闭合的分片。`PartialAggregator`（`aggregate.ts`）提供了现成的分片聚合器。

## event_msg

十二种事件 payload 记录模型上下文之外的运行时事件：

| 事件 `type` | 记录的内容 |
| --- | --- |
| `tool_list_ready` | 发送给模型的完整工具 schema |
| `mcp_connect_begin` | 正在连接的 MCP Server |
| `mcp_connect_end` | 总体连接状态与逐个 Server 的结果 |
| `request_begin` | 一次模型请求的开始 |
| `request_end` | 请求的终态，以及重试详情块（`error_code`、`error_message`、`attempt`、`retry_in_ms`） |
| `approval_decision` | 一次审批决策，与对应的 `tool_call_id` 配对 |
| `token_usage` | Session 累计与本次请求的 Token 计数 |
| `compaction_begin` | 触发原因与模式，以及触发时的上下文 Token 数和累计轮数 |
| `compaction_end` | 压缩的原因、模式与终态，以及重试详情块 |
| `abort` | 一次用户中断及其原因码 |
| `subagent` | 父 Trace 中指向直接子 Session 的指针 |
| `hook` | 一次钩子回答：钩子点、名称、决策，以及钩子自己的记录 |

凡是报告失败的 payload 都带同一对错误字段：`error_code` 是稳定、机器可读的原因码，渲染层据此做本地化；`error_message` 是失败的原始文本，原样展示。完整定义如下：

```ts
type ErrorCode =
  // abort causes (a user interruption, the only thing an abort event marks)
  | "user_abort"
  | "backoff_interrupted"
  | "compaction_interrupted"
  // LLM request failures (request_end / compaction_end)
  | "timeout"                 // idle timeout / connection went silent
  | "network"                 // transport drops, provider 429/5xx, and anything unclassifiable
  | "malformed"               // response failed parsing/validation, or the stream was truncated
  | "auth"                    // the provider rejected the credentials
  | "rejected"                // a definitive provider 4xx rejection (params, quota; 408/429 excluded)
  | "unsupported"             // a deterministic client-side rejection (fast mode without a fast tier)
  | "invalid_input"           // the input failed to assemble into a request
  // MCP connect failures
  | "connect_failed";

interface ToolListReadyPayload {
  type: "tool_list_ready";
  tools: ToolDefinition[];    // the complete tool schema sent to the model; emitted once
                              // at the first run (after MCP discovery), written to the
                              // Trace right after the run's input (it belongs to the new
                              // turn), and rewritten with session_meta at the head of
                              // each post-compaction Trace file
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;   // JSON Schema
}

interface McpConnectBeginPayload {
  type: "mcp_connect_begin";
  servers: string[];          // the MCP Servers being contacted; emitted only when
                              // mcpServers is configured — frontends show a connecting status
}

interface McpConnectEndPayload {
  type: "mcp_connect_end";
  status: StopReason;         // overall terminal status: completed (all connected) / fatal
                              // (some server failed; nothing retries it within the run) /
                              // aborted (user interrupted — the attempt is cancelled and
                              // the next run reconnects from scratch)
  results: McpServerConnectResult[];
                              // the phase's total wall time is the end/begin messages'
                              // timestamp difference (messages carry their own timestamps;
                              // the payload holds no duplicate duration); empty on aborted
  error_code?: ErrorCode;
  error_message?: string;
}

interface McpServerConnectResult {
  server: string;
  transport: "stdio" | "http" | "sse";
  status: StopReason;         // completed / fatal / aborted — per-server and non-fatal to
                              // the run: a failed server is skipped and the run continues
  duration_ms: number;        // this server's own connect + discovery time (no per-server
                              // messages exist to derive it from)
  tools?: number;             // tools discovered (on completed)
  error_code?: ErrorCode;     // failure cause and detail (on fatal)
  error_message?: string;
}

interface RequestBeginPayload {
  type: "request_begin";
}

interface RequestEndPayload {
  type: "request_end";
  status: StopReason;         // "completed" is the mechanical commit criterion for replay
  // The unified RetryDetail block below is stamped in one place by the builders; every
  // field is additive — old Traces replay unchanged. compaction_end reuses the same block.
  error_code?: ErrorCode;     // classified cause, non-completed only
  error_message?: string;     // error detail (LLMOutcome.errorMessage internally — one
                              // name across the stack), non-completed only: the real
                              // reason behind a retried/failed Request (e.g. a provider
                              // error code) — read by the Cost center's errors panel
  attempt?: number;           // 1-based ordinal of this request within its retry run (the
                              // authoritative retry count): stamped on failures and on a
                              // completion that needed retries; absent on a clean first try
  retry_in_ms?: number;       // planned reconnect wait (ms), present only when the engine
                              // will retry in-run — the Web App renders it as a countdown;
                              // a failed request_end without it is the run's terminal record
}

interface ApprovalDecisionPayload {
  type: "approval_decision";
  decision: "allow" | "deny" | "forbidden"; // "forbidden" = the command policy's veto,
                              // never asked of a human — the record itself names the decider
  tool_call_id: string;       // pairs with the approved tool_call — the audit record
}

interface TokenUsagePayload {
  type: "token_usage";
  session: TokenCounts;       // Session cumulative — authored by the engine (the LLM reports `request` only)
  request: TokenCounts;       // this Request
}

interface TokenCounts {
  cache_read: number;
  cache_write: number;
  output: number;
  total: number;
}

type CompactionReason = "context" | "turns" | "manual";
type CompactionMode = "summarize" | "discard";

interface CompactionBeginPayload {
  type: "compaction_begin";
  reason: CompactionReason;
  mode: CompactionMode;
  context: number;            // context tokens at trigger time
  turns: number;              // cumulative turns at trigger time
}

interface CompactionEndPayload {
  type: "compaction_end";
  reason: CompactionReason;
  mode: CompactionMode;
  status: StopReason;         // completed / retryable (abandoned after the retries ran out;
                              // the standing trigger makes it up) / fatal (a failure no
                              // retry can fix) / aborted (user interrupted); any status
                              // but completed keeps the original context
  attempt?: number;           // the final attempt's ordinal, failed attempts included
  error_code?: ErrorCode;     // the last failure's cause and detail
  error_message?: string;
}

interface AbortPayload {
  type: "abort";
  error_code?: ErrorCode;     // user_abort / backoff_interrupted / compaction_interrupted
  error_message?: string;
  reason?: string | null;     // legacy: older Traces carry the cause as English prose here;
                              // the engine no longer writes it
}

interface SubagentPayload {
  type: "subagent";
  session_id: string;         // pointer in the parent Trace to a direct child Session
                              // (written to the Trace, not streamed)
}

interface HookPayload {
  type: "hook";
  hook: "stop" | "pre_tool_use";    // the hook point that fired (see the agent loop's hooks)
  name: string;               // the hook's name: "goal", "continual-learning", …
  decision?: "continue" | "stop"    // stop point
    | "allow" | "deny";             // pre_tool_use point; absent when the hook only left a record
  reason?: string;            // one line for people
  output?: Record<string, string | number | boolean>;
                              // the hook's own record — the goal hook writes status /
                              // round / tokens_used / budget, the continual-learning hook
                              // session_id / turns; a continue's injected input is NOT
                              // here: it is the user message that follows
}
```

`compaction_end` 从不携带 `retry_in_ms`：压缩的重试由压缩请求自己的 `request_end` 宣告，而这条记录只写入 Trace。旧 Trace 可能仍把 MCP 连接失败或被放弃的压缩记为 `failed`，逐个 Server 的结果里也可能是 `error` 字段，而不是这对错误字段。

## stop_reason

四值枚举，所有带终止原因的记录共用：模型消息、工具结果，以及请求、压缩和 MCP 连接的终态。`LLMOutcome.status` 使用同一组取值（见[核心接口](/interfaces)）：

```ts
type StopReason = "completed" | "aborted" | "retryable" | "fatal";
```

终止原因只回答一个问题：要不要重试。失败属于哪一类看 `error_code`，具体细节看 `error_message`。

| 取值 | 含义 | 引擎反应 |
| --- | --- | --- |
| `completed` | 正常完成 | 继续 |
| `aborted` | 用户中断或取消 | 停止，产出 `abort` 事件，交还用户 |
| `retryable` | 值得重试的失败：传输中断、空闲超时、408/429/5xx、解析失败或被截断的响应，以及一切无法归类的错误 | LLM 侧：同一次运行内按退避阶梯自动重连 |
| `fatal` | 重试也无法修复的失败。LLM 侧：供应商确定性的 4xx 拒绝（参数、配额）、凭据被拒，或确定性的客户端拒绝；Environment 侧：工具出错或超时 | LLM 侧：停止本次运行，交还用户；不产出 `abort` 事件，`request_end` 即终局记录。Environment 侧：错误回灌给模型，从不重试 |

工具很少以 `retryable` 收尾：工具出错或超时对这次调用是确定的结果，harness 也不会重试任何工具。旧 Trace 里可能还有已废弃的 `failed`、`timeout`、`malformed` 和 `auth`；回放只与 `completed` 比较，渲染层照常展示这些旧取值。

错误从不以异常形式穿过接口边界，错误本身*就是*消息（见 [Agent 运行循环](/agent-loop)）。

## origin：子 Session 链

`origin` 服务于子 Agent。子 Session 的消息转发给父级时，每经过一层就在链首加上一个子 Session id，顺序由外到内。渲染层按这条链把消息归入对应的嵌套卡片：

```ts
// message from the main Session: no origin
{ timestamp: "…", type: "model_msg", payload: { type: "text", … } }

// message from a one-level Subagent: origin = [child Session id]
{ timestamp: "…", type: "model_msg", origin: ["session-2026-07-18-…-a1b2c3d4"], payload: { … } }
```

带 `origin` 的消息不写入父 Trace：子 Session 有自己的 Trace，父 Trace 只保留 `subagent` 指针事件。

## 保真字段

供应商特有的传输层数据统一放在一个可选字段 `fidelity` 里。它是 LLM 客户端记录的任意 JSON 对象，用于在回放时复原原始消息，例如：

- 思考签名；
- `phase` 分段标签；
- GPT-5 的加密推理；
- OpenAI 兼容上游的推理字段名。

```ts
// Claude: a thinking block closed by its signature
{ type: "thinking", thinking: "…", fidelity: { signature: "EqQBCkYIBxgCKkB…" } }

// GPT-5: encrypted reasoning (empty thinking text, fidelity only)
{ type: "thinking", thinking: "", fidelity: { id: "rs_0d3…", encrypted_content: "gAAAA…" } }

// OpenAI-compatible: the upstream field the reasoning text came from
{ type: "thinking", thinking: "…", fidelity: { reasoning_field: "reasoning_content" } }
```

这个负载对 PenguinHarness 完全不透明：全链路原样透传、原样存储。部分模型回放历史时要求它逐字节一致，任何改写或丢失都会破坏兼容性。这也是 Trace 能无损恢复 Session 的前提之一。

## 各通道的消息子集

| 通道 | 使用的子集 |
| --- | --- |
| SDK 边界（`session.run` 的输出） | 完整 `model_msg` + 流式 `partial_*` + 全部 `event_msg` |
| 落盘的 Trace | `session_meta` + 完整 `model_msg` + 全部 `event_msg`（不存分片，也不存带 `origin` 的消息） |
| Server 的 SSE 推送 | 与 SDK 边界相同，原样的单行 JSON，见 [Server API](/server-api) |

消息沿这些通道传递的机制与各项顺序保证，见[消息流转与时序](/message-flow)。

## 构造与判别

`@prismshadow/penguin-core` 导出全部协议类型，此外还有：

- `builders.ts` 里每种消息的构造函数：`userText`、`assistantText`、`toolCall`、`toolCallOutput`、`partialText`、`tokenUsage`、`withOrigin`、`emptyTokenCounts`、`addTokenCounts` 等；
- 运行时判别函数：`isCompleteModelMessage`、`isPartialPayload`、`isModelMessage`、`isEventMessage`、`isSessionMeta`。

```ts
import { userText, isCompleteModelMessage } from "@prismshadow/penguin-core";

const prompt = userText("List the files in the current directory");
// { timestamp: "…", type: "model_msg", payload: { type: "text", role: "user", text: "…" } }
```
