# 外部程序可以与 Agent 对话：Agent API、AMSP 事件流与 amsp 客户端

- **Date:** 2026-10-07
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `amsp`, `docs`
- **PR:** [#1000](https://github.com/Prism-Shadow/penguin-harness/pull/1000)

[English](2026-10-07-agent-api-amsp.md)

Project 所有者可以把某一个 Agent 开放给 PenguinHarness 之外的程序。程序把输入发到 `POST /api/amsp/v1/agents/:projectId/:agentId/runs`，以 AMSP 事件流实时读取这次运行，再凭 Session id 延续对话。这些运行使用 Project 的模型与凭据，像其他对话一样被记录，并出现在侧边栏的**后台会话**折叠夹中。新增的 `@prismshadow/amsp` 包含该协议的类型和一个可在 Node 与浏览器中使用的 TypeScript 客户端。

## Agent API

- 每个 Agent 有了自己的开关（缺省关闭）、可选的**无密钥访问**开关（同样缺省关闭）和 **API 审批模式**（缺省 `allow-all`）。它们保存在服务器数据库新增的 `agent_api` 与 `agent_api_keys` 表中，不在 Agent 的状态里，也不在 Project 文件里，因此 Agent 既不能自行对外开放，也不能放宽自己的审批。
- 密钥按 Agent 签发，各有名字，只显示一次：`penguin_` 加 43 个 base64url 字符，以 SHA-256 保存，列表中显示其前 16 个字符。密钥只能运行它所属的 Agent，并读取、中止该 Agent 的 API 会话、回答其审批，此外不能访问任何东西。每次出示密钥的运行都会记下它的最近使用时间。
- 公开路由挂在 `/api/amsp/v1` 之下，不经登录 Cookie：`GET /agents/:projectId/:agentId`、`POST /agents/:projectId/:agentId/runs`、`GET /sessions/:sessionId`、`POST /sessions/:sessionId/abort` 和 `POST /sessions/:sessionId/approvals/:toolCallId`。该前缀下的其他路径返回 JSON 形式的 `404` `not_found`。密钥和各项开关在读取请求体之前检查。
- 不带 `session_id` 的运行会新建一个会话，其 `session_meta.source` 为 `api`、索引行的 `client` 为 `api`，使用 Project 的默认模型、服务器的新对话沙箱和该 Agent 的 API 审批模式（在会话创建时复制到会话上）。`session_id` 延续同一个 Agent 的 API 会话；其他 id 返回 `404` `session_not_found`。
- 审批模式需要询问时，确认请求以 `approval.requested` 流向调用方，Web App 中的该会话也能回答，以先回答的为准。调用方断开连接即中止其运行，待审批的调用被拒绝。`POST …/abort` 中止运行，同时保持事件流打开，以送出最后的 `run.done`。
- 正忙的会话返回 `409`；同一个 Agent 的第五个并发运行返回 `429` `too_many_runs`，并带 `Retry-After: 2`。
- CORS 预检对任何来源都应答。`Access-Control-Allow-Origin: *` 只在带 `Authorization` 的请求上返回，服务器全局的 `413` 与 `415` 拒绝也不例外，所以其他来源的页面无法借无密钥访问驱动 Agent。
- 管理员在 `/api/admin/settings` 中的 `agentApiEnabled` 设置缺省开启；关闭后所有 Agent API 请求都以 `403` `agent_api_disabled` 拒绝，各 Agent 的设置与密钥保留。
- `/api/projects/:projectId/agents/:agentId/api` 下的路由让任何成员读取 Agent 的设置（包括以 `serverEnabled` 给出的管理员开关），让所有者修改设置、创建和删除密钥。Agent 列表带上了 `apiEnabled`。

## AMSP 事件流

- AMSP（Agent Message Stream Protocol）流式传输 Agent 的一次运行（一个 Task），正如 MMSP 流式传输一次模型调用：SSE 的 `data:` 行，以 `data: [DONE]` 收尾，静默 15 秒时发送 `: keep-alive`，字节以 base64 传送。事件是以 `<subject>.<phase>` 命名的扁平对象：`run.*`、`context.opened`、`mcp_connect.*`、`tools.ready`、`request.*`、`K.delta` / `K.done` 内容项、`approval.*`、`compaction.*` 和 `hook.fired`。
- 服务器把 Session 的实时流（OmniMessage 记录与服务器事件）翻译成 AMSP。分片和完整内容项都按引擎产出的原样转发，`partial_*` 的 `stop` 不发送，OmniMessage 没有增加任何字段。
- `run.done` 是唯一的终止事件，总会到达（出错时也一样），带有运行的状态、错误、Request 次数、Token 用量和 Session 的累计值。事件流开始之前的错误沿用服务器的错误信封和固定的状态码。
- 新的事件类型和可选字段在 `/v1` 之内增加，改变字段含义则属于 `/v2`；客户端须忽略不认识的事件类型。

## amsp 客户端

- `@prismshadow/amsp` 是新的公开包，没有运行时依赖，适用于 Node 24 和浏览器。它导出 AMSP 的传输类型（服务器也引用这些类型）和 `AgentClient`。
- `client.run()` 返回一个可迭代取得事件的运行，带有 `session`、`result()` 和 `abort()`；`client.ask()` 只返回结果。`onApproval` 回答审批请求，没有它时一律拒绝。客户端还提供 `agent()`、`session()`、`abort()` 和 `approve()`，`AmspHttpError` 与 `AmspStreamError` 两种错误，解析工具调用 JSON 参数的 `parseArguments`，以及 SSE 读取器 `readSse`。

## Web App

- Agent 设置页新增 **API** 标签页：**开启 API 访问**、API 会话的审批模式、可复制的 Base URL 和 Agent ID、只显示一次并可在列表中删除的密钥、带警示的**允许无密钥访问**，以及 curl 和 TypeScript 示例。管理员关闭 Agent API 期间，标签页的开关不可用，并向所有成员说明原因。
- 智能体页面为已开启 API 的 Agent 加上 API 图标。**设置 › 服务器**新增 **Agent API** 页，其中是管理员的**允许 Agent API** 开关，关闭前会先确认。

## CLI

- `penguin agent api` 在终端里查看和修改 Agent 的 API：`status`、`enable`、`disable` 和 `set`（带 `--open` / `--no-open` 与 `--approve <mode>`）、`keys ls`、`keys create`（stdout 上只有密钥本身）、`keys rm`，以及管理员开关 `server on|off`。`--agent-id` 必填、没有默认值；`status` 向任何成员显示管理员开关。

## 文档

- 新增两个参考页面：**Agent API**，讲开启 Agent 的 API、审批模式、密钥、无密钥访问、路由、错误、curl、在 Node 和浏览器中使用客户端，以及 CLI；**AMSP**，讲协议的传输、语法、全部事件、示例、错误、从 OmniMessage 的映射和版本规则。
- **Server API** 补充了 Agent API 设置路由、`agentApiEnabled`、`apiEnabled`、`client` 的 `api` 取值和 `/api/amsp/v1` 的 CORS 例外；**CLI 参考**补充了 `penguin agent api`；**智能体**补充了 **API** 标签页；**设置**补充了 **Agent API** 页；**OmniMessage** 说明 AMSP 是它的投影，它本身没有任何改变。

## 兼容性

没有加入任何兼容代码；以下变化按原样接受：

- 新增 `agent_api` 和 `agent_api_keys` 两张表（migration 14）。旧版服务器从不读取它们，也不提供 `/api/amsp` 路由，所以回滚之后调用方会得到 `404`，直到认识这两张表的版本回来。回滚该 migration 会删除所有 Agent 的 API 设置和密钥。
- API 创建的会话在 Session 索引中记为 `client` `api`；这一列接受新取值，无需 migration。
