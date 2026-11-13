---
title: "通过统一 API 将 Agent 接入任意外部应用"
date: 2026-10-13
category: practice
excerpt: "PenguinHarness 里的每个 Agent 都用同一套 API 对外提供服务。开启 API、创建密钥后，任何应用都能运行这个 Agent：可以用 curl，也可以在 TypeScript 里用 @prismshadow/amsp 客户端。运行过程会以 AMSP 记录的形式返回，用返回的会话 id 就能继续对话。"
---

Agent API 通过 HTTP 让 PenguinHarness 之外的任何应用都能使用你的 Agent，而且所有 Agent 用的是同一套 API：无论调用哪个 Agent，端点、AMSP 记录和客户端都一样。应用发送输入，在运行过程中读取 AMSP 记录流，之后凭 Session id 继续对话。运行使用的是 Project 的模型和凭据，每次运行都会像普通对话一样留下记录。

本教程会把默认 Agent 的 API 开放出来，先用 curl 问它现在的时间，再用 Node 配合 `@prismshadow/amsp` 客户端做同样的事。

## 前置条件

- PenguinHarness 0.2.17 或更高版本，并在**模型库**页面配置好模型。
- Project 的所有者角色。只有所有者能开启 Agent 的 API 并管理密钥。
- curl，运行客户端则需要 Node 24。

## 第 1 步：开启 Agent 的 API

1. 打开**智能体**，选中 Agent，进入**API**标签页。
2. 打开**开启 API 访问**。
3. 把**审批模式**保持为**全部放行**，这样工具调用不用等审批就能直接执行。选**放行只读**或**总是询问**时，需要审批的调用会等程序答复后再执行。
4. 在**密钥**下选择**新建密钥**，输入**密钥名称**，再选择**创建**。密钥只显示一次，记得复制。

![API 标签页：「开启 API 访问」开关已打开、审批模式、连接下的 Base URL 和 Agent ID，以及一个密钥](/blog-assets/agent-api-tab-zh.png)

**连接**给出了程序需要的另外两项信息：**Base URL**，即你的服务器地址加上 `/api/amsp/v1`；以及**Agent ID**，即 `<projectId>/<agentId>`。把密钥和 Base URL 设为环境变量：

```bash
export PENGUIN_AGENT_KEY='penguin_…'                       # 刚复制的密钥
export PENGUIN_AGENT_URL=http://localhost:7364/api/amsp/v1  # 你的 Base URL
```

地址保持 `localhost` 不变：绑定在回环地址上的服务器会对发往 `127.0.0.1` 的 API 请求返回 `401`。

## 第 2 步：在标签页里试一试

标签页末尾的**试一试**会发起一次真实的运行，走的是程序调用的同一条路由，只是用你的登录状态代替密钥。选择**运行**，就能看到输出：**渲染**里每条记录一行，**原始**里原样列出每一行。下方一栏给出这次运行的状态、Request 数和 Token。

![试一试完成一次「现在几点了？」运行后：「渲染」视图里各条记录的行，下方一栏为状态 completed、Request 2、Token（输出 / 合计）96 / 6696](/blog-assets/penguinharness-0-2-17-agent-api-zh.png)

## 第 3 步：用 curl 运行 Agent

```bash
curl -N "$PENGUIN_AGENT_URL/agents/default_project/default_agent/runs" \
  -H "Authorization: Bearer $PENGUIN_AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input":"What time is it now?"}'
```

返回的就是这次运行本身：流以 `event: ping` 开头，之后每条记录占一行 `data:`，紧跟它的 `id:` 行；新会话的第一条记录是它的 `session_meta`，其中的 `session_id` 就是这个会话的 id。接着依次是 `task_begin`、作为用户 `text` 的输入、这次运行的记录、`task_end`，最后是 `data: [DONE]`。下面是这次请求返回的流（用脚本化测试模型代替真实模型，有删节）：

```text
event: ping
data: {}

data: {"timestamp":"2026-10-26T02:30:01.153Z","type":"session_meta","payload":{"session_id":"session-2026-10-26-10-30-01-6458d204","provider":"deepseek","model_id":"deepseek-v4-pro",…}}
id: 2f9bdf98-3

data: {"timestamp":"2026-10-26T02:30:01.172Z","type":"event_msg","payload":{"type":"task_begin"}}
id: 2f9bdf98-4

…

data: {"timestamp":"2026-10-26T02:30:02.227Z","type":"model_msg","payload":{"type":"tool_call","role":"assistant","name":"exec_command","arguments":"{\"description\":\"Read the server's clock\",\"cmd\":\"date\"}","tool_call_id":"call_f0c5c2018e40adb99c5c9ac8"}}
id: 2f9bdf98-14

…

data: {"timestamp":"2026-10-26T02:30:02.327Z","type":"model_msg","payload":{"type":"tool_call_output","role":"user","output":"Mon Oct 26 10:30:02 CST 2026\n","tool_call_id":"call_f0c5c2018e40adb99c5c9ac8","status":"completed"}}
id: 2f9bdf98-21

…

data: {"timestamp":"2026-10-26T02:30:03.244Z","type":"model_msg","payload":{"type":"partial_text","role":"assistant","event_type":"delta","text":"It's 10:30 on Oc"}}
id: 2f9bdf98-24

…

data: {"timestamp":"2026-10-26T02:30:03.426Z","type":"model_msg","payload":{"type":"text","role":"assistant","text":"It's 10:30 on October 26, 2026, by the server's clock (CST)."}}
id: 2f9bdf98-29

…

data: {"timestamp":"2026-10-26T02:30:03.431Z","type":"event_msg","payload":{"type":"request_end","status":"completed"}}
id: 2f9bdf98-31

data: {"timestamp":"2026-10-26T02:30:03.467Z","type":"event_msg","payload":{"type":"task_end"}}
id: 2f9bdf98-32

data: [DONE]
```

