# PRFC-0018 AMSP 与 Agent API

[English](PRFC-0018-amsp.md)

> **来源**：设计仓 [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) 的 `rfcs/PRFC-0018-amsp.md`——落地于默认分支 `main`（提交 [`ac673a24`](https://github.com/Prism-Shadow/penguin-harness-design/commit/ac673a245eec78d6afca35e260dce28b2a3ab3ac)）。
> **修订**：v1.1.0（v1.0.0 迁入主仓）；本面的约定见 [README.zh.md](README.zh.md)，逐版本改动记在文末 `## Changes`。

- Feature Name: `amsp`
- Start Date: 2026-10-07
- PRFC PR: Prism-Shadow/penguin-harness-design#266
- Implementation PR: Prism-Shadow/penguin-harness#1000（叠在会话来源的改动之上）
- 相关: PRFC-0001「Module」（路由组即贡献）；MMSP（agenthub）的流协议

## Summary
[summary]: #summary

AMSP（Agent Message Stream Protocol）是 MMSP 在 Agent 层的对应物：MMSP 流式传输一次模型调用，AMSP 流式传输一次 Agent 运行（一个 Task，TAX-006）。它是服务端对 Session 既有实时流（OmniMessage 与 `task_state` / `approval_request` 服务端事件）的投影，经 SSE 以 `data:` 行传输、以 `data: [DONE]` 收尾；OmniMessage 不为它增加任何字段。配套的 Agent API 让 Project owner 在 Agent 设置页的「API」标签为单个 Agent 开启对外访问、设定 API 会话的审批模式、签发密钥；外部程序凭 Base URL、密钥（可选）与 Agent ID 发起会话，以 `session_id` 延续上下文。JS SDK `@prismshadow/amsp` 是它的客户端，AMSP 的类型也由它导出，服务端只以类型引用。

## Motivation
[motivation]: #motivation

需求是让外部程序与某个 Agent 对话：凭 URL、可选的密钥与 Agent ID 发起会话，凭 Session id 延续上下文；按 Agent 开启，开启的 Agent 在列表里有标记；再配一个连接它的 JS SDK。

既有的两条路都不合适：

- **Web App 自己的 API**（`/api/sessions/*`）。它认的凭据是登录 Cookie 或本机 API token，后者认证为内置 admin（05「CLI › 鉴权：本机 API token」）——交给外部程序就等于交出整台服务器。它的流也是内部协议：`partial_*` 的 start / stop、`resync_required`、`task_state` 的重复发布、服务端事件的种类都随实现演进，一旦成为外部契约，每次内部调整都是破坏性变更。
- **消息接入**（05「消息接入（Messaging）」）。它把聊天软件的会话绑到一个既有 Session，送回的是给人看的完成文本。程序要的是按 Agent 开出的入口、每个调用方各自的 Session，以及工具调用、审批、用量这些结构化的过程。

具体场景：

- CI 里的一个脚本把 diff 交给评审 Agent，读回结论与用量；下一次调用带上 `session_id`，就同一段上下文追问。
- 一个后端把某个 Agent 当作服务，流式转发它的回答；工具调用需要确认时，由这个后端自己的界面去问用户，再把决定交回。
- 本机的网页或桌面工具直接调用本机 PenguinHarness 上的 Agent，不必登录 Web App。

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

**给 Project owner。** 打开 Agent 设置页的「API」标签，打开「开启 API 访问」，在其下选择 API 会话的审批模式（缺省 `allow-all`）。「连接」一节给出 Base URL（`<站点地址>/api/amsp/v1`）与 Agent ID（`<project_id>/<agent_id>`），各带复制按钮；「新建密钥」起一个名字，密钥只显示这一次。只在本机使用时可以打开「允许无密钥访问」——任何能访问这个地址的程序都能与该 Agent 对话。开启后，Agents 列表里这个 Agent 的标题行带一枚 API 图标；经 API 开出的会话出现在侧栏该 Agent 的「后台会话」子夹里，人可以打开、阅读、审批、接着输入。标签末尾的「试一试」以登录身份跑一次示例（「现在几点了？」），看到的就是程序将收到的完整事件流，再次运行即以 `session_id` 续接。

**给调用方。** 一次请求就是一次运行：

```bash
curl -N http://localhost:7364/api/amsp/v1/agents/demo/coder/runs \
  -H "Authorization: Bearer $PENGUIN_AGENT_KEY" -H "Content-Type: application/json" \
  -d '{"input":"Say hello"}'
```

```text
data: {"type":"run.started","at":"2026-10-07T10:00:00.000Z","session_id":"session-2026-10-07-10-00-00-3f9a1c2e","agent":"demo/coder"}
data: {"type":"request.started","at":"…","request":1}
data: {"type":"text.delta","at":"…","role":"assistant","text":"Hello"}
data: {"type":"text.delta","at":"…","role":"assistant","text":"!"}
data: {"type":"text.done","at":"…","role":"assistant","text":"Hello!","stop_reason":"completed"}
data: {"type":"request.done","at":"…","request":1,"status":"completed","usage":{"cache_read":0,"cache_write":0,"output":2,"total":412}}
data: {"type":"run.done","at":"…","status":"completed","requests":1,"usage":{"cache_read":0,"cache_write":0,"output":2,"total":412},"session_usage":{"cache_read":0,"cache_write":0,"output":2,"total":412}}
data: [DONE]
```

- 第一个事件 `run.started` 给出 `session_id`；下一次请求体带上它（`{"session_id": "…", "input": "…"}`）即延续同一段上下文。
- 流总以 `run.done` 收尾，`status` 为 `completed` / `aborted` / `retryable` / `fatal` 之一，整次运行的用量在这里汇总。没有 `run.done` 就结束的流说明连接断了。
- 每个条目先有零到多个 `.delta` 片段，再有一个携带完整内容的 `.done`（流式产出的压缩摘要例外，它只有片段）；只关心结果的调用方只读 `.done` 即可。工具在调用完整时就开始执行，其审批与结果可能在该次 Request 的 `request.done` 之前就出现。
- 审批模式需要询问时，流里出现 `approval.requested`，调用方以 `POST …/sessions/<id>/approvals/<tool_call_id>` 回答 `allow` 或 `deny`。断开连接即中止这次运行。

JS 程序用 SDK：

```ts
import { AgentClient } from "@prismshadow/amsp";

const client = new AgentClient({ baseUrl: "http://localhost:7364/api/amsp/v1", agent: "demo/coder", apiKey: process.env.PENGUIN_AGENT_KEY });

const run = client.stream({ input: "Summarize README.md" });
for await (const event of run) {
  if (event.type === "text.delta") process.stdout.write(event.text);
}
const first = await run.result();

const second = await client.run({ sessionId: first.sessionId, input: "Now list its headings", onApproval: () => "allow" });
console.log(second.text, second.usage.total);
```

不给 `onApproval` 时，SDK 对每个审批请求都回答 `deny`。

**给维护者。** AMSP 是一层翻译，不是第二条执行路径：运行照常由 `SessionManager` 驱动，翻译器订阅同一个 Session 通道，把收到的事件逐条映射成 AMSP 事件。内部流可以继续演进，只要映射表跟上；对外契约只按 `/v1` 的规则变化。

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### AMSP

#### 与 MMSP 的关系

照搬 MMSP 的：SSE `data:` 行、以 `data: [DONE]` 收尾；无事可报时的 `: keep-alive` 注释；字节一律以 base64 文本传输；一种错误信封加一张固定的 HTTP 状态表；错误或缺失的密钥在读取请求体之前就被拒绝；开放（无密钥）要明说——MMSP 在启动时说，这里在 Agent 的 API 标签上说；用量在结尾读（`run.done`），每次 Request 的用量另见 `request.done`。

不照搬的：`event_type` / `content_items` 嵌套——AMSP 事件是以 `type` 区分的扁平对象；`fidelity`（供应商内部的保真字段，Trace 照存）；`session_meta.source`（经 API 运行的 Session 天然是 `api`）。MMSP 的条目是 `K.delta+ K.done`，AMSP 放宽为 `K.delta* K.done`：内部的完整消息可以没有片段形态（如 `inline_data`），也可以不经片段直接到达。

#### 传输

- `POST /api/amsp/v1/agents/:projectId/:agentId/runs`，`Content-Type: application/json`，可选 `Authorization: Bearer <key>`。成功即 `200`、`Content-Type: text/event-stream; charset=utf-8`、`Cache-Control: no-cache`、`X-Accel-Buffering: no`；每个事件一个 `data: <JSON>` 块，不带 `event:` / `id:`（v1 不支持续传），最后是 `data: [DONE]`。
- 静默 15 秒即写一行 `: keep-alive`（MMSP 的取值）。
- 每个事件带 `type` 与 `at`（ISO 8601 UTC）；子会话的事件另带 `origin`，与 OmniMessage 的 `origin` 相同——由外到内的 Session 链，缺省即主会话。
- 流开始之前的错误：HTTP 状态码加 `{"error": {"code": "<snake_case>", "message": "<text>"}}`，即服务端既有的错误信封。流开始之后的错误不单独成帧：终止事件 `run.done` 带上 `status` 与 `error`，随后 `[DONE]`。
- 字节字段（`inline_data.done.data`、`inline_thinking.done.data`、工具结果的 `images[]`、输入里的 data URL）两个方向都是 base64 文本。
- 路由区分大小写；前缀下的未知路径答 JSON `404 not_found`，不落入 SPA，也不是 401。

#### 文法

```text
stream       := run.started body* run.done                 ; 恰好一个终止事件，总会发出
body         := context.opened | mcp_connect.started | mcp_connect.done | tools.ready
              | request | tool_result | approval | compaction | hook.fired
              | text.done(role user) | image_url.done
request      := request.started (item | tool_result | approval | hook.fired)* request.done
item         := K.delta* K.done                            ; K = thinking | text | tool_call | inline_data | inline_thinking
tool_result  := tool_result.delta | tool_result.done       ; 各为单个事件：一次结果为 tool_result.delta* tool_result.done，
                                                           ; 按 tool_call_id 归属，可以跨过 request.done
approval     := approval.requested | approval.decided
compaction   := compaction.started (summary.delta* | summary.done)? compaction.done
```

规则：

1. **恰好一个终止事件。** `run.done` 是 `[DONE]` 之前的最后一个事件：正常完成、中止、致命或重试耗尽的失败、服务端内部故障（`status: "fatal"`、`error.code: "internal"`）都如此。没有它就结束的流说明连接断了，SDK 抛 `AmspStreamError`。
2. **条目以 `.done` 闭合，片段与 `.done` 从不对账。** `.done` 携带完整内容；服务端把片段与完整条目都按引擎产出的原样转发，从不由一方重建另一方。`text` 与 `thinking` 的片段拼接起来等于 `.done`；`tool_call` 则未必：片段是供应商的原始文本，`tool_call.done.arguments` 是引擎对解析后参数的再序列化（片段 `{"command": "ls"}`，完整 `{"command":"ls"}`），二者解析为同一对象。`.done` 之前可以没有片段；流式产出的压缩摘要是唯一没有 `.done` 的条目（规则 7）。
3. **同一 origin 的模型输出依次出现，工具结果不是条目。** 同一 origin 内，`thinking` / `text` / `tool_call` / `inline_*` 条目依次出现：一个条目的 `.done` 先于下一个条目的首个片段。`tool_result.*`、`approval.*` 与 `hook.fired` 可以落在一个条目的任意两个事件之间，并行工具的结果彼此交错，按 `tool_call_id` 归属；不同 origin 自由交错，按 `origin` 归属。
4. **一对 Request 事件括住的是它的模型输出，不是它的工具执行。** 引擎在调用完整时就开始执行工具，此时 Request 仍未结束：`approval.*` 先于这次 Request 的 `request.done` 到达；结果在调用获准后即开始，通常也先于 `request.done`，并可能在它之后才结束。一次 Request 的全部结果都在同一 origin 的下一个 `request.started` 之前到齐。重试是新的一对：`request.done` 的 `status` 为 `retryable` 并带 `retry_in_ms`，随后再来一个 `request.started`。
5. **用量。** `request.done.usage` 是这一次尝试的计数（没有则为 null）；`compaction.done.usage` 是压缩各次尝试之和；`run.done.usage` 是本次运行全部 `request.done.usage` 与 `compaction.done.usage` 之和；`run.done.session_usage` 是引擎最后报告的 Session 累计（没有则为 null）。
6. **未知的 `type` 必须忽略。** `/v1` 之内只做加法——新事件类型、新的可选字段；改变既有字段的含义即 `/v2`。
7. **压缩。** `compaction.started` 与 `compaction.done` 之间只有 `summary.*`：压缩请求的思考不转发，`text.*` 也不会出现。引擎对摘要只流式产出片段或只给出完整文本，二者不会都有：流式产出的摘要是 `summary.delta*` 直接接 `compaction.done`，没有 `summary.done`；整段给出的摘要是一个 `summary.done`。压缩之后没有 `context.opened`：压缩开出的新上下文由引擎写进 Trace，不进流。实际上 `context.opened` 只在子会话开始时出现（带 `origin`）；主会话只在切换模型时流出它，而切换发生在两次运行之间。

#### 事件

字段以 `@prismshadow/amsp` 导出的类型为准，线上一律 snake_case。共用词汇与 OmniMessage 同字同义：`StopReason` 为 `completed` | `aborted` | `retryable` | `fatal`；用量 `TokenCounts` 为 `{ cache_read, cache_write, output, total }`；错误 `AmspError` 为 `{ code, message }`，`code` 稳定、snake_case。

| 事件 | 字段（`type` 与 `at` 之外） | 含义 |
| --- | --- | --- |
| `run.started` | `session_id`、`agent`（`<projectId>/<agentId>`） | 首个事件；新建的 Session 在此给出 id |
| `run.done` | `status`、`error?`、`requests`、`usage`、`session_usage` | 唯一的终止事件；`requests` 为本次运行发出的 Request 数（含重试） |
| `context.opened` | `session_id`、`provider`、`model_id`、`context_window` | 引擎流出的新上下文：带 `origin` 即子会话开始；主会话只在切换模型时流出它（发生在两次运行之间），压缩开出的上下文不进流 |
| `mcp_connect.started` / `.done` | `servers` / `status`、`results`、`error?` | MCP Server 的连接 |
| `tools.ready` | `tools`（`name`、`description`、`parameters?`） | 本上下文的工具清单 |
| `request.started` / `.done` | `request`（运行内从 1 起）/ 另有 `status`、`usage`、`error?`、`attempt?`、`retry_in_ms?` | 一次 Request 尝试（TAX-005）；`retry_in_ms` 只在引擎将在本次运行内重试时出现 |
| `text.delta` / `.done` | `role`、`text` / 另有 `stop_reason`、`sender?` | 文本；`role: "user"` 的 `.done` 是运行中途注入的用户文本（steering、钩子续跑、harness 提示） |
| `thinking.delta` / `.done` | `thinking` / 另有 `stop_reason` | 思考 |
| `tool_call.delta` / `.done` | `tool_call_id`、`name`（首个片段带，其后可为空）、`arguments`（片段为供应商流出的原始文本 / 完整为引擎对解析后参数的再序列化）/ 另有 `stop_reason` | 工具调用 |
| `tool_result.delta` / `.done` | `tool_call_id`、`output`、`images?` / 另有 `stop_reason` | 工具结果，可在 `request.done` 之前开始、之后结束；`images` 不分片，一个片段带全集 |
| `inline_data.done` / `inline_thinking.done` | `role`（仅前者）、`mime_type`、`data`（base64）、`stop_reason` | 内联二进制输出，没有片段形态 |
| `image_url.done` | `role: "user"`、`image_url` | 运行中途注入的用户图片 |
| `approval.requested` / `.decided` | `tool_call`（`tool_call_id`、`name`、`arguments`）/ `tool_call_id`、`decision`（`allow` / `deny` / `forbidden`） | 审批 |
| `compaction.started` / `.done` | `reason`、`mode`、`context`、`turns` / `reason`、`mode`、`status`、`usage`、`error?`、`attempt?` | 压缩 |
| `summary.delta` / `.done` | `text` / 另有 `stop_reason` | 压缩摘要，只出现在压缩之内；流式产出时只有片段、没有 `.done`，整段给出时只有一个 `.done` |
| `hook.fired` | `hook`、`name`、`decision?`、`reason?`、`output?` | 钩子 |

请求与响应体：运行 `{ session_id?, input }`，`input` 为字符串，或 `{ type: "text", text }` 与 `{ type: "image_url", image_url }`（data URL 或 http(s) 地址）组成的数组；`GET` 两条路由分别返回 `{ agent: { id, name?, description? } }` 与 `{ session: { id, agent, status, provider, model_id, created_at, last_active_at } }`；审批体为 `{ decision: "allow" | "deny" }`。

#### 映射

翻译器 `AmspTranslator`（`packages/server/src/amsp/translate.ts`）是纯类：`feed(evt)` 把 `SessionManager.drive` 发到 Session 通道上的一条事件（OmniMessage 外壳，或 `server_event`）映射成零到多个 AMSP 事件。它只持有：提交的输入（用来丢掉其回显）及其是否已出现、按 origin 的 Request 序号 / 待盖章用量 / 压缩内累计用量、本次运行的累计、最近的 `session_usage`、中止记录、终止记录，以及主会话最后一条 assistant 文本的 `stop_reason`。

| 内部（OmniMessage `payload.type` 或服务端事件） | AMSP | 说明 |
| --- | --- | --- |
| 输入回显之前通道上的一切（子会话状态变化重发的空闲 `task_state`、后台子会话的输出） | （丢弃） | 翻译器从本次输入的回显开始；跟随重建后新 id 的处理器则立即开始 |
| 本次运行自己的输入消息 | （丢弃） | 与提交的外壳逐字比对 |
| `session_meta` | `context.opened` | 带 `origin` 即子会话开始；不带的只在切换模型时流出（两次运行之间）。首个上下文与压缩开出的上下文只写 Trace，不进流 |
| `mcp_connect_begin` / `mcp_connect_end` | `mcp_connect.started` / `.done` | 错误码与错误信息合成 `error` |
| `tool_list_ready` | `tools.ready` | |
| `request_begin` | `request.started` | 序号按主会话的 `request_begin` 递增；子会话各自计数 |
| `token_usage` | （暂存） | 它先于 `request_end` 到达：盖到下一个 `request.done`（压缩之内为 `compaction.done`）上并计入累计，其 Session 累计即 `session_usage` |
| `request_end` | `request.done` | 非 `completed` 且不带 `retry_in_ms` 的，记为本次运行的终止错误 |
| `partial_text` / `partial_thinking` / `partial_tool_call` / `partial_tool_call_output` 的 start 与 delta | `text.delta` / `thinking.delta` / `tool_call.delta` / `tool_result.delta` | stop 不产生事件；压缩之内的 `partial_text` 为 `summary.delta`、其后没有 `summary.done`，压缩之内的 `partial_thinking` 丢弃 |
| `text`（assistant）/ `thinking` / `tool_call` / `tool_call_output` | `text.done` / `thinking.done` / `tool_call.done` / `tool_result.done` | 压缩之内的 assistant `text` 为 `summary.done`（引擎只在整段给出摘要时才有它），压缩之内的 `thinking` 丢弃；`arguments` 保持字符串，片段与完整各自原样、不重建也不比对；工具在调用完整时即执行，其结果可先于本次 Request 的 `request_end` 到达 |
| 运行中途的用户 `text` / `image_url` | `text.done`（`role: "user"`，带 `sender`）/ `image_url.done` | |
| `inline_data` / `inline_thinking` | `inline_data.done` / `inline_thinking.done` | |
| 服务端事件 `approval_request` / `approval_decision` | `approval.requested` / `approval.decided` | `origin` 照抄；发生在 Request 未结束时——引擎等到决定之后才继续读模型流 |
| `compaction_begin` / `compaction_end` | `compaction.started` / `.done` | 置位 / 清除「在压缩之内」；`fatal`，或 `retryable` 之后没有新的 `request_begin`，记为终止错误候选 |
| `hook` | `hook.fired` | |
| `abort` | （记下） | 其错误码进 `run.done.error`，状态 `aborted` |
| 服务端事件 `task_state` 回到 `idle` | `run.done` | 运行中重复发布的 `running` 忽略 |
| 其余服务端事件（`session_title`、`goal_*`、`resync_required` 等） | （丢弃） | 不属于一次运行的记录 |

`run.done.status` 依次判定：见过 `abort` → `aborted`；记下了终止的 `request_end` / `compaction_end` → 取它的状态与错误；主会话最后一个 assistant `text.done` 的 `stop_reason` 为 `fatal` 而没有记下错误（引擎的最大轮数提示）→ `fatal`，不带 `error`；否则 `completed`。

这张表兑现了几条既有规则：OmniMessage 不为 AMSP 增加字段；`partial_*` 的 start / stop 仍是内部纪律；`.done` 从不由片段重建，片段与完整条目各自原样转发、从不对账；模型从它本来所在的 `session_meta` 读取。

#### 错误

流开始之前（HTTP）：

| 状态 | `code` | 何时 |
| --- | --- | --- |
| 400 | `bad_request` | 请求体不是 JSON 对象；`input` 缺失或为空；未知条目类型或文件条目；`session_id` 不是合法 id；图片 data URL 超出内联上限或 MIME 不受支持；`decision` 不是 allow / deny |
| 401 | `unauthorized` | Agent 要求密钥，而请求未带、带错或带的是已删除的密钥；在读取请求体之前判定 |
| 403 | `agent_api_disabled` | 管理员总开关关闭 |
| 404 | `agent_not_found` | 没有这个 Agent、它的 API 开关关着、或密钥属于别的 Agent——三者同一答复 |
| 404 | `session_not_found` | 未知 id、不是 API 会话、或属于别的 Agent |
| 404 | `approval_not_found` | 已决定或未知的 `tool_call_id` |
| 404 | `not_found` | 前缀下的未知路由 |
| 409 | `task_in_progress` / `compacting` | Session 正忙 |
| 413 / 415 | `payload_too_large` / `unsupported_media_type` | 既有的 `/api/*` 请求体上限与只收 JSON 的守卫 |
| 429 | `too_many_runs` | 该 Agent 已有 4 个运行中的 Session；带 `Retry-After` |
| 503 | （沿用） | 服务端正在停机、Agent 或 Session 正在被删除 |

流内（`run.done.error.code`）：按记录原样的 OmniMessage `ErrorCode`，另加 AMSP 自己的 `internal`（驱动时的服务端故障）与 `session_rebuilt`（见「一次运行」）。

#### 命名与版本

协议名 AMSP；线上版本只在路径里（`/api/amsp/v1`），事件不带版本字段。事件名为 `<主体>.<阶段>`，条目为 `K.delta` / `K.done`，与 MMSP 相同。一次 run 即一个 Task，路由名取业界通用的 runs。

#### 示例

一次工具调用由调用方审批，随后第二次 Request。工具在第一次 Request 尚未结束时执行：审批与结果的开头先于它的 `request.done`，结果的其余部分在其后；片段里的参数是供应商的原文，`.done` 里的是引擎对解析后参数的再序列化：

```text
data: {"type":"run.started",…}
data: {"type":"request.started","request":1,…}
data: {"type":"tool_call.delta","tool_call_id":"call_1","name":"exec_command","arguments":"",…}
data: {"type":"tool_call.delta","tool_call_id":"call_1","name":"","arguments":"{\"command\": \"ls\"}",…}
data: {"type":"tool_call.done","tool_call_id":"call_1","name":"exec_command","arguments":"{\"command\":\"ls\"}","stop_reason":"completed",…}
data: {"type":"approval.requested","tool_call":{"tool_call_id":"call_1","name":"exec_command","arguments":"{\"command\":\"ls\"}"},…}
            ← 调用方：POST /api/amsp/v1/sessions/<id>/approvals/call_1 {"decision":"allow"} → 204
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

两次 Request 之间的一次压缩，摘要流式产出（因此没有 `summary.done`），其后也没有 `context.opened`：

```text
data: {"type":"request.done","request":1,"status":"completed","usage":{…},…}
data: {"type":"compaction.started","reason":"context","mode":"summarize","context":300,"turns":1,…}
data: {"type":"summary.delta","text":"",…}
data: {"type":"summary.delta","text":"Summary.",…}
data: {"type":"compaction.done","reason":"context","mode":"summarize","status":"completed","usage":{…},"attempt":1,…}
data: {"type":"request.started","request":2,…}
```

### Agent API

#### 存储

开关、审批模式与密钥都不进 Agent State——Agent 不得自行开启对外暴露或放宽自己的审批；也不进 `.project_config.toml`——公司模式下它在服务器之间同步，而对外暴露只能是本服务器的决定。它们存于 web.db，属 PRN-024 所说的服务端附加功能：删掉这两张表，不影响 Agent 的运行与历史。

- `agent_api`，主键 `(project_id, agent_id)`：`enabled`（API 标签的开关，缺省关）、`open`（无密钥访问，缺省关）、`approval_mode`（API 会话**创建时**取用的审批模式，缺省 `allow-all`）、`updated_at`。缺行即从未配置：关闭、`allow-all`。
- `agent_api_keys`，每把密钥一行：`key_id`、`project_id`、`agent_id`、`token_hash`（SHA-256，唯一）、`prefix`（密钥的前 16 个字符）、`name`（1–64 个字符）、`created_by`、`created_at`、`last_used_at`（每次凭它通过认证的运行请求打点一次）。
- 管理员总开关：`server_settings` 的 `agentApiEnabled`，缺省开。
- 级联：删除 Agent 即删除它的设置与密钥；删除 Project 同理。

#### 密钥

- 形如 `penguin_` 加 43 个 base64url 字符（32 字节随机数），只在新建的响应里出现一次；此后只显示名称、前缀、创建者、创建与最近使用时间。一个 Agent 可有多把，删除即硬删除；v1 不设过期。
- 认证：取 `Bearer` 的值，求 SHA-256，按散列查找——定长摘要上的查找，耗时与所给的值无关。密钥所属的 `(project_id, agent_id)` 必须与路径一致，否则答 404 `agent_not_found`。
- 一把密钥只授予：在该 Agent 上发起运行，以及读取、中止、审批该 Agent 的 API 会话。它不能访问 `/api/*` 的任何路由，不带 Cookie，也不代表任何用户；反过来，本机 API token 与登录 Cookie 在 `/api/amsp/v1` 上同样不起作用。

#### 路由

公开组：前缀 `/api/amsp/v1`，`auth: "none"`、`order: 5`，与 `/api/auth`、`/api/desktop` 同处 `/api/*` Cookie 闸门之前。

```text
GET  /agents/:projectId/:agentId                  # 200 { agent }，名称与描述读自 Agent 配置
POST /agents/:projectId/:agentId/runs             # { session_id?, input } → 200 SSE（本协议），或上表的错误
GET  /sessions/:sessionId                         # 200 { session }
POST /sessions/:sessionId/abort                   # 202 已中止 / 204 没有运行中的 Task
POST /sessions/:sessionId/approvals/:toolCallId   # { decision } → 204 / 404 approval_not_found
*    其余路径                                      # 404 not_found
```

管理组：前缀 `/api/projects/:projectId/agents/:agentId/api`，`auth: "user"`；owner 的判定与删除 Agent 相同。

```text
GET    /             # 任意成员：{ api: { enabled, open, approvalMode, keys[] } }
PUT    /             # owner：{ enabled?, open?, approvalMode? }
POST   /keys         # owner：{ name } → 201 { key, secret }，secret 只出现这一次
DELETE /keys/:keyId  # owner：204 / 404 key_not_found
POST   /try          # owner：请求体与响应同公开组的 runs；登录身份代替密钥，其余判定（总开关、Agent 开关、请求体、续接、并发上限）与公开运行相同，不记密钥使用（API 标签的「试一试」）
```

Agent 列表的每一项另带 `apiEnabled`（一次查询得出），供 Agents 列表的 API 图标；`GET|PUT /api/admin/settings` 多一个 `agentApiEnabled`。Base URL（`${location.origin}/api/amsp/v1`）与 Agent ID（`${projectId}/${agentId}`）由 Web App 自己算出。

每个公开请求依次判定，第 2–5 步在读取请求体之前：

1. `OPTIONS` → 204 与 CORS 头。
2. 管理员总开关关闭 → 403 `agent_api_disabled`。
3. 路径中的 id 不合法 → 404。
4. `/agents/:p/:a/*`：该 Agent 的开关须开着，否则 404 `agent_not_found`。`/sessions/:id/*`：Session 索引行须为 `client = api`，其 `(project_id, agent_id)` 即所属 Agent，且该 Agent 的开关须开着，否则 404 `session_not_found`。
5. 带 `Authorization` → 查密钥（未知即 401，属于别的 Agent 即 404）；不带 → 须开着无密钥访问，否则 401（「This Agent requires an API key.」）。
6. 读取并校验请求体（400）。
7. 处理。

#### 一次运行

1. 不带 `session_id`：该 Agent 已有 4 个运行中的 Session 即 429；否则新建 Session——`source: "api"`、`client: "api"`，审批模式取该 Agent 的 API 审批模式，模型取 Project 默认，沙盒照常取服务端沙盒设置的缺省、创建时快照，与输入区开新对话相同，只是没有逐次的界面选择。带 `session_id`：第 4 步已确认它属于这个 Agent，是否空闲由启动 Task 时判定。
2. 先订阅 Session 通道、后启动 Task，第一条事件因此不会错过。启动失败（409 / 503）即取消订阅、以 JSON 答错，此时尚未写出任何流。无 Trace 的 Session 在启动时自愈重建、换了 id 的，改订新 id——引擎的第一条输出在 MCP 连接之后，其间没有内容会漏掉；跟不上时以 `run.done { status: "fatal", error: { code: "session_rebuilt" } }` 结束，消息里给出新 id。
3. 写出 `run.started`，此后每条通道事件经翻译器写出，每次写出都重置 keep-alive 计时；写出 `run.done` 后写 `[DONE]` 并结束。
4. 调用方断开而运行未结束 → 中止该 Task。驱动中抛出的任何异常 → 尽力写出 `run.done { status: "fatal", error: { code: "internal" } }` 与 `[DONE]`，并记日志与异常记录。

所用的接缝——`startTask`、`abortTask`、`statusOf`、`decideApproval`、`activeCountForAgent` 与 Session 通道——与消息桥、Web 路由用的是同一套；`SessionManager` 与 core 不为此改动。

#### 会话

- **新建**只经不带 `session_id` 的运行，第一个事件给出 id。`session_meta.source = api` 是 Trace 里的持久事实，侧栏据此把它归入「后台会话」；索引行 `client = api` 记录「哪个程序建了这一行」，续接校验读它。两条轴互不推导；会话来源的取值与侧栏的分组由会话来源的改动定义。
- **续接**：`session_id` 必须指向属于该 Agent、且 `client = api` 的 Session；Web、CLI 与组织会话一律 404 `session_not_found`。反过来不受限：人可以在 Web App 里打开 API 会话，阅读、审批、继续输入。
- 标题由首条输入自动生成；用量与成本按 Request 照常落库，花的是 Project 的模型凭据；不记驱动者，与本机 API token 发起的运行相同；密钥记下它的创建者。

#### 审批

- 每个 Agent 一个 **API 审批模式**，即输入区的四种（`allow-all` / `read-only` / `always-ask` / `deny-all`），在 API 标签的开关下方选择，缺省 `allow-all`，存于 `agent_api.approval_mode`——Agent 改写的是自己的 State 目录，够不到 web.db。
- **只在新建 Session 时读取一次**，写进该 Session 的索引行；此后行就是真相，照常逐次决策重读。人仍可在 Web App 里收紧或放宽某一个 API 会话；API 标签上的改动只作用于之后新建的 API 会话，标签上写明这一点。这沿用了上下文轮换原则对审批模式的安置（不受限的一层，逐次决策重读 Session 行），又让每个 Session 只有一处存储；若每次运行都重读 Agent 级的值，下一次 API 调用就会盖掉人对单个会话的选择——两处存储逐次相争。
- **为什么缺省 `allow-all`**：其一，与输入区一致（Session 的审批模式缺省即 `allow-all`），消息机器人的 Session 今天也是如此；其二，产品依赖的安全边界是沙盒（Agent 改不了、在 Session 创建时快照），审批是监督，而 API 的调用方是程序，不是审阅 diff 的人；其三，询问类模式只对实现了审批回调的调用方有意义——缺省就询问，第一条 curl 里的每条命令都会被拒，读起来就是坏了；其四，开启 API 是 owner 在密钥之后的有意操作，模式选择就在开关下方，暴露的那一刻就看得见。谨慎的部署一键切到 `read-only`。
- 沙盒与模型照新对话的缺省，只有审批模式取该 Agent 的 API 值；Project 新对话默认值里的审批模式（`[default_chat]` 的 `approval_mode`）是输入区的偏好，不作用于 API 会话。
- **需要询问时**：`approval_request` 照常发到 Session 通道，调用方收到 `approval.requested`，经 `POST /sessions/:id/approvals/:toolCallId` 作答；打开该会话的 Web 页面里的审批卡片同样可以作答，先到先得。API 会话有流在看，不是无人值守——组织会话（`client = org`）的「当场按拒绝落定」不适用。服务端不设超时：运行一直等到一个决定、一次中止或一次断开（断开即中止，待决的审批随之拒绝）。SDK 的缺省答复是 `deny`。

#### 并发与中断

- Session 正忙即 409 `task_in_progress` / `compacting`，不排队——排队的运行没有流可以作答。
- 断开即中止。「断开后继续运行、稍后来取」是另一种产品（后台作业），见 Future possibilities。
- 显式中止（`POST /sessions/:id/abort`）保持流打开，调用方仍收到 `run.done { status: "aborted" }` 与 `[DONE]`。
- 新建会话的运行，在该 Agent 已有 4 个运行中的 Session 时答 429（`AMSP_MAX_CONCURRENT_RUNS`，v1 为代码常量），计数含该 Agent 全部运行中的 Session。

#### 输入与限制

只收文本与 `image_url`。图片为 data URL（图片 MIME，受单张内联上限与管理员设定的单条消息合计上限约束）或 http(s) 地址（原样交给模型，服务端不取回）；v1 不收文件（400）。请求体上限沿用 `/api/*`；除并发上限外不设速率限制。

#### CORS

公开组上的一个中间件：`OPTIONS` 恒答 204，带 `Access-Control-Allow-Origin: *`、`Access-Control-Allow-Methods: GET, POST, OPTIONS`、`Access-Control-Allow-Headers: Authorization, Content-Type`、`Access-Control-Max-Age: 600`。其余请求只在带 `Authorization` 时附 `Access-Control-Allow-Origin: *`，且在处理之前设置，流式响应因此也带着它。无密钥请求不带任何 CORS 头：浏览器页面无法跨源驱动一个开着无密钥访问的 Agent——否则回环服务器上的任何网页都能顺路调用它。既有的 CSRF 防线（写请求只收 JSON）照旧；这些路由不用 Cookie。

#### 管理员总开关

`agentApiEnabled` 缺省开，逐请求从库里读取（同 `companyMode`）。关闭后每个公开请求（预检除外）答 403 `agent_api_disabled`，什么都不删；API 标签上的开关置灰并注明原因，Agents 列表的图标照旧显示。

#### 界面与 CLI

- Agent 设置页新增「API」标签（排在「定时任务」之后）：开关、API 会话的审批模式、Base URL 与 Agent ID、密钥列表与无密钥访问开关、以实际地址填好的 curl / SDK 示例，修改仅 owner。Agents 列表为开启的 Agent 加一枚 API 图标（悬停提示，不用文字徽标）。系统设置「服务器」组新增「允许 Agent API」开关。标签末尾另有「试一试」（仅 owner）：预填「现在几点了？」的输入框与「运行」按钮，经 `POST …/api/try` 以登录身份发起一次真实的 API 运行，显示事件日志（可切原始 `data:` 行）、回答、`run.done` 的状态与用量和 `session_id`，再次运行即续接；运行中可停止，询问类审批在行内作答。见 06。
- `penguin agent api status | enable | disable | set | keys ls | keys create | keys rm | server on|off`：界面能切换的，命令行都能切换；`keys create` 把密钥单独打印到 stdout。见 05「CLI › 命令面」。

#### 挂载

`packages/server/src/amsp/` 下：`module.ts`（经 `HttpModule.routes` 贡献公开组与管理组，见 PRFC-0001）、`gate.ts`（上面的判定顺序）、`routes.ts`、`run-stream.ts`（一次运行）、`try-route.ts`（「试一试」：经同一个运行处理器、以登录身份代替密钥）、`translate.ts`（翻译器）、`keys.ts`（签发与散列）；存储为 `AgentApi` 机制及其 repo。`/api/*` Cookie 闸门改为按路由组挂载的在途提案（design [#195](https://github.com/Prism-Shadow/penguin-harness-design/pull/195)）之下，`auth: "none"` 同样成立。

### SDK

`@prismshadow/amsp`（目录 `packages/amsp`）公开发布、零运行时依赖，Node 24 与浏览器通用（只用 `fetch`、`ReadableStream`、`TextDecoder`、`AbortController`、`URL`）。它导出 AMSP 的全部类型，服务端以类型引用它——协议的类型只有这一份。

- `new AgentClient({ baseUrl, agent, apiKey?, fetch?, headers? })`：不给 `apiKey` 即无密钥访问；不隐式读取任何环境变量。
- `stream({ input, sessionId?, signal?, onApproval? })` 返回一次运行：可以 `for await` 逐个读事件；`session` 在 `run.started` 时兑现；`result()` 汇总为 `{ status, error?, sessionId, text, items, usage, sessionUsage, requests }`——`text` 为主会话 assistant `text.done` 以空行连接，`items` 为全部 `.done` 条目与非条目事件（流式产出的压缩摘要没有 `.done`，因此不在其中，也不由片段重建）；`abort()` 走中止路由。
- `run(opts)` 即运行并等 `result()`；另有 `agent()`、`session(id)`、`abort(id)`、`approve(id, toolCallId, decision)`、`parseArguments(toolCall)`（解析失败返回 null）与 `readSse(body)`。
- 行为：`[DONE]` 结束迭代；注释行与非 `data:` 字段忽略，多行 `data:` 以换行连接；流开始之前的非 200 抛 `AmspHttpError { status, code, message }`；没有 `run.done` 就结束的流抛 `AmspStreamError`；未知事件类型原样交出；即使调用方只等 `result()`，`onApproval` 也会被等待并代为 POST，回调抛错即答 `deny`，没有回调同样答 `deny`；`signal` 中止即取消读取，以 fetch 的 `AbortError` 拒绝。
- 随 release workflow 发布到 npm（trusted publishing）；包名首次发布由维护者手工完成一次，之后才能配置 trusted publisher。

### 兼容性

磁盘上没有存量数据改变形态：两张新表以 `CREATE TABLE IF NOT EXISTS` 建立；`sessions.client` 是自由文本列，新值 `api` 不需要迁移；`server_settings` 缺行即缺省值。`session_meta.source` 的必填化与旧 Trace 的读取容忍由会话来源的改动承担，本提案不另加兼容代码。

## Drawbacks
[drawbacks]: #drawbacks

- **无密钥访问。** 开着它，任何能访问这个地址的程序都能与该 Agent 对话、花 Project 的模型额度、在沙盒允许的范围内执行命令。缓解只到这几层：逐 Agent 开启、缺省关、界面警示「仅建议本机使用」、无密钥请求不带 CORS 头。服务端监听在非回环地址时，它就是一个公开端点。
- **一次运行一条连接。** 运行与 HTTP 连接同生共死：长任务要一直连着，中间的代理要容忍长连接（keep-alive 注释只防空闲超时）；断开即中止，v1 没有事件 id，不能续传，也不能分离。
- **缺省 `allow-all`。** 持有密钥的程序在沙盒之内不受逐条审批。这是有意的取舍（见「审批」），代价是 owner 必须明白「开启 API」的分量。
- **两条轴。** 一个 Session 是不是 API 会话由 `client` 与 `source` 各记一次，前者供服务端的闸门、后者供侧栏；两者在这里恰好一致，但代码要知道该读哪一个。
- **`tool_call` 的参数是字符串。** 与 MMSP 把参数解析成对象不同，调用方要自己解析（SDK 提供 `parseArguments`）。
- **并发上限是代码常量**，部署方不能调整。

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

- **复用 `/api/sessions`，加有作用域的 token。** 看似改动最少，但内部线路就此成了公开契约：`partial_*` 的 start / stop、`resync_required`、服务端事件的种类，任何一处内部调整都变成破坏性变更；还要为每一条内部路由补上 token 作用域的审计，漏一条就是越权。单独的投影让内部流继续自由演进，对外契约只受 `/v1` 规则约束。
- **WebSocket。** 双向，审批与中止可以走同一条连接。但 MMSP 用的是 SSE，curl、反向代理、浏览器与 Node 的 `fetch` 流式读取都能直接用；审批与中止各一条 POST 也足够简单。留作将来的另一种传输。
- **后台作业（`202` 后轮询或稍后取流）。** 断开不等于中止，长任务不必挂着连接。但它是另一种产品——结果要存、要过期、要列出——还需要事件 id 与续传。v1 取最简单的「一次请求一次运行」，作业留待需求出现。
- **开关存进 Agent State 或 `.project_config.toml`。** 前者让 Agent 能开启自己的暴露、放宽自己的审批；后者在公司模式下跨服务器同步，一台服务器上的开关会出现在另一台上。因此存 web.db。
- **审批缺省 `always-ask` 或 `read-only`。** 更保守，但 API 调用方多半不实现审批回调，缺省询问会让第一次试用的每条命令都被拒；`read-only` 一键可选。
- **每次运行重读 Agent 级的审批模式。** 能让 API 标签的改动立刻作用于全部 API 会话，代价是盖掉人对单个会话的修改。
- **忙时排队**（消息桥的 `queueIfBusy`）。消息桥能排队，是因为回复经聊天送回；API 的回复只有这一条流，排队的运行无处作答。
- **把 `tool_call` 的参数解析成对象。** 要么在服务端解析，解析失败时又需要另一种形态；要么由片段重建，那就违反了「片段即完整调用、从不对账」。保持原样的字符串最简单，解析交给 SDK。
- **什么都不做。** 外部程序只能拿本机 API token 调内部 API——admin 权限，加上一套不稳定的线路。

## Prior art
[prior-art]: #prior-art

- **MMSP 服务端**（agenthub）：线路纪律的原型——条目以 `.done` 收束、恰好一个终止事件、`: keep-alive`、错误信封与状态表、用量在结尾读、没有配置密钥即开放并在启动时说明。AMSP 照搬这些，把单位从一次调用放大到一次运行。
- **OpenAI Responses API 的流式输出**：以 `type` 区分的扁平 SSE 事件，`<主体>.<阶段>` 式的事件名（如 `response.output_text.delta` / `.done`），以及一个汇总的完成事件。AMSP 的命名与之同形。
- **Anthropic 的 Agent SDK**：把 Agent 循环（多次模型调用与工具执行）作为一条消息流交给调用方，并以回调决定工具权限。`onApproval` 是同一想法，只是循环跑在服务端，回调经 HTTP 往返。
- **本仓库**：消息桥是最近的先例——订阅 Session 通道、以 `task_state` 判定运行边界、以 `approval_request` 接审批、以 `startTask` 启动工作，本提案用的正是这几条接缝。浏览器扩展的配对 token 只存 SHA-256、可撤销；`companyMode` 与 `browserExtensionsEnabled` 是 `server_settings` 里整站开关的先例。

## Unresolved questions
[unresolved-questions]: #unresolved-questions

没有待定的问题。初稿留下的四个问题已于 2026-10-07 由用户决定，全文按此书写：

1. **无密钥访问**：允许，逐 Agent 的「允许无密钥访问」开关，缺省关，附警示；CORS 规则不变（无密钥请求不带 `Access-Control-Allow-Origin`）。
2. **审批**：每个 Agent 一个 API 审批模式，四种模式可选，缺省 `allow-all`，存于 web.db、Agent 改不了；只在新建 Session 时读取一次。需要询问时审批请求流给调用方，Web App 同样可以作答。沙盒照常取服务端的缺省，Project 新对话默认值里的审批模式不作用于 API 会话。
3. **会话来源**：不另设 `client: "api"` 的侧栏标记，改为 `session_meta.source` 必填、API 会话写 `api`；侧栏把 API / 定时任务 / 子智能体 / CLI 会话归入同一个「后台会话」子夹。这部分由会话来源的设计改动单独承载。
4. **SDK 包名**：`@prismshadow/amsp`，目录 `packages/amsp`，类名 `AgentClient`。

## Future possibilities
[future-possibilities]: #future-possibilities

后台作业式的运行（`202` 后轮询或稍后取流）；经 API 上传文件；按密钥的速率限制与过期；Python 客户端；`GET /sessions/:id/messages` 以 AMSP 的 `.done` 条目返回历史；运行中途的 steering；WebSocket 传输；为 API 会话单独设定沙盒的 Agent 级覆盖。

## Changes

### v1.0.0

- 新增：迁入主仓；正文取设计仓的同一版本，与英文版逐节对应。

### v1.1.0

- 更新：Guide-level explanation 的示例与「SDK」一节改用 0.2.16 发布的两个 SDK 入口（impl [#1111](https://github.com/Prism-Shadow/penguin-harness/pull/1111)）：原先返回可迭代运行的 `run()` 改称 `stream()`，原先运行并等结果的 `ask()` 改称 `run()`。设计仓以一条 Status 补记记下同一改动（design [#376](https://github.com/Prism-Shadow/penguin-harness-design/pull/376)）。
