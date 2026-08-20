---
title: OmniMessage 协议
description: 一个信封、三类消息、六值 stop_reason——贯穿 SDK、Trace 与 SSE 的统一消息协议，逐字段定义。
---

OmniMessage 是 PenguinHarness 的统一消息协议：SDK 对外产出它，Trace 逐行存储它，Server 经 SSE 原样推送它。「流出去的」「存下来的」「模型看到的」是同一种结构，前后端与存储之间不存在第二套格式。

本页自顶向下：先定义信封与三类消息，再逐字段展开每一种 payload，最后是贯穿全协议的语义(流式纪律、stop_reason、origin、保真字段)。类型源码：`packages/core/src/omnimessage/types.ts`。

## 信封

所有消息共享同一个信封，仅 `payload` 不同：

```ts
interface OmniMessage<P extends OmniPayload = OmniPayload> {
  timestamp: string;        // ISO 8601 UTC
  type: "session_meta" | "model_msg" | "event_msg";
  payload: P;
  origin?: string[];        // 子 Session 链(由外到内);缺省表示主 Session
}
```

三类消息的分工：

| type | 含义 | 数量级 |
| --- | --- | --- |
| `session_meta` | 一个模型上下文的完整运行配置 | 每个上下文恰好一条 |
| `model_msg` | 模型上下文中的内容消息(文本、思考、工具调用与结果) | 主体 |
| `event_msg` | 上下文之外的运行事件(审批、用量、压缩、中断) | 伴随 |

## session_meta

```ts
interface SessionMetaPayload {
  session_id: string;
  provider: string;                       // 模型身份二元组之一
  model_id: string;                       // 发给 AgentHub 的上游请求 id
  model_context_window: number | string;
  system_prompt: string;                  // 占位符替换完成后的完整系统提示词
  agent_state: string;                    // Agent State 绝对路径
  workspace: string;                      // Workspace 绝对路径
  source?: "subagent" | "schedule";       // Session 来源；缺省 = 用户创建
}
```

session_meta 只承载**会话级不变量**——模型、系统提示词、Workspace 在 Session 生命周期内不可变；恢复 Session 时引擎直接以 Trace 中的这条消息为运行时配置，见 [Session 与 Trace](/sessions-and-traces)。思考等级是逐轮参数（随每次 Task 下发），不记录在此；旧版 Trace 的 meta 里可能仍带 `thinking_level` 字段，恢复时会被忽略——恢复后的 Session 直接读取 Agent 当前配置。

工具 schema **不在 meta 里**：工具集要等 MCP Server 连接完成才可知，而 meta 不应等待——完整工具定义在首次 run 时以独立的 `tool_list_ready` 事件下发（见 event_msg）。拆分前的旧版 Trace 在 meta 里内嵌 `tools` 字段，该字段已明确不再读取（旧 Trace 的工具记录不再展示）。

## model_msg：完整消息

七种内容 payload，以 `payload.type` 判别。公共可选字段：`stop_reason`(非正常收尾时标注终态)与 `fidelity`(不透明的 Provider 保真负载，见下文):

```ts
type Fidelity = Record<string, unknown>;  // 不透明的 Provider 保真负载(见下文)

interface TextPayload {
  type: "text";
  role: "user" | "assistant";
  text: string;
  sender?: "user" | "agent" | "harness"; // user 角色文本的来源;缺省 = 真人用户
  fidelity?: Fidelity;        // 如 { phase } 分段标记(GPT-5)、{ signature }
  stop_reason?: StopReason;
}

interface ThinkingPayload {
  type: "thinking";
  role: "assistant";
  thinking: string;
  fidelity?: Fidelity;        // 部分模型历史回放所必需
  stop_reason?: StopReason;
}

interface InlineThinkingPayload {
  type: "inline_thinking";
  role: "assistant";
  data: string;               // 二进制形态的思考内容
  mime_type: string;
  fidelity?: Fidelity;
  stop_reason?: StopReason;
}

interface ToolCallPayload {
  type: "tool_call";
  role: "assistant";
  name: string;
  arguments: string;          // 参数 JSON 字符串
  tool_call_id: string;
  fidelity?: Fidelity;
  stop_reason?: StopReason;
}

interface ToolCallOutputPayload {
  type: "tool_call_output";
  role: "user";
  output: string;
  images?: string[];          // data:<mime>;base64,… 列表(如 read_image 的结果)
  tool_call_id: string;
  stop_reason?: StopReason;
}

interface ImageUrlPayload {
  type: "image_url";
  role: "user";
  image_url: string;          // 网络 URL 或 base64 data URL
  stop_reason?: StopReason;
}

interface InlineDataPayload {
  type: "inline_data";
  role: "user" | "assistant";
  data: string;               // 其他二进制内容
  mime_type: string;
  fidelity?: Fidelity;
  stop_reason?: StopReason;
}
```

