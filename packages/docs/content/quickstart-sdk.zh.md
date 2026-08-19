---
title: SDK
description: 用 @prismshadow/penguin-core 在自己的 TypeScript 程序里创建 Agent 与 Session。
---

`@prismshadow/penguin-core` 就是 CLI 与 Server 内部使用的同一个引擎，可以直接嵌进自己的程序。

## 安装

需要 Node.js >= 24：

```bash
npm install @prismshadow/penguin-core
```

## 配置模型

SDK 与其他两条路线读同一个数据目录 `~/.penguin/data`，所以在[桌面端应用](/quickstart-desktop)或 [CLI](/quickstart-cli) 里配好的模型，SDK 直接可用，无需重复配置。

如果这台机器还没配过模型，最省事的方式是装上 CLI 配一次：

```bash
npm install -g @prismshadow/penguin-cli
penguin config model add --provider deepseek --model-id deepseek-v4-flash --api-key sk-... --set-default
```

也可以完全不落盘：模型条目没有内联 api_key 时，LLM 网关库 AgentHub 会读取 `DEEPSEEK_API_KEY`、`ANTHROPIC_API_KEY`、`OPENAI_API_KEY`、`GEMINI_API_KEY` 等环境变量；工作目录下的 `.env` 会被自动加载。

## 第一个程序

```ts
import { createAgent, isCompleteModelMessage, userText } from "@prismshadow/penguin-core";

const agent = await createAgent({ agentId: "default_agent" });
const session = await agent.createSession({ workspaceDir: process.cwd() });

for await (const output of session.run([userText("Create hello.txt containing hi")], {
  approve: async () => "allow",
})) {
  if (isCompleteModelMessage(output) && output.payload.type === "text") {
    console.log(output.payload.text);
  }
}
```

- `createAgent` 按 agentId 载入 Agent 配置（提示词、工具、运行参数）；`default_agent` 是初始化数据目录时自带的那个。
- `session.run()` 返回一个异步迭代器，逐条产出 OmniMessage——上面的判断只挑出模型的完整文本消息，工具调用、思考块等都在同一个流里。
- `approve` 是审批回调，返回 `"allow"` 即全部放行；四种审批模式与工具的对应关系见[工具与审批](/tools)。

## 下一步

- [核心接口](/interfaces)：`createAgent`、`Session`、LLM 与 Environment 的接口契约。
- [OmniMessage 协议](/omni-message)：`session.run()` 产出的消息结构。
- [Agent 运行循环](/agent-loop)：一个 Task 内部经历了什么。
- [Session 与 Trace](/sessions-and-traces)：会话与执行记录如何落盘。
