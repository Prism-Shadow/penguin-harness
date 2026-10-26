---
title: Agent API
description: 让外部程序经 HTTP 与某个 Agent 对话：开启 Agent 的 API、签发密钥，再用 curl 或 @prismshadow/amsp 客户端运行它。
---

Agent API 让 PenguinHarness 之外的程序（脚本、服务、浏览器里的页面）经 HTTP 与某一个 Agent 对话。程序发送输入，以 [AMSP](/amsp) 流实时读取这次运行在会话中写下的记录，再凭 Session id 延续对话。运行使用 Project 的模型与凭据，像其他对话一样被记录，并按规则归档：它列在[设置 › 已归档对话](/settings#已归档对话)中，在那里取消归档后会留在侧边栏。

从哪里开始：

- 想对外开放某个 Agent，见[开启 Agent 的 API](#开启-agent-的-api)。
- 想在 shell 里试一试，见[用 curl 调用](#用-curl-调用)。
- 想在 TypeScript 里调用（Node 或浏览器），见 [amsp 客户端](#amsp-客户端)。
- 想逐条了解流里的记录，见 [AMSP](/amsp)。

## 开始之前

- 只有 Project 的所有者能开启或关闭 Agent 的 API、选择审批模式、管理密钥；成员可以查看这些设置。
- 服务器管理员可以整体关闭 Agent API，缺省为开启。见[管理员开关](#管理员开关)。
- 程序需要三样东西，都显示在该 Agent 的 **API** 标签页上：
  - **Base URL**：服务器地址加上 `/api/amsp/v1`，本机服务器即 `http://localhost:7364/api/amsp/v1`。服务器监听本机回环地址时（这是缺省设置），地址要写 `localhost`：`127.0.0.1` 是它提供预览的地址，在那里的所有 API 请求都以 `401` 拒绝；
  - **Agent ID**：`<projectId>/<agentId>`，例如 `demo/coder`；
  - **密钥**：除非该 Agent 允许[无密钥访问](#无密钥访问)。

## 开启 Agent 的 API

1. 打开该 Agent 的设置（见 [Agent 设置](/agents#agent-设置)），选择 **API** 标签页，地址为 `/agents/<agentId>?tab=api`。
2. 打开**开启 API 访问**。
3. 在**新会话设置**中选择模型、思考等级和工作区。选择后立即保存，只影响之后新建的 API 会话。留空分别使用 Project 默认模型、Agent／Project 的思考等级配置和临时工作区。在下方选择 **API 会话的审批模式**，见[审批模式](#审批模式)。
4. 在**运行设置**中填写正整数的**最大并发数**，然后点击**保存**。默认值为 4。
5. 在**密钥**下选择**新建密钥**，起个名字，然后复制密钥。密钥只显示这一次。
6. 在**连接**下复制 **Base URL** 和 **Agent ID**。**示例**里有一条 curl 命令和一段 TypeScript 代码，两者都已填好，密钥处写作 `$PENGUIN_AGENT_KEY`。

在**智能体**页面上，已开启 API 的 Agent 名称后带有 API 图标，悬停提示为**已开启 API 访问**。

关闭**开启 API 访问**后，该 Agent 的所有请求立即以 `404` `agent_not_found` 拒绝。它的密钥和设置都会保留，等重新开启时继续使用。

这些设置由服务器保存，不在 Agent 的状态里，因此 Agent 既不能自行对外开放，也不能放宽自己的审批模式。

修改这些设置还需要人的登录。Agent 运行的命令带着服务器的本地 API token：它能读取这些设置，但每一项修改和**试一试**都以 `403` `human_required` 拒绝它，[管理员开关](#管理员开关)也一样。这收窄了 Agent 在自己的 shell 里能做的事，但不是边界：在沙盒之外、以服务器所属操作系统账号运行的进程仍能自行登录，真正约束 Agent 的是它的[沙盒](/settings#沙盒)。

### 审批模式

API 会话有自己的审批模式，与新建对话时预选的审批模式互不相干：

| 模式 | 选择器中的名称 | 调用方看到的情形 |
| --- | --- | --- |
| `allow-all`（缺省） | **全部放行** | 所有工具调用直接执行，不等调用方 |
| `read-only` | **放行只读** | 只读工具直接执行；其余调用等待调用方回答 |
| `always-ask` | **总是询问** | 每次工具调用都等调用方回答 |
| `deny-all` | **全部拒绝** | 所有工具调用都被拒绝；模型读到拒绝结果，在没有该工具的情况下继续 |

- 审批模式在 API 会话创建时读取，此后随该会话保存。在标签页上修改，只影响之后新建的 API 会话。要修改某个已有会话，先取消归档，再在 Web App 中打开它，在那里修改它的审批模式。
- 等待审批的调用列在该会话的待决审批资源 `GET /sessions/:sessionId/approvals` 中；你取消归档该会话后，它也会显示在 Web App 的该会话中，以先回答的一方为准。每次调用的决定随后以 `approval_decision` 记录出现在流上。运行没有等待时限：直到有人回答、运行被中止，或运行流的调用方断开连接（此时视为拒绝）。
- 缺省为 `allow-all`，是因为沙箱已经限定了 Agent 能做的事，而程序通常没有人可问。如果程序会回答审批，就选 `read-only` 或 `always-ask`，见[审批](#审批)。

API 会话的沙箱取自服务器的新对话默认值，与其他新对话相同。Project 为新对话预选的审批模式不适用于 API 会话。

示例上方的两个按钮分别打开本文档和复制给编程 Agent 的提示词。提示词包含当前 Base URL 和 Agent ID，并说明从 `PENGUIN_AGENT_KEY` 读取密钥。

### 密钥

- 密钥形如 `penguin_` 加 43 个字符，只在创建时显示一次；服务器只保存它的 SHA-256。
- 一个 Agent 可以有多个密钥，各有名字。列表显示每个密钥的名字、开头几个字符、创建时间和最近使用时间（首次运行之前显示**从未**）。
- 删除密钥即撤销它：此后出示它的请求以 `401` 拒绝。
- 密钥只属于一个 Agent：它能运行该 Agent，能读取、跟随、中止该 Agent 的 API 会话并回答其审批，此外不能访问服务器上的任何东西。出示另一个 Agent 的密钥会以 `404` `agent_not_found` 拒绝。
- 以 `Authorization: Bearer <key>` 发送。

### 无密钥访问

**允许无密钥访问**让不带密钥的请求也能运行该 Agent。它缺省关闭；开启后，带了密钥的请求仍会校验密钥。打开此开关前会先弹出确认，提示下面的风险；`penguin agent api enable --open` 与 `set --open` 开启后也会在 stderr 打印同样的警告。

> [!WARNING]
> 开启无密钥访问后，任何能访问服务器地址的程序都能与该 Agent 对话，用的是 Project 的模型和凭据。只在服务器只监听本机回环地址（`127.0.0.1`）时开启。

其他来源的浏览器页面无法使用无密钥访问：服务器不会给不带 `Authorization` 的请求返回 CORS 头。见[在浏览器中](#在浏览器中)。

### 试一试

**API** 标签页的末尾为 Project 所有者提供**试一试**：输入框预填「现在几点了？」，旁边是**运行**。**运行**经 `POST /api/projects/:projectId/agents/:agentId/api/try` 发起一次真实的 API 运行，以你的登录身份代替密钥，背后是同一个处理器，并在一个输出框里按程序会收到的样子显示这条流。输出框的标题栏显示这次运行的 `session_id`，并可在两种视图间切换：**渲染**，每条记录一行并编号，同一条消息的分片合并为拼好的内容（回答、工具调用及其参数、工具的输出）；**原始**，每个事件一行并编号，与收到的完全一致。下方一栏给出从记录读出的运行状态，以及 Request 次数、Token 和用时。默认 Agent 只有执行 `date` 才能知道时间，所以这个示例里能看到一次工具调用和它的结果。再次运行即续接这个会话，正如程序传入 `session_id`；**新会话**另起一个。**停止**经会话的中止路由中止运行，流照样以 `[DONE]` 结束；审批模式需要询问时，等待中的那次调用上会出现**允许**和**拒绝**。开出的会话就是普通的 API 会话，与其他 API 会话一样被归档。管理员关闭 Agent API 期间，**运行**不可用。

## 用 curl 调用

```bash
curl -N http://localhost:7364/api/amsp/v1/agents/demo/coder/runs \
  -H "Authorization: Bearer $PENGUIN_AGENT_KEY" -H "Content-Type: application/json" \
  -d '{"input":"Summarize README.md"}'
```

响应就是这次运行，实时流式返回。`-N` 关闭 curl 的缓冲，事件到达即打印。流以一个 `ping` 开头，随后是会话的记录，各带一个 `id:`，从 `task_begin` 到 `task_end`；`data: [DONE]` 结束这条流。新会话的第一条记录是它的 `session_meta`，其中的 `session_id` 即这个会话的 id：

```text
event: ping
data: {}

id: 7c41d0a2-1
data: {"timestamp":"…","type":"session_meta","payload":{"session_id":"session-2026-10-23-10-00-00-3f9a1c2e","provider":"…","model_id":"…",…,"source":"api"}}

id: 7c41d0a2-2
data: {"timestamp":"…","type":"event_msg","payload":{"type":"task_begin"}}

id: 7c41d0a2-4
data: {"timestamp":"…","type":"model_msg","payload":{"type":"text","role":"user","text":"Summarize README.md"}}

…

id: 7c41d0a2-9
data: {"timestamp":"…","type":"model_msg","payload":{"type":"partial_text","role":"assistant","event_type":"delta","text":"README.md describes"}}

…

id: 7c41d0a2-31
data: {"timestamp":"…","type":"event_msg","payload":{"type":"task_end"}}

data: [DONE]
```

`session_meta` 只在会话的第一条消息上出现。运行的情况从它的记录读出，见[运行的结果](/amsp#运行的结果)。

要延续对话，把这个 Session id 和下一条输入一起发送：

```bash
curl -N http://localhost:7364/api/amsp/v1/agents/demo/coder/runs \
  -H "Authorization: Bearer $PENGUIN_AGENT_KEY" -H "Content-Type: application/json" \
  -d '{"session_id":"session-2026-10-23-10-00-00-3f9a1c2e","input":"Now list its headings"}'
```

## 路由

所有路径都相对于 Base URL。其下不匹配任何路由的路径，以 JSON 形式返回 `404` `not_found`。

| 方法 | 路径 | 响应 |
| --- | --- | --- |
| GET | `/agents/:projectId/:agentId` | `{agent: {id, name?, description?}}` |
| POST | `/agents/:projectId/:agentId/runs` | 以流返回这次运行，见[运行流](/amsp#运行流) |
| GET | `/sessions/:sessionId` | `{session: {id, agent, status, provider, model_id, created_at, last_active_at}}`，`status` 为 `idle`、`running` 或 `compacting` |
| GET | `/sessions/:sessionId/stream` | 会话的记录，在写入时跨运行推送，见 [Session 流](/amsp#session-流) |
| GET | `/sessions/:sessionId/messages` | 历史，全量或按 Task 分窗，见[历史](/amsp#历史) |
| GET | `/sessions/:sessionId/trace-image` | 历史页引用的一张图片 |
| GET | `/sessions/:sessionId/approvals` | `{approvals: [{tool_call, origin?}]}`，即等待回答的调用；带 `?wait=<1–60>` 时挂起，直到有调用进入等待。见[审批](/amsp#审批) |
| POST | `/sessions/:sessionId/tasks` | `{input}` → `202` `{session_id}`：不占用连接的一次运行 |
| POST | `/sessions/:sessionId/abort` | 中断了运行时返回 `202`，没有运行时返回 `204` |
| POST | `/sessions/:sessionId/approvals/:toolCallId` | `{decision: "allow" \| "deny"}`；返回 `204`，已被回答时返回 `404` `approval_not_found` |

每条 `/sessions/:sessionId` 路由只对密钥所属 Agent 的 API 会话作答，其他 id 一律返回 `404` `session_not_found`。

API 标签页和 `penguin agent api` 以 Project 所有者的身份，经 `/api/projects/:projectId/agents/:agentId/api` 及其 `keys` 路由管理这些设置，见 [Server API](/server-api)。

### 运行请求

```ts
interface RunRequest {
  session_id?: string;        // continue this conversation; omit to start one
  input: string | InputItem[];
}
type InputItem =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: string }; // a data: URL, or an http(s) URL
```

- `input` 至少要有一段非空文本或一张图片。
- 图片可以是图片类型的 `data:` URL，大小不超过 20 MB 的内联图片上限和服务器的附件总量上限；也可以是 `http(s)` URL，原样交给模型。不接受文件。
- 不带 `session_id` 时，运行开启一个新会话，由流的第一条记录 `session_meta` 给出其 id。带上它，运行就延续那个会话；它必须是同一个 Agent 的 API 会话，其他 id 一律返回 `404` `session_not_found`。

### 不占用连接的运行

`runs` 把运行与连接绑在一起：一次请求一次运行，关闭连接即中止运行，适合脚本或评测框架。需要长期跟随一个会话的程序，可以先连接、后运行：

1. 打开会话的流 `GET /sessions/:sessionId/stream`。
2. 以 `{"input": …}` 发送 `POST /sessions/:sessionId/tasks`，`input` 与运行请求相同。它返回 `202` 和 `{"session_id"}`，这次运行的记录随即出现在流上，从 `task_begin` 到 `task_end`。

- 这次运行不属于任何连接：关闭流不会中止它，`POST /sessions/:sessionId/abort` 才会。
- `tasks` 延续已有的 API 会话；新会话要用 `runs` 开启。这里不提供 goal 模式。
- 会话正忙时返回 `409`，输入不会排队。该 Agent 的并发上限与 `runs` 相同。
- 审批模式需要询问时，没有人替你回答：如果没有人经待决审批资源或 Web App 作答，运行会一直等下去。

### 会话

- 新的 API 会话使用 Agent API 标签页中选择的模型、思考等级、工作区和审批模式，以及服务器的新对话沙箱。标题由第一条输入生成，用量和费用计入 Project，与其他会话相同。
- API 会话按规则归档，所以列在[设置 › 已归档对话](/settings#已归档对话)中，而不在侧边栏。取消归档后就可以阅读它、回答其审批，也可以在其中输入；此后它再运行也会留在侧边栏，并带 API 图标。程序可以延续已归档的会话，会话仍保持已归档。
- 一个会话同一时间只做一件事：会话仍在工作时发起的运行以 `409` 拒绝，不会排队。所有者可在 API 标签页的**运行设置**中设置**最大并发数**（正整数，默认 4）。正在运行的对话（包括 Web App 中发起的）和正在启动的 API 对话都计入上限。达到上限时，在新对话或空闲对话上发起的 API 运行返回 `429` 和 `Retry-After: 2`，不会额外创建对话。保存后的上限用于后续请求，不中断正在运行的对话。
- 断开运行流的连接即中止运行。要停止运行、同时仍能收到它的结局，就 `POST /sessions/:sessionId/abort`：流保持打开，记录以 `abort` 和 `task_end` 结束，流以 `[DONE]` 结束。

### 错误

在流开始之前被拒绝的请求，得到一个 HTTP 状态码和统一的信封 `{"error": {"code": "<code>", "message": "<text>"}}`：

| 状态码 | `code` | 场景 |
| --- | --- | --- |
| 400 | `bad_request` | 请求体不是 JSON 对象；`input` 缺失或为空；某项的 `type` 未知；`session_id` 不是合法 id；图片过大或不是图片；`decision` 不是 `allow` 或 `deny`；`wait` 不是整数；历史分页参数格式有误 |
| 401 | `unauthorized` | 该 Agent 需要密钥，而请求没有出示或出示了未知的密钥。在读取请求体之前检查 |
| 403 | `agent_api_disabled` | 管理员关闭了 Agent API |
| 404 | `agent_not_found` | 没有这个 Agent、它的 API 未开启，或密钥属于另一个 Agent |
| 404 | `session_not_found` | 没有这个 Session、它不是 API 会话，或它属于另一个 Agent |
| 404 | `approval_not_found` | 该审批已被回答，或从未存在 |
| 404 | `not_found` | 该路径没有路由 |
| 409 | `task_in_progress`、`compacting` | 会话正忙 |
| 409 | `resync_required` | Session 流的 `Last-Event-ID`（或 `lastEventId`）已不在服务器的缓冲中；读取历史，再不带它订阅 |
| 413 | `payload_too_large` | 请求体超过服务器的大小上限 |
| 415 | `unsupported_media_type` | 写请求没有带 `Content-Type: application/json` |
| 429 | `too_many_runs` | 该 Agent 已达到设置的并发上限；等 `Retry-After` 秒后重试 |
| 503 | 以服务器返回为准 | 服务器正在关闭，或该 Agent、会话正在被删除 |

流一旦开始，错误就不会以单独的帧出现：记录说明发生了什么，服务器未能完成的运行会在 `[DONE]` 之前留下最后一个未闭合的 `task_begin`。见[运行的结果](/amsp#运行的结果)和[错误](/amsp#错误)中的错误码。

## amsp 客户端

`@prismshadow/amsp` 是 Agent API 的 TypeScript 客户端，也是定义 AMSP 的包：记录及其判别函数与构造函数、控制帧，以及围绕它们的请求与响应；消息标记在 `@prismshadow/amsp/markers` 中。它没有任何依赖，可在 Node 24 和当前的浏览器中运行。

这个包的版本号与 PenguinHarness 一致。0.2.16 之后的版本读取 [AMSP](/amsp) 页描述的流，读不懂 0.2.16 及更早的服务器的事件；0.2.16 及更早的客户端也读不懂这条流。允许 `^0.2.16` 的安装在下一次安装或更新时会取到新的客户端，见[升级旧客户端](#升级旧客户端)。

```bash
npm install @prismshadow/amsp
```

```ts
import { AgentClient, isModelMessage } from "@prismshadow/amsp";

const client = new AgentClient({
  baseUrl: "http://localhost:7364/api/amsp/v1",
  agent: "demo/coder",
  apiKey: process.env.PENGUIN_AGENT_KEY,
});

const run = client.stream({ input: "Summarize README.md" });
for await (const record of run) {
  // Records without `origin` are the main conversation's; a subagent's carry one.
  if (record.origin || !isModelMessage(record)) continue;
  if (record.payload.type === "partial_text") process.stdout.write(record.payload.text);
}
const first = await run.result();

const second = await client.run({
  sessionId: first.sessionId,
  input: "Now list its headings",
  onApproval: () => "allow",
});
console.log(second.text, second.usage.total);
```

- `client.stream()` 立即开始运行并返回它。迭代它即可按到达顺序取得记录，只能迭代一次；记录在被读取之前一直保留。运行开始后，`run.session` 以 Session id 兑现：延续会话时即传入的 `sessionId`，流一打开就兑现；新会话则在流的第一条记录 `session_meta` 到达时兑现。
- 流读到 `[DONE]` 时 `run.result()` 兑现，内容为 `status`、`error`、`sessionId`、`text`、`usage`、`sessionUsage` 和 `requests`，各项如何从记录读出见[运行的结果](/amsp#运行的结果)。`text` 是主会话中助手的回答，以空行连接；子 Agent 的文本、用户消息和压缩摘要都不计入。
- `client.run()` 运行到结束并返回同样的结果，不为迭代保留任何记录。
- 提前退出循环只停止迭代，不停止运行：审批照常回答，`result()` 照常兑现。要停止运行，见[中止](#中止)。
- 客户端不认识 `payload.type` 的记录会照常传出，所以对它分支时要留一个缺省分支。
- `client.agent()`、`client.session(sessionId)` 和 `client.messages(sessionId, page?)` 分别读取 Agent、会话的状态与模型，以及会话的历史。

### 审批

当审批模式让某次调用等待时，客户端替你回答，无论你是在迭代还是只等待结果。只要流上有已完成、尚无 `approval_decision` 的 `tool_call`，客户端就保持一个对 `GET …/sessions/:sessionId/approvals?wait=30` 的请求，把它返回的每次调用交给 `onApproval` 一次，再提交回答。没有回调或回调抛出异常时，回答 `deny`。每次调用都有了决定或运行结束时，它即停止。

```ts
import { parseArguments } from "@prismshadow/amsp";

const result = await client.run({
  input: "Clean up the build output",
  onApproval: (toolCall, origin) => {
    const args = parseArguments(toolCall);
    return !origin && toolCall.name === "exec_command" && args?.cmd === "ls" ? "allow" : "deny";
  },
});
```

- `onApproval(toolCall, origin, { sessionId })` 收到 `tool_call` 记录的载荷、子 Agent 调用所经的子 Session 链（主会话的调用为 `undefined`），以及这次运行的 Session id。
- 记录把工具调用的参数作为 JSON 字符串传送，`parseArguments` 把它转成对象：没有参数时为 `{}`，解析不成对象时为 `null`。
- 已经有人在 Web App 里回答过的审批不算错误。服务器因其他原因拒绝接受的回答（例如运行途中密钥被删除）会以那个 `AmspHttpError` 结束运行，并断开连接，让服务器中止运行，而不是一直等下去。
- 自行读取流的程序可以用 `client.approvals(sessionId, wait?)` 和 `client.approve(sessionId, toolCallId, decision)` 手动列出和回答。

### 中止

- 中止传给 `stream()` 或 `run()` 的 `signal` 会断开连接：服务器中止运行，运行以该 signal 的 reason（缺省为 `AbortError`）拒绝。尚未读取的记录被丢弃。
- `run.abort()` 请服务器中止运行，并保持连接：记录以 `abort` 和 `task_end` 结束，流以 `[DONE]` 结束，`result()` 以 `status: "aborted"` 兑现。
- `client.abort(sessionId)` 按 id 对某个会话做同样的事，并返回是否中断了运行。

### 运行失败时

- 只要流读到了 `[DONE]`，无论 `status` 如何，`result()` 都会兑现；请检查 `status` 和 `error`。服务器未能完成的运行以 `fatal` 兑现，错误码为 `internal`。
- 流开始之前的拒绝以 `AmspHttpError` 拒绝，带有信封中的 `status`、`code` 和 `message`。响应体不是信封时，`code` 为 `http_error`，message 包含状态码和响应体的开头部分。
- 流在 `[DONE]` 之前结束或中断，或带有不是外壳的记录时，以 `AmspStreamError` 拒绝：运行的结局未知，`client.session(sessionId)` 可以告诉你它是否仍在运行。
- 网络故障和中止按 `fetch` 抛出的原样拒绝。

### 跟随会话

`SessionReader` 把一个会话的历史与实时记录作为一个有序序列来跟随。它订阅 Session 流，读取历史中最新的若干 Task，接上 `live` 尾部，跳过历史已经交付的记录；收到过 `ping` 的流 50 秒没有动静时，带着 `Last-Event-ID` 重新连接；重连被以 `409` `resync_required` 拒绝时，先发出 `reset`，再像第一次打开那样从头开始。无论运行由谁发起，它都能看到。

```ts
import { HttpTransport, SessionReader } from "@prismshadow/amsp";

const transport = new HttpTransport({
  baseUrl: "http://localhost:7364/api/amsp/v1",
  apiKey: process.env.PENGUIN_AGENT_KEY,
});
const reader = new SessionReader(transport, sessionId);
reader.on("event", ({ record, source }) => render(record, source));
reader.on("reset", () => clearView()); // what was delivered is void; the history follows again
reader.on("error", (err) => console.error(err)); // refused for good, such as a 404; the reader has stopped
```

- `event` 的内容是 `{record, id, source}`：`source` 为 `history` 或 `live`，`id` 是流的事件 id，历史记录为 `null`。
- 选项：`tailLimit`，打开和每次 resync 时读取的 Task 数（默认 20）；`streamPath`；`watchdogMs`（默认 50 000）；`reconnectMs`（默认 1 000）。
- `reader.close()` 停止跟随。

### 在浏览器中

同一个包经打包工具即可在浏览器中使用；包里另带一个无需解析依赖的 ES 模块 `@prismshadow/amsp/browser`（`dist/browser/amsp.js`），供按 URL 引入的页面使用；要把它提供给自己页面的服务端，可以从 `@prismshadow/amsp/browser-source` 取得同样字节的字符串 `BROWSER_SOURCE`。与服务器不同源的页面必须使用密钥：服务器对任何来源都应答 CORS 预检，但只在带 `Authorization` 的请求上返回 `Access-Control-Allow-Origin: *`。跨源请求只能携带 `Authorization` 和 `Content-Type`，所以额外的 `headers` 只适用于同源页面和 Node。

```ts
import { AgentClient, isModelMessage } from "@prismshadow/amsp";

const keyField = document.querySelector<HTMLInputElement>("#key")!;
const client = new AgentClient({
  baseUrl: "http://localhost:7364/api/amsp/v1",
  agent: "demo/coder",
  apiKey: keyField.value,
});

const answer = document.querySelector("#answer")!;
for await (const record of client.stream({ input: "What changed today?" })) {
  if (record.origin || !isModelMessage(record)) continue;
  if (record.payload.type === "partial_text") answer.textContent += record.payload.text;
}
```

与服务器同源的页面也可以改用用户的登录身份，经 Cookie 门读取会话：

```ts
const transport = new HttpTransport({ baseUrl: "/api", credentials: "same-origin" });
const reader = new SessionReader(transport, sessionId, {
  streamPath: `/sessions/${encodeURIComponent(sessionId)}/amsp`,
});
```

工作台页面不必自己拼装这些：引入服务端为每个工作台提供的 `../sdk/workbench.js`，调用 `followSession(sessionId)` 即可。这个模块重新导出应答该工作台的服务端所带的浏览器构建，`apiBase` 与 `transport` 已按它的 Cookie 门设好，工作台在其他机器上或位于反向代理前缀之下时同样适用；另外还提供 `abortSession(sessionId)`。见 [Workbench 插件](/skills#workbench-插件)。

> [!WARNING]
> 写在页面里的密钥，任何打开该页面的人都能读到。浏览器客户端只适合你和团队自用的工具，并在运行时输入密钥；否则就把密钥放在后端，由后端替页面调用 Agent。

### 客户端参考

```ts
class AgentClient {
  constructor(opts: {
    agent: string;                     // "<projectId>/<agentId>"
    baseUrl?: string;                  // ".../api/amsp/v1"; required without `transport`
    apiKey?: string;                   // omitted = keyless; no environment variable is read
    credentials?: RequestCredentials;  // passed to fetch, for the cookie door
    fetch?: typeof fetch;              // the global fetch by default
    headers?: Record<string, string>;
    transport?: Transport;             // in place of the HTTP transport the options above build
  });
  stream(opts: RunOptions): Run;
  run(opts: RunOptions): Promise<RunResult>;
  agent(): Promise<AgentInfo>;
  session(sessionId: string): Promise<SessionInfo>;
  messages(sessionId: string, page?: { tailLimit: number } | { before: string; limit?: number }): Promise<MessagesResponse>;
  approvals(sessionId: string, wait?: number): Promise<PendingApproval[]>;
  abort(sessionId: string): Promise<boolean>;
  approve(sessionId: string, toolCallId: string, decision: "allow" | "deny"): Promise<void>;
}

interface RunOptions {
  input: string | InputItem[];
  sessionId?: string;
  signal?: AbortSignal;
  onApproval?: (
    toolCall: ToolCallPayload,
    origin: string[] | undefined,
    ctx: { sessionId: string },
  ) => "allow" | "deny" | Promise<"allow" | "deny">;
}

interface Run extends AsyncIterable<AmspRecord> {
  readonly session: Promise<string>;
  result(): Promise<RunResult>;
  abort(): Promise<void>;
}

interface RunResult {
  status: "completed" | "aborted" | "retryable" | "fatal";
  error?: { code: string; message: string };
  sessionId: string;
  text: string;
  usage: TokenCounts;
  sessionUsage: TokenCounts | null;
  requests: number;
}

class SessionReader {
  constructor(transport: Transport, sessionId: string, opts?: {
    tailLimit?: number; streamPath?: string; watchdogMs?: number; reconnectMs?: number;
  });
  on(type: "event", listener: (e: { record: AmspRecord; id: string | null; source: "history" | "live" }) => void): () => void;
  on(type: "reset", listener: () => void): () => void;
  on(type: "error", listener: (error: unknown) => void): () => void;
  close(): void;
}

interface Transport {
  stream(path: string, req: StreamRequest): Promise<"done" | "closed">;
  get<T>(path: string, opts?: { signal?: AbortSignal }): Promise<{ status: number; body: T | null }>;
  post<T>(path: string, body?: unknown, opts?: { signal?: AbortSignal }): Promise<{ status: number; body: T | null }>;
}
class HttpTransport implements Transport {
  constructor(opts: { baseUrl: string; apiKey?: string; credentials?: RequestCredentials; fetch?: typeof fetch; headers?: Record<string, string> });
}

function readSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<{ event: string | null; id: string | null; data: string }>;
function frameOf(event: { event: string | null; id: string | null; data: string }): AmspFrame;
function readAmsp(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<AmspFrame>;
type AmspFrame =
  | { kind: "record"; id: string | null; record: AmspRecord }
  | { kind: "control"; control: AmspControl }   // ping
  | { kind: "done" }                            // data: [DONE]
  | { kind: "other"; name: string; data: string };
class RunCollector {
  constructor(opts?: { sessionId?: string }); // the Session the run continued
  readonly sessionId: string | null;          // that Session, or a new one's from its session_meta
  add(record: AmspRecord): void;
  result(): RunResult;          // throws AmspStreamError when nothing named the Session
}
function parseArguments(call: { arguments: string }): Record<string, unknown> | null;
class AmspHttpError extends Error { status: number; code: string }
class AmspStreamError extends Error {}
```

`readAmsp` 和 `RunCollector` 供自行发送请求（自己的 `fetch`、凭据或 URL）的程序使用，得到与 `result()` 相同的结果：

```ts
import { readAmsp, RunCollector } from "@prismshadow/amsp";

// sessionId: the session_id the request sent, if any; a new Session is named by its session_meta.
const collector = new RunCollector({ sessionId });
let done = false;
for await (const frame of readAmsp(response.body!)) {
  if (frame.kind === "done") { done = true; break; }
  if (frame.kind === "record") collector.add(frame.record);
}
if (!done) throw new Error("The stream ended before [DONE]: the connection broke.");
const result = collector.result();
```

有自己通道的宿主可以实现 `Transport`；自行读取 SSE 响应体时，`deliver(frames, handlers)` 把流的帧逐个交给对应的处理函数。

### 升级旧客户端

按 0.2.16 及更早的客户端编写的程序，按下表修改。程序改完之前，可固定 `@prismshadow/amsp@0.2.16`，让旧客户端继续对接旧服务器。

| 0.2.16 及更早 | 0.2.16 之后 |
| --- | --- |
| `onApproval(request, ctx)`，读取 `request.tool_call` | `onApproval(toolCall, origin, ctx)` |
| 事件：`run.started`、`text.delta`、`run.done` 等 | 记录与控制帧，见[从 v1 旧事件到记录](/amsp#从-v1-旧事件到记录) |
| `RunResult.items` | 已移除：迭代这次运行，或读取历史 |
| `readSse` 逐个产出事件的数据 | `readSse` 产出 `{event, id, data}`；`readAmsp` 产出帧 |
| `RunCollector.add(event)`、`finished` | 延续会话时 `new RunCollector({ sessionId })`，再 `add(record)`；以 `[DONE]` 为结束 |

## 命令行

`penguin agent api` 在终端里管理 Agent 的 API，作用于正在运行的服务器，规则与 API 标签页相同：

| 命令 | 作用 |
| --- | --- |
| `penguin agent api status --agent-id <id>` | 显示 API 是否开启、无密钥访问、审批模式、Base URL、Agent ID、密钥数量和管理员开关 |
| `penguin agent api enable --agent-id <id> [--open \| --no-open] [--approve <mode>]` | 开启 API，可同时设置无密钥访问和审批模式 |
| `penguin agent api disable --agent-id <id>` | 关闭 API |
| `penguin agent api set --agent-id <id> [--open \| --no-open] [--approve <mode>]` | 修改无密钥访问或审批模式，不改变 API 的开关状态 |
| `penguin agent api keys ls --agent-id <id>` | 列出密钥：id、名字、开头几个字符、创建时间、最近使用时间 |
| `penguin agent api keys create --agent-id <id> --name <name>` | 签发密钥。stdout 上只有密钥本身，其余信息都写到 stderr，所以 `$(…)` 只会取到密钥 |
| `penguin agent api keys rm <keyId> --agent-id <id>` | 删除密钥 |
| `penguin agent api server on\|off` | 管理员开关 |

每条命令都接受 `--project-id`、`--server` 和 `--json`。`--approve` 接受四种模式：`allow-all`、`read-only`、`always-ask`、`deny-all`。见 [CLI 参考](/cli)。

会做出修改的命令（`enable`、`disable`、`set`、`keys create`、`keys rm` 和 `server`）需要你的登录：先运行一次 `penguin auth login`，或在服务器本机运行 `penguin auth token`。服务器拒绝携带本地 API token 的这些命令，CLI 随即带着这个登录再发一次。没有登录时，它们打印这条提示并以退出码 1 退出。`status` 和 `keys ls` 不需要登录。

## 管理员开关

**设置 › 服务器 › Agent API** 中有管理员的**允许 Agent API** 开关，缺省开启。关闭前会先确认；关闭后，所有 Agent API 请求（CORS 预检除外）都以 `403` `agent_api_disabled` 拒绝。各 Agent 的开关、审批模式和密钥都会保留，所有成员看到的 API 标签页开关都显示为不可用，并附有说明。见设置中的 [Agent API](/settings#agent-api)。这个设置是 `GET`/`PUT /api/admin/settings` 中的 `agentApiEnabled`，登录后在终端里用 `penguin agent api server on|off` 设置。
