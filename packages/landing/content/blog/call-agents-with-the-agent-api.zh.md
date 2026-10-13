---
title: "通过统一 API 将 Agent 接入任意外部应用"
date: 2026-10-13
category: practice
excerpt: "PenguinHarness 里的每个 Agent 都用同一套 API 对外提供服务。开启 API、创建密钥后，任何应用都能运行这个 Agent：用 curl，或在 TypeScript 里用 @prismshadow/amsp 客户端。运行过程以 AMSP 事件流返回，用返回的会话 id 就能继续对话。"
---

Agent API 通过 HTTP 把你的 Agent 接入 PenguinHarness 之外的任何应用，而且所有 Agent 用的是同一套 API：无论调用哪个 Agent，端点、AMSP 事件和客户端都一样。应用发送输入，在运行过程中读取 AMSP 事件流，之后凭 Session id 继续对话。运行使用的是 Project 的模型和凭据，每次运行都会像普通对话一样留下记录。

本教程会把默认 Agent 的 API 开放出来，先用 curl 问它现在的时间，再用 Node 配合 `@prismshadow/amsp` 客户端做同样的事。

## 前置条件

- PenguinHarness 0.2.14，并在**模型库**页面配置好模型。
- Project 的所有者角色。只有所有者能开启 Agent 的 API 并管理密钥。
- curl，运行客户端则需要 Node 24。

## 第 1 步：开启 Agent 的 API

1. 打开**智能体**，选中 Agent，进入**API**标签页。
2. 打开**开启 API 访问**。
3. 把**API 会话的审批模式**保持为**全部放行**，这样工具调用不用等审批就能直接执行。选**放行只读**或**总是询问**时，需要审批的调用要等程序答复后才会执行。
4. 在**密钥**下选择**新建密钥**，输入**密钥名称**，再选择**创建**。密钥只显示一次，记得复制。

![API 标签页：开启 API 访问已打开、审批模式、连接方式下的 Base URL 和 Agent ID，以及一个密钥](/blog-assets/agent-api-tab-zh.png)

**连接方式**给出了程序需要的另外两项信息：**Base URL**，即你的服务器地址加上 `/api/amsp/v1`；以及**Agent ID**，即 `<projectId>/<agentId>`。把密钥和 Base URL 设为环境变量：

```bash
export PENGUIN_AGENT_KEY='penguin_…'                       # 刚复制的密钥
export PENGUIN_AGENT_URL=http://localhost:7364/api/amsp/v1  # 你的 Base URL
```

地址保持 `localhost` 不变：绑定在回环地址上的服务器会对发往 `127.0.0.1` 的 API 请求返回 `401`。

## 第 2 步：在标签页里试一试

标签页末尾的**试一试**会发起一次真实的运行，走的是程序调用的同一条路由，只是用你的登录状态代替密钥。选择**运行**，下方就会显示事件流。

![运行一次后的试一试：Agent 执行 date，读取输出并回答，run.done 报告两次请求](/blog-assets/agent-api-try-zh.png)

## 第 3 步：用 curl 运行 Agent

```bash
curl -N "$PENGUIN_AGENT_URL/agents/default_project/default_agent/runs" \
  -H "Authorization: Bearer $PENGUIN_AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input":"What time is it now?"}'
```

返回的就是这次运行本身：每个事件一行 `data:`，以 `run.done` 和 `data: [DONE]` 结尾。下面是这次请求在用脚本化测试模型代替真实模型时返回的事件流（有删节）：

