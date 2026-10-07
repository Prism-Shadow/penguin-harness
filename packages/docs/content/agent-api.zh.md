---
title: Agent API
description: 让外部程序经 HTTP 与某个 Agent 对话：开启 Agent 的 API、签发密钥，再用 curl 或 @prismshadow/amsp 客户端运行它。
---

Agent API 让 PenguinHarness 之外的程序（脚本、服务、浏览器里的页面）经 HTTP 与某一个 Agent 对话。程序发送输入，以 [AMSP](/amsp) 事件流实时读取这次运行，再凭 Session id 延续对话。运行使用 Project 的模型与凭据，像其他对话一样被记录，并出现在侧边栏的**后台会话**折叠夹中。

从哪里开始：

- 想对外开放某个 Agent，见[开启 Agent 的 API](#开启-agent-的-api)。
- 想在 shell 里试一试，见[用 curl 调用](#用-curl-调用)。
- 想在 TypeScript 里调用（Node 或浏览器），见[amsp 客户端](#amsp-客户端)。
- 想逐个了解事件流里的事件，见 [AMSP](/amsp)。

## 开始之前

- 只有 Project 的所有者能开启或关闭 Agent 的 API、选择审批模式、管理密钥；成员可以查看这些设置。
- 服务器管理员可以整体关闭 Agent API，缺省为开启。见[管理员开关](#管理员开关)。
- 程序需要三样东西，都显示在该 Agent 的 **API** 标签页上：
  - **Base URL**：服务器地址加上 `/api/amsp/v1`，本机服务器即 `http://127.0.0.1:7364/api/amsp/v1`；
  - **Agent ID**：`<projectId>/<agentId>`，例如 `demo/coder`；
  - **密钥**：除非该 Agent 允许[无密钥访问](#无密钥访问)。

## 开启 Agent 的 API

1. 打开该 Agent 的设置（见 [Agent 设置](/agents#agent-设置)），选择 **API** 标签页，地址为 `/agents/<agentId>?tab=api`。
2. 打开**开启 API 访问**。
3. 选择 **API 会话的审批模式**，见[审批模式](#审批模式)。
4. 在**密钥**下选择**新建密钥**，起个名字，然后复制密钥。密钥只显示这一次。
5. 在**连接**下复制 **Base URL** 和 **Agent ID**。**示例**里有一条 curl 命令和一段 TypeScript 代码，两者都已填好，密钥处写作 `$PENGUIN_AGENT_KEY`。

在 Agents 页面上，已开启 API 的 Agent 名称后带有 API 图标。

关闭**开启 API 访问**后，该 Agent 的所有请求立即以 `404` `agent_not_found` 拒绝。它的密钥和设置都会保留，等重新开启时继续使用。

这些设置由服务器保存，不在 Agent 的状态里，因此 Agent 既不能自行对外开放，也不能放宽自己的审批模式。

### 审批模式

API 会话有自己的审批模式，与新建对话时预选的审批模式互不相干：

| 模式 | 选择器中的名称 | 调用方看到的情形 |
| --- | --- | --- |
| `allow-all`（缺省） | **全部放行** | 所有工具调用直接执行，不等调用方 |
| `read-only` | **放行只读** | 只读工具直接执行；其余调用以 `approval.requested` 发给调用方，等待回答 |
| `always-ask` | **总是询问** | 每次工具调用都等调用方回答 |
| `deny-all` | **全部拒绝** | 所有工具调用都被拒绝；模型读到拒绝结果，在没有该工具的情况下继续 |

- 审批模式在 API 会话创建时读取，此后随该会话保存。在标签页上修改，只影响之后新建的 API 会话。要修改某个已有会话，在 Web App 中打开它，在那里修改它的审批模式。
- 等待审批的调用会发给调用方，同时显示在 Web App 的该会话中，以先回答的一方为准。运行没有等待时限：直到有人回答、运行被中止，或调用方断开连接（此时视为拒绝）。
- 缺省为 `allow-all`，是因为沙箱已经限定了 Agent 能做的事，而程序通常没有人可问。如果程序会回答审批，就选 `read-only` 或 `always-ask`，见[审批](#审批)。

API 会话的沙箱取自服务器的新对话默认值，与其他新对话相同。Project 为新对话预选的审批模式不适用于 API 会话。

### 密钥

- 密钥形如 `penguin_` 加 43 个字符，只在创建时显示一次；服务器只保存它的 SHA-256。
- 一个 Agent 可以有多个密钥，各有名字。列表显示每个密钥的名字、开头几个字符、创建时间和最近使用时间（首次运行之前显示**从未**）。
- 删除密钥即撤销它：此后出示它的请求以 `401` 拒绝。
- 密钥只属于一个 Agent：它能运行该 Agent，能读取、中止该 Agent 的 API 会话并回答其审批，此外不能访问服务器上的任何东西。出示另一个 Agent 的密钥会以 `404` `agent_not_found` 拒绝。
- 以 `Authorization: Bearer <key>` 发送。

### 无密钥访问

**允许无密钥访问**让不带密钥的请求也能运行该 Agent。它缺省关闭；开启后，带了密钥的请求仍会校验密钥。

> [!WARNING]
> 开启无密钥访问后，任何能访问服务器地址的程序都能与该 Agent 对话，用的是 Project 的模型和凭据。只在服务器只监听本机回环地址（`127.0.0.1`）时开启。

其他来源的浏览器页面无法使用无密钥访问：服务器不会给不带 `Authorization` 的请求返回 CORS 头。见[在浏览器中](#在浏览器中)。

## 用 curl 调用

```bash
curl -N http://127.0.0.1:7364/api/amsp/v1/agents/demo/coder/runs \
  -H "Authorization: Bearer $PENGUIN_AGENT_KEY" -H "Content-Type: application/json" \
  -d '{"input":"Summarize README.md"}'
```

响应就是这次运行，实时流式返回：每个事件一行 `data:`，最后是 `data: [DONE]`。`-N` 关闭 curl 的缓冲，事件到达即打印。第一个事件 `run.started` 给出 Session；最后一个事件 `run.done` 说明运行如何结束、计了多少 Token：

```text
data: {"type":"run.started","at":"2026-10-07T10:00:00.000Z","session_id":"session-2026-10-07-10-00-00-3f9a1c2e","agent":"demo/coder"}
data: {"type":"request.started","at":"…","request":1}
data: {"type":"text.delta","at":"…","role":"assistant","text":"README.md describes"}
…
data: {"type":"run.done","at":"…","status":"completed","requests":1,"usage":{…},"session_usage":{…}}
data: [DONE]
```

要延续对话，把 Session id 和下一条输入一起发送：

```bash
curl -N http://127.0.0.1:7364/api/amsp/v1/agents/demo/coder/runs \
  -H "Authorization: Bearer $PENGUIN_AGENT_KEY" -H "Content-Type: application/json" \
  -d '{"session_id":"session-2026-10-07-10-00-00-3f9a1c2e","input":"Now list its headings"}'
```

## 路由

所有路径都相对于 Base URL。其下不匹配任何路由的路径，以 JSON 形式返回 `404` `not_found`。

| 方法 | 路径 | 响应 |
| --- | --- | --- |
| GET | `/agents/:projectId/:agentId` | `{agent: {id, name?, description?}}` |
| POST | `/agents/:projectId/:agentId/runs` | 以事件流返回这次运行，见 [AMSP](/amsp) |
| GET | `/sessions/:sessionId` | `{session: {id, agent, status, provider, model_id, created_at, last_active_at}}` |
| POST | `/sessions/:sessionId/abort` | 中断了运行时返回 `202`，没有运行时返回 `204` |
| POST | `/sessions/:sessionId/approvals/:toolCallId` | `{decision: "allow" \| "deny"}`；返回 `204`，已被回答时返回 `404` `approval_not_found` |

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
- 不带 `session_id` 时，运行开启一个新会话，由 `run.started` 给出其 id。带上它，运行就延续那个会话；它必须是同一个 Agent 的 API 会话，其他 id 一律返回 `404` `session_not_found`。

### 会话

- 新的 API 会话使用 Project 的默认模型、服务器的新对话沙箱和该 Agent 的 API 审批模式。标题由第一条输入生成，用量和费用计入 Project，与其他会话相同。
- 侧边栏把 API 会话列在该 Agent 的**后台会话**折叠夹中，每行带 API 图标。你可以打开它、阅读、回答其审批，也可以在其中输入。
- 一个会话同一时间只做一件事：会话仍在工作时发起的运行以 `409` 拒绝。一个 Agent 同时最多有四个 API 运行，第五个以 `429` 拒绝，并带 `Retry-After: 2`。
- 断开连接即中止运行。要停止运行、同时仍能收到它的结局，就 `POST /sessions/:sessionId/abort`：事件流保持打开，以 `status: "aborted"` 的 `run.done` 结束。

### 错误

在事件流开始之前被拒绝的请求，得到一个 HTTP 状态码和统一的信封 `{"error": {"code": "<code>", "message": "<text>"}}`：

| 状态码 | `code` | 场景 |
| --- | --- | --- |
| 400 | `bad_request` | 请求体不是 JSON 对象；`input` 缺失或为空；某项的 `type` 未知；`session_id` 不是合法 id；图片过大或不是图片；`decision` 不是 `allow` 或 `deny` |
| 401 | `unauthorized` | 该 Agent 需要密钥，而请求没有出示或出示了未知的密钥。在读取请求体之前检查 |
| 403 | `agent_api_disabled` | 管理员关闭了 Agent API |
| 404 | `agent_not_found` | 没有这个 Agent、它的 API 未开启，或密钥属于另一个 Agent |
| 404 | `session_not_found` | 没有这个 Session、它不是 API 会话，或它属于另一个 Agent |
| 404 | `approval_not_found` | 该审批已被回答，或从未存在 |
| 404 | `not_found` | 该路径没有路由 |
| 409 | `task_in_progress`、`compacting` | 会话正忙 |
| 413 | `payload_too_large` | 请求体超过服务器的大小上限 |
| 415 | `unsupported_media_type` | 写请求没有带 `Content-Type: application/json` |
| 429 | `too_many_runs` | 该 Agent 已有四个运行在进行；等 `Retry-After` 秒后重试 |
| 503 | 以服务器返回为准 | 服务器正在关闭，或该 Agent、会话正在被删除 |

事件流一旦开始，错误就不会以单独的帧出现：运行以 `run.done` 结束，由其 `status` 和 `error` 说明发生了什么。见[流中的错误](/amsp#流中的错误)。

## amsp 客户端

`@prismshadow/amsp` 是 Agent API 的 TypeScript 客户端。它没有任何依赖，可在 Node 24 和当前的浏览器中运行，并导出 AMSP 的事件类型。

```bash
npm install @prismshadow/amsp
```

```ts
import { AgentClient } from "@prismshadow/amsp";

const client = new AgentClient({
  baseUrl: "http://127.0.0.1:7364/api/amsp/v1",
  agent: "demo/coder",
  apiKey: process.env.PENGUIN_AGENT_KEY,
});

const run = client.run({ input: "Summarize README.md" });
for await (const event of run) {
  if (event.type === "text.delta") process.stdout.write(event.text);
}
const first = await run.result();

const second = await client.ask({
  sessionId: first.sessionId,
  input: "Now list its headings",
  onApproval: () => "allow",
});
console.log(second.text, second.usage.total);
```

- `client.run()` 立即开始运行并返回它。迭代它即可按到达顺序取得事件，只能迭代一次；事件在被读取之前一直保留。`run.started` 一到，`run.session` 就以 Session id 兑现。
- 事件流结束时 `run.result()` 兑现，内容为 `status`、`error`、`sessionId`、`text`、`items`、`usage`、`sessionUsage` 和 `requests`。`text` 是主会话中助手的回答，以空行连接；子 Agent 的文本、用户消息和压缩摘要都不计入。`items` 按顺序包含除 `.delta` 分片以外的全部事件。
- `client.ask()` 运行到结束并返回同样的结果，不为迭代保留任何事件。
- 提前退出循环只停止迭代，不停止运行：审批照常回答，`result()` 照常兑现。要停止运行，见[中止](#中止)。
- 客户端不认识的事件类型会原样传出，所以对 `event.type` 分支时要留一个缺省分支。

### 审批

当审批模式让某次调用等待时，运行会给出 `approval.requested`，客户端替你回答：用 `onApproval` 的决定；没有回调或回调抛出异常时回答 `deny`。无论你是在迭代还是只等待结果，客户端都会回答。

```ts
import { AgentClient, parseArguments } from "@prismshadow/amsp";

const result = await client.ask({
  input: "Clean up the build output",
  onApproval: (request) => {
    const args = parseArguments(request.tool_call);
    return request.tool_call.name === "exec_command" && args?.command === "ls" ? "allow" : "deny";
  },
});
```

- AMSP 把工具调用的参数作为模型写出的 JSON 字符串传送，`parseArguments` 把它转成对象：没有参数时为 `{}`，解析不成对象时为 `null`。
- 已经有人在 Web App 里回答过的审批不算错误。服务器拒绝接受的回答（例如运行途中密钥被删除）会以那个 `AmspHttpError` 结束运行，并断开连接，让服务器中止运行，而不是一直等下去。
- 自行读取事件流的程序可以用 `client.approve(sessionId, toolCallId, decision)` 手动回答。

### 中止

- 中止传给 `run()` 或 `ask()` 的 `signal` 会断开连接：服务器中止运行，运行以该 signal 的 reason（缺省为 `AbortError`）拒绝。尚未读取的事件被丢弃。
- `run.abort()` 请服务器中止运行，并保持连接：事件流以 `status: "aborted"` 的 `run.done` 结束，`result()` 以它兑现。
- `client.abort(sessionId)` 按 id 对某个会话做同样的事，并返回是否中断了运行。

### 运行失败时

- 只要运行到达了 `run.done`，无论其 `status` 如何，`result()` 都会兑现；请检查 `status` 和 `error`。
- 事件流开始之前的拒绝以 `AmspHttpError` 拒绝，带有信封中的 `status`、`code` 和 `message`。响应体不是信封时，`code` 为 `http_error`，message 包含状态码和响应体的开头部分。
- 事件流在 `run.done` 之前结束或中断，或带有不是 AMSP 事件的数据块时，以 `AmspStreamError` 拒绝：运行的结局未知，`client.session(sessionId)` 可以告诉你它是否仍在运行。
- 网络故障和中止按 `fetch` 抛出的原样拒绝。

### 在浏览器中

同一个包经打包工具即可在浏览器中使用。与服务器不同源的页面必须使用密钥：服务器对任何来源都应答 CORS 预检，但只在带 `Authorization` 的请求上返回 `Access-Control-Allow-Origin: *`。跨源请求只能携带 `Authorization` 和 `Content-Type`，所以额外的 `headers` 只适用于同源页面和 Node。

```ts
import { AgentClient } from "@prismshadow/amsp";

const keyField = document.querySelector<HTMLInputElement>("#key")!;
const client = new AgentClient({
  baseUrl: "http://127.0.0.1:7364/api/amsp/v1",
  agent: "demo/coder",
  apiKey: keyField.value,
});

const answer = document.querySelector("#answer")!;
for await (const event of client.run({ input: "What changed today?" })) {
  if (event.type === "text.delta") answer.textContent += event.text;
}
```

> [!WARNING]
> 写在页面里的密钥，任何打开该页面的人都能读到。浏览器客户端只适合你和团队自用的工具，并在运行时输入密钥；否则就把密钥放在后端，由后端替页面调用 Agent。

### 客户端参考

```ts
class AgentClient {
  constructor(opts: {
    baseUrl: string;              // ".../api/amsp/v1"
    agent: string;                // "<projectId>/<agentId>"
    apiKey?: string;              // omitted = keyless; no environment variable is read
    fetch?: typeof fetch;         // the global fetch by default
    headers?: Record<string, string>;
  });
  run(opts: RunOptions): Run;
  ask(opts: RunOptions): Promise<RunResult>;
  agent(): Promise<AgentInfo>;
  session(sessionId: string): Promise<SessionInfo>;
  abort(sessionId: string): Promise<boolean>;
  approve(sessionId: string, toolCallId: string, decision: "allow" | "deny"): Promise<void>;
}

interface RunOptions {
  input: string | InputItem[];
  sessionId?: string;
  signal?: AbortSignal;
  onApproval?: (
    request: ApprovalRequested,
    ctx: { sessionId: string },
  ) => "allow" | "deny" | Promise<"allow" | "deny">;
}

interface Run extends AsyncIterable<AmspEvent> {
  readonly session: Promise<string>;
  result(): Promise<RunResult>;
  abort(): Promise<void>;
}

interface RunResult {
  status: "completed" | "aborted" | "retryable" | "fatal";
  error?: { code: string; message: string };
  sessionId: string;
  text: string;
  items: AmspEvent[];
  usage: TokenCounts;
  sessionUsage: TokenCounts | null;
  requests: number;
}

function parseArguments(call: { arguments: string }): Record<string, unknown> | null;
function readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string>;
class AmspHttpError extends Error { status: number; code: string }
class AmspStreamError extends Error {}
```

`readSse` 是客户端自己的 SSE 读取器，导出给自行读取运行响应体的程序：它逐个产出每个事件的数据，`[DONE]` 也包括在内。

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

## 管理员开关

**设置 › Agent API** 中有管理员的**允许 Agent API** 开关，缺省开启。关闭后，所有 Agent API 请求（CORS 预检除外）都以 `403` `agent_api_disabled` 拒绝。各 Agent 的开关、审批模式和密钥都会保留，API 标签页上的开关显示为不可用，并附有说明。这个设置是 `GET`/`PUT /api/admin/settings` 中的 `agentApiEnabled`，在终端里用 `penguin agent api server on|off` 设置。
