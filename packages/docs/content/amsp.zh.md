---
title: AMSP
description: Agent Message Stream Protocol：经 Agent API 返回 Agent 一次运行所用的事件流，包括语法、全部事件、错误与版本规则。
---

AMSP（Agent Message Stream Protocol）是 [Agent API](/agent-api) 的传输格式。[MMSP](https://www.npmjs.com/package/@prismshadow/mmsp) 流式传输一次模型调用，AMSP 流式传输 Agent 的一次运行：一个 Task，包括它发出的模型 Request、Agent 执行的工具及其结果、审批、上下文压缩、错误和最终的 Token 计数；运行发生在一个 Session 上，调用方凭 id 延续它。一次运行就是一个 HTTP 响应。

AMSP 是 Session 实时流的投影：服务器把一次运行产生的 [OmniMessage](/omni-message) 记录和服务器事件翻译过来，分片和完整内容项都按引擎产出的原样转发。OmniMessage 没有为它增加任何字段。类型定义在 `@prismshadow/amsp`（`packages/amsp/src/types.ts`）中，服务器的翻译器和客户端共用这份定义。

## 传输

- 运行请求是 `POST <Base URL>/agents/:projectId/:agentId/runs`，带 `Content-Type: application/json`、`Accept: text/event-stream`，以及 `Authorization: Bearer <key>`（除非该 Agent 允许无密钥访问）。请求体见[运行请求](/agent-api#运行请求)。
- 响应是 `200`，带 `Content-Type: text/event-stream; charset=utf-8`、`Cache-Control: no-cache` 和 `X-Accel-Buffering: no`。每个事件是一个 `data: <JSON>` 块，后跟一个空行；最后一个事件之后是 `data: [DONE]`。没有 `event:` 或 `id:` 字段，所以中断的流无法续传。
- 连续 15 秒没有事件时，服务器写入注释 `: keep-alive`，让代理和客户端知道连接在模型或工具较慢时依然存活。
- 每个事件都带 `type` 和 `at`（ISO 8601，UTC）。来自子 Agent Session 的事件还带 `origin`，即由外到内的子 Session id 链，与 OmniMessage 完全相同；不带 `origin` 的事件属于主 Session。
- 字节以 base64 文本传送：`inline_data.done.data`、`inline_thinking.done.data`、工具结果的 `images`，以及输入中的 `data:` URL。
- 在事件流开始之前被拒绝的请求，得到 HTTP 状态码和错误信封，见[错误](/agent-api#错误)。事件流一旦开始，错误就不会以单独的帧出现，而是由 `run.done` 携带。
- 路由区分大小写。

## 语法

```text
stream       := run.started body* run.done
body         := context.opened | mcp_connect.started | mcp_connect.done | tools.ready
              | request | tool_result | approval | compaction | hook.fired
              | text.done (role user) | image_url.done
request      := request.started (item | tool_result | approval | hook.fired)* request.done
item         := K.delta* K.done              ; K = thinking | text | tool_call | inline_data | inline_thinking
tool_result  := tool_result.delta | tool_result.done   ; 各为单个事件：一次结果为 tool_result.delta* tool_result.done，
                                                       ; 按 tool_call_id 归属，可以跨过 request.done
approval     := approval.requested | approval.decided
compaction   := compaction.started (summary.delta* | summary.done)? compaction.done
```

客户端可以依赖的规则：

1. **有且只有一个终止事件。** `run.done` 是 `[DONE]` 之前的最后一个事件，无论运行是完成、被中止、失败，还是服务器在驱动运行时出错（`status: "fatal"`、`error.code: "internal"`）。响应体在它之前结束，意味着连接断了。
2. **内容项以 `.done` 收尾，分片与它从不对账。** `.done` 携带完整内容。服务器把分片和完整内容项都按引擎产出的原样转发，不由一方重建另一方。文本和思考的分片拼接起来与 `.done` 相同；工具调用则未必：分片是供应商流式输出的原文，`tool_call.done.arguments` 是引擎对解析后参数的再序列化，所以流里可能是 `{"command": "ls"}`，`.done` 里是 `{"command":"ls"}`，两者解析为同一个对象。`.done` 之前也可能没有任何分片。流式产出的压缩摘要是唯一没有 `.done` 的内容项（规则 7）。
3. **同一来源的模型输出依次出现，工具结果不是内容项。** 在同一 `origin` 内，思考、文本、工具调用和内联内容项依次出现：一项的 `.done` 先于下一项的第一个分片。工具结果、审批和钩子事件可以落在一项的任意两个事件之间；工具并行执行时，结果之间彼此交错，按 `tool_call_id` 归属。不同来源之间可以任意交错，按 `origin` 归属。
4. **Request 成对包住的是其模型输出，不是其工具执行。** 引擎在调用完整时就开始执行工具，此时 Request 尚未结束：审批的请求和决定都在该 Request 的 `request.done` 之前；结果在调用获准后即开始，通常也在 `request.done` 之前，并可能在它之后才结束。一次 Request 的全部结果都在同一来源的下一个 `request.started` 之前到齐。重试的尝试是新的一对：先是 `status: "retryable"` 且带 `retry_in_ms` 的 `request.done`，再是新的 `request.started`。
5. **用量可以加总。** `request.done.usage` 是该次尝试的计数（没有时为 `null`），`compaction.done.usage` 是其各次尝试之和。`run.done.usage` 是本次运行全部 `request.done.usage` 与 `compaction.done.usage` 之和；`run.done.session_usage` 是引擎最后报告的 Session 累计值，没有时为 `null`。
6. **忽略未知类型。** 客户端必须跳过不认识的事件 `type`。
7. **压缩期间只有摘要。** 在 `compaction.started` 与 `compaction.done` 之间，内容项只会是 `summary.*`：压缩请求的思考不转发，`text.*` 也不会出现。引擎对摘要只流式产出分片或只给出完整文本，两者不会都有：流式产出的摘要是 `summary.delta*` 直接接 `compaction.done`，没有 `summary.done`；整段给出的摘要是一个 `summary.done`。压缩之后没有 `context.opened`：压缩开出的新上下文写进 Trace，不进流。实际上 `context.opened` 标记的是子 Agent 的 Session 开始；主 Session 只在切换模型时流出它，而切换发生在两次运行之间。

## 事件

下面每个事件还都带 `at`，来自子 Agent 时还带 `origin`。Token 计数为 `{cache_read, cache_write, output, total}`；错误为 `{code, message}`。

### 运行

| 事件 | 字段 | 含义 |
| --- | --- | --- |
| `run.started` | `session_id`、`agent` | 第一个事件：运行所在的 Session（新建的或延续的）和 Agent，形如 `<projectId>/<agentId>` |
| `run.done` | `status`、`error?`、`requests`、`usage`、`session_usage` | 最后一个事件：运行如何结束、发出了多少次模型 Request（含重试的尝试）、本次运行的 Token 计数和 Session 的累计值 |

`status` 取 `completed`、`aborted`、`retryable` 或 `fatal`，与 OmniMessage 的 `stop_reason` 是同一组取值。某次 Request 或压缩最终失败、或运行被中止时，带有 `error`。

### 上下文与准备

| 事件 | 字段 | 含义 |
| --- | --- | --- |
| `context.opened` | `session_id`、`provider`、`model_id`、`context_window` | 引擎流出的新模型上下文：带 `origin` 时，表示一个子 Agent 的 Session 开始了；不带时是切换模型，它发生在两次运行之间。压缩开出的上下文不进流 |
| `mcp_connect.started` | `servers` | Agent 的 MCP Server 开始连接 |
| `mcp_connect.done` | `status`、`results`、`error?` | 每个 Server 的结果：`{server, transport, status, duration_ms, tools?, error?}` |
| `tools.ready` | `tools` | 提供给模型的工具定义：`{name, description, parameters?}` |

### 请求

| 事件 | 字段 | 含义 |
| --- | --- | --- |
| `request.started` | `request` | 一次模型 Request 开始；`request` 在本次运行内从 1 计数（子 Agent 各自计数） |
| `request.done` | `request`、`status`、`usage`、`error?`、`attempt?`、`retry_in_ms?` | 它结束了。只有引擎会在本次运行内重试时才带 `retry_in_ms` |

### 内容项

| 事件 | 字段 | 含义 |
| --- | --- | --- |
| `text.delta` | `role: "assistant"`、`text` | 模型文本的一个分片，可以为空 |
| `text.done` | `role`、`text`、`stop_reason`、`sender?` | 一段完整文本。`role: "user"` 表示运行途中加入的消息，例如引导消息或钩子的续写，由 `sender` 说明是谁加入的 |
| `thinking.delta` / `thinking.done` | `thinking`，done 另带 `stop_reason` | 模型的思考 |
| `tool_call.delta` | `tool_call_id`、`name`、`arguments` | 工具调用的一个分片：第一个分片带 `name`，`arguments` 是供应商流式输出原文的一段 |
| `tool_call.done` | `tool_call_id`、`name`、`arguments`、`stop_reason` | 完整的调用；`arguments` 是引擎对解析后参数的再序列化，为 JSON 字符串 |
| `tool_result.delta` | `tool_call_id`、`output`、`images?` | 运行中的工具到目前为止的输出，可能出现在该 Request 的 `request.done` 之前；`images` 整组出现在一个分片里 |
| `tool_result.done` | `tool_call_id`、`output`、`images?`、`stop_reason` | 模型收到的工具结果；可能在该 Request 的 `request.done` 之后，但总在下一个 `request.started` 之前 |
| `inline_data.done` | `role`、`mime_type`、`data`、`stop_reason` | 对话中内联的图片或其他数据，base64 |
| `inline_thinking.done` | `mime_type`、`data`、`stop_reason` | 供应商返回的不透明思考数据，base64 |
| `image_url.done` | `role: "user"`、`image_url` | 运行途中加入对话的图片 |
| `summary.delta` / `summary.done` | `text`，done 另带 `stop_reason` | 压缩写出的摘要：流式产出时只有分片、没有 `.done`，整段给出时是一个 `summary.done` |

与 MMSP 解析后的对象不同，`arguments` 保持为字符串。分片携带供应商流式输出的原文；`tool_call.done.arguments` 是引擎对解析后参数的再序列化，也是 Trace 保存的内容，所以两者不必逐字相同，但解析为同一个对象。被打断的调用（`stop_reason` 不是 `completed`）携带的是已收到的原文。客户端的 `parseArguments` 把任一种转成对象。

运行自身的输入不会在流中重复出现；请求之后紧接着就是 `run.started`。

### 审批

| 事件 | 字段 | 含义 |
| --- | --- | --- |
| `approval.requested` | `tool_call: {tool_call_id, name, arguments}` | 一次工具调用在等待回答：以 `{"decision": "allow" \| "deny"}` 调用 `POST /sessions/:sessionId/approvals/:toolCallId` |
| `approval.decided` | `tool_call_id`、`decision` | 对一次工具调用的决定，模型的每次调用都有：由审批模式、钩子、调用方或 Web App 做出。`decision` 为 `allow`、`deny`，命令策略否决时为 `forbidden` |

只有等待中的调用才会以 `approval.requested` 发出；审批模式直接决定的调用只有 `approval.decided`。子 Agent 的审批也通过主 Session 的 id（即 `run.started` 给出的那个）回答。

### 压缩与钩子

| 事件 | 字段 | 含义 |
| --- | --- | --- |
| `compaction.started` | `reason`、`mode`、`context`、`turns` | 上下文压缩开始：`reason` 为 `context`、`turns` 或 `manual`，`mode` 为 `summarize` 或 `discard` |
| `compaction.done` | `reason`、`mode`、`status`、`usage`、`error?`、`attempt?` | 压缩结束 |
| `hook.fired` | `hook`、`name`、`decision?`、`reason?`、`output?` | 某个钩子在 `stop`、`pre_tool_use` 或 `user_prompt` 处运行，以及它的决定 |

## 示例

一次直接回答：

```text
data: {"type":"run.started","at":"2026-10-07T10:00:00.000Z","session_id":"session-2026-10-07-10-00-00-3f9a1c2e","agent":"demo/coder"}
data: {"type":"request.started","at":"…","request":1}
data: {"type":"text.delta","at":"…","role":"assistant","text":""}
data: {"type":"text.delta","at":"…","role":"assistant","text":"Hello"}
data: {"type":"text.delta","at":"…","role":"assistant","text":"!"}
data: {"type":"text.done","at":"…","role":"assistant","text":"Hello!","stop_reason":"completed"}
data: {"type":"request.done","at":"…","request":1,"status":"completed","usage":{"cache_read":0,"cache_write":0,"output":2,"total":412}}
data: {"type":"run.done","at":"…","status":"completed","requests":1,"usage":{"cache_read":0,"cache_write":0,"output":2,"total":412},"session_usage":{"cache_read":0,"cache_write":0,"output":2,"total":412}}
data: [DONE]
```

在实际传输中每个事件后面都跟一个空行，示例里省略了。

一次需要调用方审批的工具调用，之后是第二次 Request。工具在第一次 Request 尚未结束时执行：审批和结果的开头在它的 `request.done` 之前，结果的其余部分在其后。分片里的参数是供应商的原文，`.done` 里的是引擎对解析后参数的再序列化：

```text
data: {"type":"run.started",…}
data: {"type":"request.started","request":1,…}
data: {"type":"tool_call.delta","tool_call_id":"call_1","name":"exec_command","arguments":"",…}
data: {"type":"tool_call.delta","tool_call_id":"call_1","name":"","arguments":"{\"command\": \"ls\"}",…}
data: {"type":"tool_call.done","tool_call_id":"call_1","name":"exec_command","arguments":"{\"command\":\"ls\"}","stop_reason":"completed",…}
data: {"type":"approval.requested","tool_call":{"tool_call_id":"call_1","name":"exec_command","arguments":"{\"command\":\"ls\"}"},…}
            ← caller: POST /api/amsp/v1/sessions/<id>/approvals/call_1 {"decision":"allow"} → 204
data: {"type":"approval.decided","tool_call_id":"call_1","decision":"allow",…}
data: {"type":"tool_result.delta","tool_call_id":"call_1","output":"",…}
data: {"type":"request.done","request":1,"status":"completed","usage":{…},…}
data: {"type":"tool_result.delta","tool_call_id":"call_1","output":"README.md\nsrc\n",…}
data: {"type":"tool_result.done","tool_call_id":"call_1","output":"README.md\nsrc\n","stop_reason":"completed",…}
data: {"type":"request.started","request":2,…}
data: {"type":"text.delta",…} … data: {"type":"text.done","text":"Two entries: README.md and src.",…}
data: {"type":"request.done","request":2,"status":"completed","usage":{…},…}
data: {"type":"run.done","status":"completed","requests":2,"usage":{…},"session_usage":{…},…}
data: [DONE]
```

两次 Request 之间的一次压缩。摘要是流式产出的，所以没有 `summary.done`，之后也没有 `context.opened`：

```text
data: {"type":"request.done","request":1,"status":"completed","usage":{…},…}
data: {"type":"compaction.started","reason":"context","mode":"summarize","context":300,"turns":1,…}
data: {"type":"summary.delta","text":"",…}
data: {"type":"summary.delta","text":"Summary.",…}
data: {"type":"compaction.done","reason":"context","mode":"summarize","status":"completed","usage":{…},"attempt":1,…}
data: {"type":"request.started","request":2,…}
```

一次临时故障及其重试，之后调用方中止了运行：

```text
data: {"type":"run.started",…}
data: {"type":"request.started","request":1,…}
data: {"type":"request.done","request":1,"status":"retryable","usage":null,"error":{"code":"network","message":"fetch failed"},"attempt":1,"retry_in_ms":1000,…}
: keep-alive
data: {"type":"request.started","request":2,…}
data: {"type":"text.delta","text":"Let me",…}
            ← caller: POST /api/amsp/v1/sessions/<id>/abort → 202
data: {"type":"text.done","text":"Let me","stop_reason":"aborted",…}
data: {"type":"request.done","request":2,"status":"aborted","usage":null,"attempt":2,…}
data: {"type":"run.done","status":"aborted","error":{"code":"user_abort","message":"…"},"requests":2,"usage":{…},"session_usage":null,…}
data: [DONE]
```

## 流中的错误

`run.done.status` 说明运行如何结束：被中止时为 `aborted`；否则为最终失败的那次 Request 或压缩的状态，并带其错误；运行达到 Agent 的轮次上限时为不带错误的 `fatal`；其余情况为 `completed`。`run.done.error.code` 取 OmniMessage 记录的同一组错误码，另加 AMSP 自己的两个：

| `code` | 含义 |
| --- | --- |
| `user_abort` | 运行被中止：经 `POST …/abort`、调用方断开连接，或有人在 Web App 中中止 |
| `backoff_interrupted`、`compaction_interrupted` | 中止发生在引擎等待重试期间，或压缩期间 |
| `timeout` | 模型连接没有了动静 |
| `network` | 连接中断、供应商返回 `429` 或 `5xx`，或无法归类的故障 |
| `malformed` | 模型响应解析失败或被截断 |
| `auth` | 供应商拒绝了凭据 |
| `rejected` | 供应商明确拒绝了请求（参数、配额） |
| `unsupported` | 请求要求了模型做不到的事 |
| `invalid_input` | 输入无法组装成请求 |
| `connect_failed` | 某个 MCP Server 连接失败（出现在 `mcp_connect.done` 上） |
| `internal` | 服务器在驱动运行时出错 |
| `session_rebuilt` | 服务器不得不以新 id 重建 Session，又无法跟随过去；message 中给出新 id |

以 `fatal` 或 `retryable` 结束的运行，HTTP 响应仍是 `200`：HTTP 状态码只反映请求本身。

## 从 OmniMessage 到 AMSP

服务器的翻译器读取 Session 运行时发布的内容，写出 AMSP 事件：

| OmniMessage 记录或服务器事件 | AMSP |
| --- | --- |
| Session 在本次运行的输入之前发布的一切（子 Agent 状态变化重发的空闲 `task_state`、后台子 Agent 的输出） | 不发送：翻译器从输入的回显开始 |
| 运行自身的输入 | 不发送 |
| `session_meta` | `context.opened`：子 Agent 的，或两次运行之间切换模型的；压缩开出的上下文只写 Trace |
| `mcp_connect_begin` / `mcp_connect_end` | `mcp_connect.started` / `mcp_connect.done` |
| `tool_list_ready` | `tools.ready` |
| `request_begin` / `request_end` | `request.started` / `request.done` |
| `token_usage` | 不发送：其计数写到下一个 `request.done`（或 `compaction.done`）上，Session 累计值写到 `run.done` 上 |
| `partial_text`、`partial_thinking`、`partial_tool_call`、`partial_tool_call_output` 的 `start` 与 `delta` | `text.delta`、`thinking.delta`、`tool_call.delta`、`tool_result.delta`；压缩期间的文本为 `summary.delta`（其后没有 `summary.done`），压缩期间的思考不发送 |
| `partial_*` 的 `stop` | 不发送 |
| `text`、`thinking`、`tool_call`、`tool_call_output` | `text.done`、`thinking.done`、`tool_call.done`、`tool_result.done`；压缩期间引擎整段给出的文本为 `summary.done`，压缩期间的思考不发送 |
| `inline_data`、`inline_thinking`、`image_url` | `inline_data.done`、`inline_thinking.done`、`image_url.done` |
| 服务器事件 `approval_request` / `approval_decision` | `approval.requested` / `approval.decided` |
| `compaction_begin` / `compaction_end` | `compaction.started` / `compaction.done` |
| `hook` | `hook.fired` |
| `abort` | 不发送：它使 `run.done` 成为带该错误的 `aborted` |
| 服务器事件 `task_state` 变为 `idle` | `run.done` |

只为 Trace 服务的字段不会传送，例如供应商的 `fidelity` 和 `session_meta.source`：API 运行所在的 Session 本来就是 API 会话。

## 版本

- 版本写在路径里：`/api/amsp/v1`；事件本身不带版本。
- 在 `/v1` 之内只做增加：新的事件类型和新的可选字段。忽略未知内容的客户端可以继续工作。
- 改变已有字段含义的变更属于新版本 `/v2`，与 `/v1` 并存。
- 事件名形如 `<subject>.<phase>`；内容项为 `K.delta` 与 `K.done`，与 MMSP 一致。传输中的一次 run 即 PenguinHarness 术语中的一个 Task。

## 自行读取流

任何能发送 `Authorization` 和 POST 请求体的 SSE 读取方式都可以：请用 `fetch`，不要用 `EventSource`。按 `EventSource` 的规则读取：行以 LF、CRLF 或单独的 CR 结束；空行结束一个事件；以 `:` 开头的行是注释；同一事件的多行 `data:` 以换行符连接；读到 `data: [DONE]` 时停止。`@prismshadow/amsp` 中的 `readSse` 正是这样读取 `fetch` 的响应体，并逐个产出每个事件的数据。