`tool_call` 与 `tool_call_output` 通过 `tool_call_id` 严格配对；一轮内的多个调用是一个批次，输出按原始调用顺序回填(见 [Agent 运行循环](/agent-loop))。

## model_msg：流式分片

四种 `partial_*` payload 与完整消息一一对应，携带 `event_type` 标记分片阶段：

```ts
type StreamEventType = "start" | "delta" | "stop";

interface PartialTextPayload {
  type: "partial_text";
  role: "assistant";
  event_type: StreamEventType;
  text: string;                 // 本条分片新增的文本
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
  arguments: string;            // 参数 JSON 的增量片段
  tool_call_id: string;
  stop_reason?: StopReason;
}

interface PartialToolCallOutputPayload {
  type: "partial_tool_call_output";
  role: "user";
  event_type: StreamEventType;
  output: string;
  images?: string[];            // 图像不增量,由单条 delta 整体携带
  tool_call_id: string;
  stop_reason?: StopReason;
}
```

### 流式纪律

每段流式内容严格遵守同一时序，`stop` 之后立即跟随对应的完整消息：

```text
partial_text(start) → partial_text(delta) → … → partial_text(stop) → text(完整)
                      └── 全部 delta 拼接 ≡ 完整消息内容(截断也两侧同步) ──┘
```

因此渲染层可以先增量渲染、收到完整消息后原地替换；Trace 只记录完整消息，不存分片。接口实现方在内部把结构闭合完毕，永远不向上层泄漏未闭合的分片。`PartialAggregator`(`aggregate.ts`)提供现成的分片聚合实现。

## event_msg

十一种事件 payload，全部逐字段列出：

```ts
interface ToolListReadyPayload {
  type: "tool_list_ready";
  tools: ToolDefinition[];    // 发给模型的完整工具 schema;首次 run 时发出一次(MCP 发现
                              // 完成后),Trace 中写在本轮输入之后(归属新轮次),压缩分卷时
                              // 随 session_meta 一并重写到新 Trace 文件
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;   // JSON Schema
}

interface McpConnectBeginPayload {
  type: "mcp_connect_begin";
  servers: string[];          // 正在连接的 MCP Server;仅配置了 mcpServers 时发出,
                              // 前端据此显示连接状态
}

type McpConnectStatus = "completed" | "failed" | "aborted";

interface McpConnectEndPayload {
  type: "mcp_connect_end";
  status: McpConnectStatus;   // 总体终态(与 compaction_end.status 同风格):completed 全部
                              // 连上 / failed 有 Server 失败 / aborted 用户打断——打断即
                              // 取消本次连接,下次 run 重新连接
  results: McpServerConnectResult[];
                              // 阶段总耗时 = end 与 begin 两条消息的 timestamp 之差
                              // (消息自带时间戳,payload 不重复记录);aborted 时为空
}

interface McpServerConnectResult {
  server: string;
  transport: "stdio" | "http" | "sse";
  status: McpConnectStatus;   // 失败逐 Server 且不致命:该 Server 被跳过,run 继续
  duration_ms: number;        // 该 Server 自身的连接+发现耗时(无独立消息可推导)
  tools?: number;             // 发现的工具数(completed 时)
  error?: string;             // 失败详情(failed 时)
}

interface RequestBeginPayload {
  type: "request_begin";
}

interface RequestEndPayload {
  type: "request_end";
  status: StopReason;         // completed 是回放判定「该轮已提交」的机械标准
  // 以下为统一的重试详情块 RetryDetail(由 builder 一处盖章;均为增量字段,旧 Trace 回放
  // 不受影响;compaction_end 复用同一块——attempt 为最终尝试序号,error_message 为失败详情)
  error_message?: string;     // 错误详情(内部 LLMOutcome.errorMessage,内外同名),仅非
                              // completed 携带:被重试/失败的 Request 背后的真实原因
                              // (如供应商错误码),供成本中心错误面板读取
  attempt?: number;           // 本次重试序列内的第几次请求(1 起,权威计数):失败请求
                              // 与经重试后成功的请求携带;首发即成功不携带
  retry_in_ms?: number;       // 计划中的重连等待(毫秒),仅当引擎将在本轮内重试时携带,
                              // Web App 据此渲染倒计时
}

interface ApprovalDecisionPayload {
  type: "approval_decision";
  decision: "allow" | "deny";
  tool_call_id: string;       // 与被审批的 tool_call 配对,构成审计记录
}

interface TokenUsagePayload {
  type: "token_usage";
  session: TokenCounts;       // Session 累计
  request: TokenCounts;       // 本次 Request
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
  context: number;            // 触发时的上下文 Token 数
  turns: number;              // 触发时的累计轮数
}

interface CompactionEndPayload {
  type: "compaction_end";
  reason: CompactionReason;
  mode: CompactionMode;
  status: StopReason;
}

interface AbortPayload {
  type: "abort";
  reason?: string | null;
}

interface SubagentPayload {
  type: "subagent";
  session_id: string;         // 父 Trace 中指向直接子 Session 的指针
}
```