一条消息先以 `partial_*` 片段流式到达，然后再作为完整记录到达一次，例如 `tool_call`、`tool_call_output` 或 `text`。每次模型 Request 夹在 `request_begin` 与 `request_end` 之间，`request_end.status` 说明它如何结束（这里是 `completed`）；整次运行的结果从记录里读取，规则见[运行的结果](https://penguin.ooo/docs/amsp#运行的结果)。如果代码是按早先的 v1 事件写的，[从 v1 旧事件到记录](https://penguin.ooo/docs/amsp#从-v1-旧事件到记录)给出了每个事件对应的记录。

`-N` 关闭 curl 的缓冲，事件一到就打印出来。要继续对话，就把新会话的第一条记录 `session_meta` 里的 `session_id` 连同下一条输入一起发送：

```bash
curl -N "$PENGUIN_AGENT_URL/agents/default_project/default_agent/runs" \
  -H "Authorization: Bearer $PENGUIN_AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"session_id":"session-2026-10-26-10-30-01-6458d204","input":"And in UTC?"}'
```

```text
…

data: {"timestamp":"2026-10-26T02:30:04.539Z","type":"model_msg","payload":{"type":"text","role":"assistant","text":"That is 02:30 UTC on Monday, October 26."}}
id: 2f9bdf98-43

…
```

不带密钥的请求会被直接拒绝，什么都不会运行：

```text
{"error":{"code":"unauthorized","message":"This Agent requires an API key."}}
```

## 第 4 步：在 Node 里运行

在项目里安装客户端：

```bash
npm install @prismshadow/amsp
```

把下面的代码保存为 `ask.mjs`：

```js
import { AgentClient, isModelMessage } from "@prismshadow/amsp";

const client = new AgentClient({
  baseUrl: process.env.PENGUIN_AGENT_URL,
  agent: "default_project/default_agent",
  apiKey: process.env.PENGUIN_AGENT_KEY,
});

const run = client.stream({ input: "What time is it now?" });
for await (const record of run) {
  // Records without `origin` are the main conversation's; a subagent's carry one.
  if (record.origin || !isModelMessage(record)) continue;
  const p = record.payload;
  if (p.type === "tool_call") console.log(`[tool] ${p.name} ${p.arguments}`);
  if (p.type === "partial_text") process.stdout.write(p.text);
}
const first = await run.result();
console.log(`\n[${first.status}] ${first.requests} requests, ${first.usage.total} tokens`);

const second = await client.run({ sessionId: first.sessionId, input: "And in UTC?" });
console.log(second.text);
```

用 `node ask.mjs` 运行：

```text
[tool] exec_command {"description":"Read the server's clock","cmd":"date"}
It's 10:30 on October 26, 2026, by the server's clock (CST).
[completed] 2 requests, 6696 tokens
That is 02:30 UTC on Monday, October 26.
```

`client.stream()` 返回这次运行，可以在记录到达时逐条迭代。循环借助 `origin` 和 `isModelMessage` 跳过子 Agent 的记录和事件记录，打印完整的 `tool_call`，并随到随打 `partial_text` 片段。`run.result()` 在运行结束后返回结果。`client.run()` 则会等到运行结束，只返回结果。传入 `sessionId` 就能继续对话，和 curl 里的 `session_id` 作用一样。

## 这些会话去了哪里

API 会话不会出现在侧边栏，而是会被归档，列在**设置** › **已归档对话**下，并带有**API**标记。取消归档后即可在 Web App 里查看。

## 限制

- 一个会话同一时间只能运行一件事：会话正忙时再发起的运行会被拒绝，返回 `409`。同时运行的会话数上限在 API 标签页的**运行设置** › **最大并发数**中设置，默认为 4；正在运行的会话（包括 Web App 里的对话）都算在内。达到上限时，新的 API 运行会被拒绝，返回 `429` 和 `Retry-After: 2`。
- 断开连接会中止运行。想停止运行但仍能收到全部记录，就向 Base URL 下的 `/sessions/<session_id>/abort` 发送 `POST`：记录以 `abort` 和 `task_end` 结束，然后是 `data: [DONE]`。
- 打开**允许无密钥访问**后，不带密钥的请求也能运行 Agent。只对监听回环地址的服务器开启。
- 服务器管理员可以在**设置** › **服务器** › **Agent API**下用**允许 Agent API**把整个 API 关掉。
- `penguin agent api` 可以在终端里查看和修改同样的设置，例如 `penguin agent api status --agent-id default_agent`。