```text
data: {"type":"run.started","at":"2026-10-12T17:47:31.940Z","session_id":"session-2026-10-13-01-47-31-99795a84","agent":"default_project/default_agent"}
data: {"type":"tools.ready",…}
data: {"type":"request.started","at":"2026-10-12T17:47:31.960Z","request":1}
…
data: {"type":"tool_call.done","at":"2026-10-12T17:47:31.966Z","tool_call_id":"call_5ca97ddd648b680ebc5c83eb","name":"exec_command","arguments":"{\"description\":\"Read the server's clock\",\"cmd\":\"date\"}","stop_reason":"completed"}
…
data: {"type":"tool_result.done","at":"2026-10-12T17:47:32.042Z","tool_call_id":"call_5ca97ddd648b680ebc5c83eb","output":"Tue Oct 13 01:47:31 CST 2026\n","stop_reason":"completed"}
…
data: {"type":"text.done","at":"2026-10-12T17:47:32.061Z","role":"assistant","text":"It's 01:47 on October 13, 2026, by the server's clock (CST).","stop_reason":"completed"}
…
data: {"type":"run.done","at":"2026-10-12T17:47:32.095Z","status":"completed","requests":2,"usage":{"cache_read":5576,"cache_write":1024,"output":96,"total":6696},"session_usage":{"cache_read":5576,"cache_write":1024,"output":96,"total":6696}}
data: [DONE]
```

`-N` 关闭 curl 的缓冲，事件一到就打印出来。要继续对话，把 `run.started` 里的 `session_id` 连同下一条输入一起发送：

```bash
curl -N "$PENGUIN_AGENT_URL/agents/default_project/default_agent/runs" \
  -H "Authorization: Bearer $PENGUIN_AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"session_id":"session-2026-10-13-01-47-31-99795a84","input":"And in UTC?"}'
```

```text
…
data: {"type":"text.done","at":"2026-10-12T17:47:32.127Z","role":"assistant","text":"That is 17:47 UTC on Monday, October 12.","stop_reason":"completed"}
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
import { AgentClient } from "@prismshadow/amsp";

const client = new AgentClient({
  baseUrl: process.env.PENGUIN_AGENT_URL,
  agent: "default_project/default_agent",
  apiKey: process.env.PENGUIN_AGENT_KEY,
});

const run = client.run({ input: "What time is it now?" });
for await (const event of run) {
  if (event.type === "tool_call.done") console.log(`[tool] ${event.name} ${event.arguments}`);
  if (event.type === "text.delta") process.stdout.write(event.text);
}
const first = await run.result();
console.log(`\n[${first.status}] ${first.requests} requests, ${first.usage.total} tokens`);

const second = await client.ask({ sessionId: first.sessionId, input: "And in UTC?" });
console.log(second.text);
```

用 `node ask.mjs` 运行：

```text
[tool] exec_command {"description":"Read the server's clock","cmd":"date"}
It's 01:47 on October 13, 2026, by the server's clock (CST).
[completed] 2 requests, 6696 tokens
That is 17:47 UTC on Monday, October 12.
```

`client.run()` 返回这次运行，可以在事件到达时逐个迭代。`run.result()` 在运行结束后返回结果。`client.ask()` 会等到运行结束，只返回结果。传入 `sessionId` 就能继续对话，和 curl 里的 `session_id` 作用一样。

## 这些会话去了哪里

API 会话不会出现在侧边栏，而是会被归档，列在**设置** › **已归档对话**下，并带有**API**标记。取消归档后即可在 Web App 里查看。

## 限制

- 一个会话同一时间只运行一件事：会话忙时再发起的运行会被拒绝，返回 `409`。该 Agent 已有四个对话在运行时（Web App 里的对话也算在内），新的 API 运行会被拒绝，返回 `429` 和 `Retry-After: 2`。
- 断开连接会中止运行。想停止运行但仍能收到它的 `run.done`，就向 Base URL 下的 `/sessions/<session_id>/abort` 发送 `POST`。
- 打开**允许无密钥访问**后，不带密钥的请求也能运行 Agent。只对监听回环地址的服务器开启。
- 服务器管理员可以在**设置** › **服务器** › **Agent API**下用**允许 Agent API**把整个 API 关掉。
- `penguin agent api` 可以在终端里查看和修改同样的设置，例如 `penguin agent api status --agent-id default_agent`。
