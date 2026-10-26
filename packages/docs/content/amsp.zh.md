---
title: AMSP
description: Agent Message Stream Protocol：一个 Session 的记录经 SSE 上线，包括控制帧、运行流与 Session 流、待决审批资源、运行结果的读法，以及每条记录取代的 v1 旧事件。
---

AMSP（Agent Message Stream Protocol）是 [Agent API](/agent-api) 的传输格式。它流式传输一个 Session：该 Session 的记录，与 Trace 中保存的完全相同；消息产出过程中流式发出的 `partial_*` 分片；以及围绕它们的心跳 `ping`，运行流还以 `data: [DONE]` 收尾。线上不做任何翻译：Trace 的每一行都是一条合法的 AMSP 记录，每种载荷的字段都以 [AMSP 记录](/amsp-records)页面的说明为准。

Web App 的服务器事件（运行状态、审批请求、标题、goal 进度等）不属于 AMSP。程序需要的信息从记录和两个资源中读取：Session 本身 `GET …/sessions/:sessionId`，给出状态与模型；它的待决审批 `GET …/sessions/:sessionId/approvals`。

类型定义在 `@prismshadow/amsp` 中，`@prismshadow/penguin-core` 原样再导出，见 [amsp 客户端](/agent-api#amsp-客户端)。

## 传输

- 流的类型是 `text/event-stream; charset=utf-8`，带 `Cache-Control: no-cache` 和 `X-Accel-Buffering: no`。每个事件由几行 SSE 字段和一个空行组成。
- 每个事件属于两类之一，以 `event:` 名区分：
  - **记录**不带名字。它带 `id:`，形如 `<epoch>-<seq>`；`data:` 是单行 JSON 的记录外壳 `{timestamp, type, payload, origin?}`；
  - **控制帧**带名字、不带 `id:`，因此不移动续传位置，也从不进缓冲、不被补发。
- 同一条流里 id 递增，但不一定连续：服务器的通道也为 AMSP 不传送的事件编号。服务器重启或重建该 Session 的通道时，epoch 会改变。
- 载荷为 snake_case，与 Trace 保存的完全一致，供应商的 `fidelity` 也在其中。字节以 base64 文本传送：`inline_data.data`、`inline_thinking.data`、工具输出的 `images`，以及 `data:` URL。
- 在流开始之前被拒绝的请求，得到 HTTP 状态码和错误信封，见[错误](/agent-api#错误)。流一旦开始，就没有错误帧。
- 路由区分大小写。

## 记录

| 外层 `type` | `payload.type` | 写入 Trace |
| --- | --- | --- |
| `session_meta` | — | 是 |
| `model_msg` | `text`、`image_url`、`inline_data`、`thinking`、`inline_thinking`、`tool_call`、`tool_call_output` | 是 |
| `model_msg` | `partial_text`、`partial_thinking`、`partial_tool_call`、`partial_tool_call_output` | 否，只在流上 |
| `event_msg` | `task_begin`、`task_end`、`request_begin`、`request_end`、`token_usage`、`compaction_begin`、`compaction_end`、`mcp_connect_begin`、`mcp_connect_end`、`tool_list_ready`、`approval_decision`、`hook`、`abort` | 是 |

读取方可以依赖的规则：

1. **按事件名分派。** 不带名字的事件是记录。不认识的事件名一律忽略，不认识的 `payload.type` 也一样。
2. **先分片，后完整消息。** 一条流式消息依次是 `event_type: "start"` 的 `partial_*`、任意个 `delta`、一个 `stop`，随后的完整消息取代这些分片。两者从不对账。文本和思考的 delta 拼接起来与完整消息相同；工具调用的 delta 是供应商流式输出的原文，完整的 `tool_call.arguments` 则是引擎对解析后参数的再序列化，所以流里可能是 `{"command": "ls"}`，完整消息里是 `{"command":"ls"}`，两者解析为同一个对象。完整消息之前也可能没有任何分片；从流中途加入的读取方，丢弃没见过其 `start` 的 `delta` 即可。
3. **同一来源的模型输出依次出现，工具结果不受此限。** 在同一 `origin` 内，思考、文本和工具调用依次出现。工具输出、审批决定和钩子记录可以落在一条消息的任意两条记录之间；工具并行执行时，输出彼此交错，按 `tool_call_id` 归属。不同来源之间可以任意交错，按 `origin` 归属。
4. **Request 成对包住的是其模型输出，不是其工具执行。** 引擎在调用完整时就开始执行工具，此时 Request 尚未结束，所以调用的 `approval_decision` 和输出的开头通常在该 Request 的 `request_end` 之前，输出可能在它之后才结束。一次 Request 的全部调用输出都在同一来源的下一个 `request_begin` 之前到齐。重试的尝试是新的一对：先是 `status: "retryable"` 且带 `retry_in_ms` 的 `request_end`，再是新的 `request_begin`。`request_begin.thinking_level` 是这次 Request 发出时的思考等级。
5. **每次 Request 都附带用量。** `token_usage` 在该 Request 的 `request_end` 之前：`request` 是这次 Request 的计数，`session` 是 Session 的累计值，两者都是 `{cache_read, cache_write, output, total}`。
6. **流即 Trace，外加分片。** 主 Session 写入 Trace 的每条记录，都在写入之时、按 Trace 的顺序在流上出现恰好一次。例外如下：
   - 有两类记录只写 Trace、从不上流：压缩自身请求的 `request_begin` / `request_end`，以及 `subagent` 指针；
   - 子 Agent 的记录带 `origin`，只在父 Session 的流上出现，持久保存在子 Session 自己的 Trace 中；
   - 新上下文开启时，其 `mcp_connect_begin` / `mcp_connect_end` 与 `tool_list_ready` 在上下文开启时上流，新文件开出后才写入。
7. **`compaction_begin` 与 `compaction_end` 之间的内容属于压缩。** 其中的文本是摘要，不是回答。

### 流上的 session_meta

主 Session 的 `session_meta` 在写入时上流，且只上流一次。写入发生在三个时刻：

- **新 Session 的第一条消息。** 它位于该 Session 第一个 Trace 文件的开头，先于该 Task 的 `task_begin`，所以它是新建 Session 的运行流的第一条记录，运行流也正是凭它的 `session_id` 给出新 Session 的 id。
- **压缩开启的新上下文。** 新文件在压缩之后第一条要写入的记录之前开出，`session_meta` 随之上流。压缩结束了上一个 Task 时，Task 记录不开新文件，下一个 Task 的 `task_begin` 已经流出，所以 `session_meta` 落在这个 `task_begin` 之后、该 Task 的输入之前。
- **模型切换。** 切换完成时即开出新文件，这发生在两次运行之间，所以它的 `session_meta` 在 Session 流上，不在下一次运行的运行流里。

同一条 `session_meta` 不会再次发送。之后需要模型的读取方读 `GET …/sessions/:sessionId`；需要其余内容时，读取完整历史，其中带有每个文件开头的 `session_meta`。子 Agent 的 `session_meta` 在子 Session 开始时带着 `origin` 上流。

### Task

`task_begin` 与 `task_end` 括住一个 Task：一次 Prompt 的执行，连同其 stop 钩子的 `hook` 记录。一次运行可以包含多个 Task：stop 钩子回答 `continue` 时，同一次运行里会再开一个 Task，goal 模式的各轮就是这样运行的。手动压缩和模型切换不是 Task，由 `compaction_begin` / `compaction_end` 与新文件的 `session_meta` 框定。

`task_begin` 先于该 Task 写下的一切记录，包括其输入。被中止的 Task 同样以 `task_end` 结束。一个 `task_begin` 在下一个 `task_begin` 或运行结束之前没有 `task_end`，说明该 Task 没有走到终点：服务器在驱动它时出了故障。

## 控制帧

| 帧 | 数据 | 何时 |
| --- | --- | --- |
| `event: ping` | `{}` | 运行流上最先发出，Session 流上紧跟在补发的记录之后，此后每 20 秒一次。它取代了早先的 `: keep-alive` 注释，浏览器从不把注释交给页面 |
| `data: [DONE]` | — | 运行流的最后一行，运行结束时写出 |

## 运行流

`POST <Base URL>/agents/:projectId/:agentId/runs` 运行一次 Agent，并以这次运行的流作答；请求体见[运行请求](/agent-api#运行请求)。流依次为：

1. `ping`；
2. 新 Session 的第一条消息上，该 Session 的 `session_meta`；
3. `task_begin`，然后是 Session 所记录的本次输入：每个文本项一条用户 `text`，其后每张图片一条 `image_url`；
4. 本次运行的记录；
5. `task_end`，在最后一个 Task 的 stop 钩子记录之后；
6. `data: [DONE]`。

新 Session 上的一次直接回答，时间戳和较长的值已省略：

```text
event: ping
data: {}

id: 7c41d0a2-1
data: {"timestamp":"…","type":"session_meta","payload":{"session_id":"session-2026-10-23-10-00-00-3f9a1c2e","provider":"deepseek","model_id":"deepseek-v4-pro","model_context_window":1000000,"system_prompt":"…","agent_state":"…","workspace":"…","source":"api"}}

id: 7c41d0a2-2
data: {"timestamp":"…","type":"event_msg","payload":{"type":"task_begin"}}

id: 7c41d0a2-4
data: {"timestamp":"…","type":"model_msg","payload":{"type":"text","role":"user","text":"Say hello"}}

id: 7c41d0a2-5
data: {"timestamp":"…","type":"event_msg","payload":{"type":"tool_list_ready","tools":[…]}}

id: 7c41d0a2-6
data: {"timestamp":"…","type":"event_msg","payload":{"type":"request_begin","thinking_level":"medium"}}

id: 7c41d0a2-7
data: {"timestamp":"…","type":"model_msg","payload":{"type":"partial_text","role":"assistant","event_type":"start","text":""}}

id: 7c41d0a2-8
data: {"timestamp":"…","type":"model_msg","payload":{"type":"partial_text","role":"assistant","event_type":"delta","text":"Hello!"}}

id: 7c41d0a2-9
data: {"timestamp":"…","type":"model_msg","payload":{"type":"partial_text","role":"assistant","event_type":"stop","text":""}}

id: 7c41d0a2-10
data: {"timestamp":"…","type":"model_msg","payload":{"type":"text","role":"assistant","text":"Hello!"}}

id: 7c41d0a2-11
data: {"timestamp":"…","type":"event_msg","payload":{"type":"token_usage","session":{"cache_read":0,"cache_write":0,"output":2,"total":412},"request":{"cache_read":0,"cache_write":0,"output":2,"total":412}}}

id: 7c41d0a2-12
data: {"timestamp":"…","type":"event_msg","payload":{"type":"request_end","status":"completed"}}

id: 7c41d0a2-14
data: {"timestamp":"…","type":"event_msg","payload":{"type":"task_end"}}

data: [DONE]
```

- 没有哪个帧专门给出 Session 的 id：新 Session 由它的 `session_meta`（流的第一条记录）给出，延续 Session 的运行即请求所带的 `session_id`。
- 服务器先订阅 Session、再启动 Task，所以这次运行的内容不会漏掉。被拒绝的请求（例如会话正忙或请求体有误）在流开始之前以 JSON 作答。
- 流从本次运行的第一条主 Session 记录开始：Session 在此之前发布的内容（例如后台子 Agent 的输出）不在这条流上。
- Session 回到空闲时写出 `[DONE]`。响应体在它之前就结束，意味着连接断了，运行的结局未知：`GET …/sessions/:sessionId` 给出它的状态，历史给出它的记录。
- 服务器未能完成的运行，在 `[DONE]` 之前留下最后一个未闭合的 `task_begin`。
- 断开连接即中止运行，并拒绝其待决的审批。`POST …/sessions/:sessionId/abort` 中止运行而保留流：记录以 `abort` 和 `task_end` 结束，流以 `[DONE]` 结束。

## Session 流

| 入口 | 路径 | 凭据 |
| --- | --- | --- |
| 密钥门 | `GET /api/amsp/v1/sessions/:sessionId/stream` | 该 Agent 的密钥；Agent 允许无密钥访问时可不带。只限该 Agent 的 API 会话 |
| Cookie 门 | `GET /api/sessions/:sessionId/amsp` | 登录 Cookie 或本机 API token，Project 授权与 Web App 相同 |

两个入口用同一个处理器。Session 流跨运行跟随该 Session，也包括不是由它发起的运行：经 `POST …/sessions/:sessionId/tasks` 发起的、在 Web App 中发起的，或其他调用方发起的。它只携带记录和 `ping`：没有 `[DONE]`，订阅时也没有状态快照。流一直保持打开，直到调用方关闭它。

- **续传。** 把最后见到的记录 id 作为 `Last-Event-ID` 发送；无法设置请求头时，改用查询参数 `lastEventId`，两者同在时以请求头为准。服务器为每个活跃 Session 保留有界的缓冲：id 仍在缓冲中时，先补发它之后的记录。不在时（缓冲已越过它，或服务器在此期间重启过），不开流：请求以 `409` `resync_required` 作答，错误信封与其他错误相同。此时像第一次打开那样从头开始：读取历史，并不带 id 订阅。
- **加入。** 先订阅、再读历史，中间就不会漏掉记录：把这期间到达的记录暂存起来，在历史之后交付，并跳过历史中已有的记录。历史的 `live` 字段把两者接起来，见[历史](#历史)。客户端的 `SessionReader` 做的正是这些。
- **死连接。** 收到过 `ping` 的流此后 50 秒毫无动静，即为死连接：关闭它，带着 `Last-Event-ID` 重新打开。
- Web App 自己的 `GET /api/sessions/:sessionId/stream` 是另一条通道：它携带同样的记录，另外还有 Web App 的服务器事件，见[流式传输（SSE）](/server-api#流式传输sse)。

### 历史

`GET …/sessions/:sessionId/messages`（`/api/amsp/v1/sessions/:sessionId/messages` 或 `/api/sessions/:sessionId/messages`）读取 Trace 中保存的内容，子 Agent 的记录就地展开：

- 不带参数时，返回完整历史，包括每个 Trace 文件开头的 `session_meta`；
- 带 `tailLimit=n` 时，返回最新的 n 个 Task；
- 带 `before=<cursor>&limit=n` 时，返回游标之前的 n 个 Task，游标形如 `<file>:<ordinal>`，取自上一页的 `page.before`。`limit` 默认为 200，n 在 1 到 1000 之间。

窗口从不切开 Task，大小不超过 4 MiB，且至少包含一个 Task。不属于任何 Task 的记录（例如手动压缩、模型切换）归入它之前的那个 Task。

响应就是 Web App 自己的历史读取，两个入口共用，所以响应自身的字段为 camelCase，每条记录仍为 snake_case：

```ts
interface MessagesResponse {
  messages: (AmspRecord & { tracePosition?: { fileIndex: number; ordinal: number } })[];
  live?: { cursor: string; fragments: AmspRecord[] };
  page?: {
    before?: string; // pass back as `before`; absent at the beginning
    earlierTurns: number;
    prior: Record<string, number>;
    contextModel?: { provider: string; modelId: string };
    agentState?: string;
  };
}
```

- 分窗读取带 `page`，其中的图片按引用下发：主 Session 记录里 PNG、JPEG、GIF 或 WebP 的 `data:` URL 会被替换为所在入口的 `…/sessions/:sessionId/trace-image?file=&ordinal=[&i=]`，由它返回图片。
- Session 运行期间带 `live`，`before` 页除外。`cursor` 是读取历史时流的最后一个 id，`fragments` 把每条仍在流式产出的消息表示为一条 `partial_*` `start`，携带到此为止流出的全部内容。丢弃暂存的、id 不晚于 cursor（同一 epoch）的 `partial_*` 记录，以 `fragments` 代替，再交付其余记录。cursor 从不丢弃完整记录，完整记录与历史去重即可。cursor 的 epoch 与流不同时，跳过 `live`，交给 `resync_required` 之后的从头开始处理。

## 审批

API 会话的[审批模式](/agent-api#审批模式)要求询问某次调用时，该调用进入等待。等待中的调用是一个资源，而不是流上的帧：

```text
GET  …/sessions/:sessionId/approvals[?wait=<seconds>]
     → 200 {"approvals": [{"tool_call": <the tool_call record's payload>, "origin"?: [...]}]}
POST …/sessions/:sessionId/approvals/:toolCallId   {"decision": "allow" | "deny"}
     → 204, or 404 approval_not_found when it was already decided or never waited
```

- 不带 `wait` 时，立即返回列表。带上它时，列表为空就挂起请求：有调用进入等待即作答，时间到则返回空列表，调用方离开时关闭。`wait` 被限制在 1–60 之间；不是整数时返回 `400`。
- 子 Agent 的调用带着 `origin` 出现在列表里，通过主 Session 的 id 回答。
- 引擎执行的每次调用都有一条 `approval_decision` 记录，自动判定的也不例外：`allow`、`deny`，或命令策略否决时的 `forbidden`。所以程序看到一个已完成、尚无决定的 `tool_call` 时，可以一直查询该资源，直到每次调用都有了决定。
- 会话取消归档后，Web App 也能回答同一次调用，以先到的回答为准。服务器不设超时。
- Cookie 门在 `GET /api/sessions/:sessionId/approvals` 列出同样的调用，在 `POST /api/sessions/:sessionId/approvals/:toolCallId` 回答它们。

## 运行的结果

`[DONE]` 只说明运行结束了，运行的情况在记录里。客户端的 `RunResult` 从主 Session 的记录（不带 `origin` 的那些）中读出它，依次判定：

1. 最后一个 `task_begin` 没有 `task_end`，或没有任何 Task 开始：`fatal`，错误码 `internal`。服务器在驱动运行时出了故障。
2. 有 `abort` 记录：`aborted`，带其错误。达到轮次上限的 Task 也这样结束，错误码为 `max_turns`。
3. 最后一个非 `completed` 且不带 `retry_in_ms` 的 `request_end` 或 `compaction_end`，其后没有新的 `request_begin`：取它的状态和错误。重试始终没能越过输出上限的响应，以 `retryable` 结束，错误码为 `output_truncated`。
4. 其余情况为 `completed`。

结果的其余字段：

- `text`：主 Session 中以 `completed` 结束的 Request 的助手文本，以空行连接，不含 `compaction_begin` 与 `compaction_end` 之间的内容（被重试或被中断的 Request 不计入，尽管它们的文本也有记录）；
- `usage`：全部 `token_usage.request` 之和，包括子 Agent 的；
- `sessionUsage`：主 Session 最后一个 `token_usage.session`，没有时为 `null`；
- `requests`：主 Session 的 `request_begin` 记录数，包括重试的尝试。

自行读取流的程序，把记录交给客户端的 `RunCollector`（延续 Session 的运行同时给出所发送的 `session_id`），就能得到同样的结果。

## 错误

流开始之前，拒绝以 HTTP 状态码和 `{"error": {"code", "message"}}` 表示，状态码列在[错误](/agent-api#错误)中。以 `fatal` 或 `retryable` 结束的运行，HTTP 响应仍是 `200`：HTTP 状态码只反映请求本身。

流中的故障由记录的 `error_code` 和 `error_message` 表示：出现在 `request_end` 和 `compaction_end` 上、`abort` 上，以及 `mcp_connect_end` 及其每一项 `results` 上。错误码如下：

| `error_code` | 含义 |
| --- | --- |
| `user_abort` | 运行被中止：经 `POST …/abort`、运行流的调用方断开连接，或有人在 Web App 中中止 |
| `backoff_interrupted`、`compaction_interrupted` | 中止发生在引擎等待重试期间，或压缩期间 |
| `max_turns` | Task 达到轮次上限；`error_message` 写明上限 |
| `timeout` | 模型连接没有了动静 |
| `network` | 连接中断、没有更具体错误码的供应商错误，或无法归类的故障 |
| `rate_limited` | 供应商返回 `429`：触发限流，或配额耗尽 |
| `malformed` | 模型响应解析失败或被截断 |
| `output_truncated` | 模型响应停在输出上限：不提交，并会重试 |
| `auth` | 供应商拒绝了凭据 |
| `rejected` | 供应商明确拒绝了请求（参数、配额） |
| `image_rejected` | 带图片的请求被供应商以 4xx 拒绝；引擎不看报文，一律视为图片被拒。图片换成一句固定说明后立即重试，供应商的报错原文由重试输入的 `[request_error]` 行携带（`retryable`，`retry_in_ms: 0`） |
| `unsupported` | 请求要求了模型做不到的事 |
| `invalid_input` | 输入无法组装成请求 |
| `connect_failed` | 某个 MCP Server 连接失败 |
| `mcp_needs_setup`、`mcp_sign_in_required` | 没有连接某个 MCP Server：其条目引用了 Agent 的 Vault 中没有的键，或该 Server 需要 OAuth 登录 |

`internal` 不是任何记录的错误码，它是 `RunResult` 给最后一个 Task 未闭合的运行所用的错误码。

## 示例

下面省略了时间戳、id 和空行，`…` 代表这一行用不到的字段。

一次等待调用方审批的工具调用，之后是第二次 Request。工具在第一次 Request 尚未结束时执行：

```text
data: {"type":"event_msg","payload":{"type":"request_begin","thinking_level":"medium"}}
data: {"type":"model_msg","payload":{"type":"partial_tool_call","event_type":"start","name":"exec_command","tool_call_id":"call_1",…}}
data: {"type":"model_msg","payload":{"type":"partial_tool_call","event_type":"delta","arguments":"{\"command\": \"ls\"}","tool_call_id":"call_1",…}}
data: {"type":"model_msg","payload":{"type":"partial_tool_call","event_type":"stop","tool_call_id":"call_1",…}}
data: {"type":"model_msg","payload":{"type":"tool_call","role":"assistant","name":"exec_command","arguments":"{\"command\":\"ls\"}","tool_call_id":"call_1"}}
            ← caller: GET …/sessions/<id>/approvals?wait=30 → {"approvals":[{"tool_call":{…,"tool_call_id":"call_1"}}]}
            ← caller: POST …/sessions/<id>/approvals/call_1 {"decision":"allow"} → 204
data: {"type":"event_msg","payload":{"type":"approval_decision","decision":"allow","tool_call_id":"call_1"}}
data: {"type":"model_msg","payload":{"type":"partial_tool_call_output","event_type":"start","output":"","tool_call_id":"call_1",…}}
data: {"type":"event_msg","payload":{"type":"token_usage",…}}
data: {"type":"event_msg","payload":{"type":"request_end","status":"completed"}}
data: {"type":"model_msg","payload":{"type":"partial_tool_call_output","event_type":"delta","output":"README.md\nsrc\n","tool_call_id":"call_1",…}}
data: {"type":"model_msg","payload":{"type":"partial_tool_call_output","event_type":"stop","tool_call_id":"call_1",…}}
data: {"type":"model_msg","payload":{"type":"tool_call_output","role":"user","output":"README.md\nsrc\n","tool_call_id":"call_1","status":"completed"}}
data: {"type":"event_msg","payload":{"type":"request_begin","thinking_level":"medium"}}
…
```

一次临时故障及其重试，之后调用方中止了运行：

```text
data: {"type":"event_msg","payload":{"type":"request_begin",…}}
data: {"type":"event_msg","payload":{"type":"request_end","status":"retryable","error_code":"network","error_message":"fetch failed","attempt":1,"retry_in_ms":1000}}
event: ping
data: {}
data: {"type":"event_msg","payload":{"type":"request_begin",…}}
data: {"type":"model_msg","payload":{"type":"partial_text","event_type":"delta","text":"Let me",…}}
            ← caller: POST …/sessions/<id>/abort → 202
data: {"type":"model_msg","payload":{"type":"partial_text","event_type":"stop",…}}
data: {"type":"model_msg","payload":{"type":"text","role":"assistant","text":"Let me"}}
data: {"type":"event_msg","payload":{"type":"request_end","status":"aborted","attempt":2}}
data: {"type":"event_msg","payload":{"type":"abort","error_code":"user_abort"}}
data: {"type":"event_msg","payload":{"type":"task_end"}}
data: [DONE]
```

## 从 v1 旧事件到记录

在 PenguinHarness 0.2.16 及更早的版本中，`/api/amsp/v1` 把这些记录翻译成 `<subject>.<phase>` 形式的事件，每个事件是一行只带 `type` 和 `at` 的 `data:`。路径没变，事件被替换了，所以解析这些事件的程序，或使用 0.2.16 及更早的 `@prismshadow/amsp` 客户端的程序，需要对照下表。之后版本的客户端同样读不懂旧服务器的事件。

| 旧事件 | 现在 |
| --- | --- |
| `run.started` | 没有对应的帧：新 Session 由它的 `session_meta` 给出，延续的 Session 即请求所带的 `session_id`，Agent 即请求所指定的 Agent |
| `run.done` | `data: [DONE]`；状态与计数按同样的规则从记录读出（[运行的结果](#运行的结果)） |
| `context.opened` | `session_meta` |
| `mcp_connect.started` / `mcp_connect.done` | `mcp_connect_begin` / `mcp_connect_end` |
| `tools.ready` | `tool_list_ready` |
| `request.started` / `request.done` | 带 `thinking_level` 的 `request_begin` / `request_end`，其用量是它之前的那条 `token_usage` |
| `text.delta`、`thinking.delta`、`tool_call.delta`、`tool_result.delta` | `partial_text`、`partial_thinking`、`partial_tool_call`、`partial_tool_call_output`，`event_type` 为 `start`、`delta` 或 `stop` |
| `text.done`、`thinking.done`、`tool_call.done`、`tool_result.done`、`inline_data.done`、`inline_thinking.done`、`image_url.done` | 完整的 `text`、`thinking`、`tool_call`、`tool_call_output`、`inline_data`、`inline_thinking`、`image_url`，带 `fidelity` 和 `sender` |
| `summary.delta` / `summary.done` | `compaction_begin` 与 `compaction_end` 之间的 `partial_text` / `text` |
| `approval.requested` | 待决审批资源 `GET …/sessions/:sessionId/approvals` |
| `approval.decided` | `approval_decision` |
| `compaction.started` / `compaction.done` | `compaction_begin` / `compaction_end` |
| `hook.fired` | `hook` |
| `status: "fatal"`、错误码 `internal` 的 `run.done` | `[DONE]` 之前留下未闭合的 `task_begin` |
| `: keep-alive` | `event: ping` |
| `at` | 外壳的 `timestamp` |

线上新增的有：`task_begin` / `task_end`、`abort`、`token_usage`、每条分片的 `stop`，以及本次运行自身的输入。压缩请求的 `request_begin` / `request_end` 与 `subagent` 指针仍只写 Trace。

## 版本

- 版本写在路径里：`/api/amsp/v1`；记录本身不带版本。
- 在 `/v1` 之内只做增加：新的记录、新的可选字段、新的控制帧。忽略未知内容的读取方可以继续工作。
- 改变已有字段的含义需要新版本。
- 记录就是 Trace 的记录本身，所以记录的改动就是 AMSP 的改动，遵守同样的规则。

## 自行读取流

运行是带 `Authorization` 的 POST 请求，所以请用 `fetch` 读取，不要用 `EventSource`。与服务器同源的页面可以用 `EventSource` 打开 Cookie 门的 Session 流，自行重开时把 `lastEventId` 写进 URL。按 `EventSource` 的规则读取响应体：行以 LF、CRLF 或单独的 CR 结束；空行结束一个事件；以 `:` 开头的行是注释；同一事件的多行 `data:` 以换行符连接。然后按事件名分派，运行流读到 `data: [DONE]` 时停止。

`@prismshadow/amsp` 导出了其中每一步：`readSse` 把响应体的事件逐个产出为 `{event, id, data}`，`frameOf` 把一个事件分为记录、控制帧、`[DONE]` 或 AMSP 未定义的事件名，`readAmsp` 两步一起做，`RunCollector` 把一次运行的记录归并为它的结果。见[客户端参考](/agent-api#客户端参考)。