## stop_reason

六值枚举，贯穿消息与接口返回(`LLMOutcome.status` 使用同一集合，见[接口契约](/interfaces)):

```ts
type StopReason = "completed" | "failed" | "aborted" | "timeout" | "malformed" | "auth";
```

| 值 | 语义 | 引擎的反应 |
| --- | --- | --- |
| `completed` | 正常完成 | 继续 |
| `aborted` | 用户中断 | 停止并交还用户 |
| `timeout` | LLM 超时/传输层断连 | 仅 LLM 侧：同一 run 内自动重连 |
| `malformed` | 响应解析失败/流截断 | 仅 LLM 侧：同一 run 内自动重连 |
| `failed` | 分类器未判定为瞬时的错误（LLM 侧）；工具执行出错（Environment 侧） | LLM 侧：同样在同一 run 内自动重连——该状态本身仍如实上报为 `failed`。Environment 侧：错误回灌给模型，从不重试 |
| `auth` | 供应商拒绝了凭据 | 停止并交还用户——唯一从不重试的 LLM 终态；宿主据此禁用输入，直到该模型的 API key 被更新（凭据取自当前 Project 配置） |

错误从不以异常形式穿过接口边界——它们就是消息，见 [Agent 运行循环](/agent-loop)。

## origin：子 Session 链

`origin` 服务于 Subagent：子 Session 的消息转发给父级时，每经过一层就在数组前端添加一个子 Session id(由外到内)，渲染层据此把消息归入对应的子会话卡片：

```ts
// 主 Session 的消息:无 origin
{ timestamp: "…", type: "model_msg", payload: { type: "text", … } }

// 一层 Subagent 的消息:origin = [子 Session id]
{ timestamp: "…", type: "model_msg", origin: ["session-2026-07-18-…-a1b2c3d4"], payload: { … } }
```

带 `origin` 的消息不写入父 Trace——子 Session 拥有自己的 Trace，父 Trace 只保留 `subagent` 指针事件。

## 保真字段

Provider 专有的线上数据统一收拢在一个可选字段 `fidelity` 中——LLM 客户端为历史回放记录的任意 JSON 对象:思考签名、`phase` 分段标记、GPT-5 加密推理、OpenAI 兼容上游的推理字段名:

```ts
// Claude:由签名闭合的 thinking 块
{ type: "thinking", thinking: "…", fidelity: { signature: "EqQBCkYIBxgCKkB…" } }

// GPT-5:加密推理(thinking 文本为空,仅有 fidelity)
{ type: "thinking", thinking: "", fidelity: { id: "rs_0d3…", encrypted_content: "gAAAA…" } }

// OpenAI 兼容:思考内容来自上游哪个字段
{ type: "thinking", thinking: "…", fidelity: { reasoning_field: "reasoning_content" } }
```

该负载对 PenguinHarness 完全不透明:在整条链路上原样透传、原样存储——部分模型在历史回放时要求逐字一致，任何转写或丢失都会破坏兼容性。这是 Trace 能够无损恢复 Session 的前提之一。

## 协议的三种职责

| 场景 | 使用的子集 |
| --- | --- |
| SDK 边界(`session.run` 输出) | 完整 `model_msg` + 流式 `partial_*` + 全部 `event_msg` |
| Trace 落盘 | `session_meta` + 完整 `model_msg` + 全部 `event_msg`(不存分片与 `origin` 消息) |
| Server SSE 推送 | 与 SDK 边界一致，原样单行 JSON，见 [Server API](/server-api) |

消息沿这些通道传递的机制与顺序保证，见[消息流转与时序](/message-flow)。

## 构造与判别

`@prismshadow/penguin-core` 导出全部类型、每种消息的构造函数(`builders.ts`:`userText`、`assistantText`、`toolCall`、`toolCallOutput`、`partialText`、`tokenUsage`、`withOrigin`、`emptyTokenCounts`、`addTokenCounts` 等)与运行时判别函数(`isCompleteModelMessage`、`isPartialPayload`、`isModelMessage`、`isEventMessage`、`isSessionMeta`):

```ts
import { userText, isCompleteModelMessage } from "@prismshadow/penguin-core";

const prompt = userText("列出当前目录的文件");
// { timestamp: "…", type: "model_msg", payload: { type: "text", role: "user", text: "…" } }
```
