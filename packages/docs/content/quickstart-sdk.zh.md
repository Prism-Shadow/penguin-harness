---
title: SDK
description: 用 @prismshadow/penguin-core 在自己的 TypeScript 程序里创建 Agent 与 Session。
---

`@prismshadow/penguin-core` 就是 CLI 与服务端内部运行的那个引擎，可以直接嵌入你自己的程序。在本页中，你会安装 SDK、为它准备可用的模型，并运行第一个程序：创建 Agent，启动 Session，打印模型的回复。

## 开始之前

- Node.js >= 24。
- 一个模型供应商的 API Key。这台机器上已经配置过模型时，可以省略。

## 安装 SDK

在项目目录里安装这个包：

```bash
npm install @prismshadow/penguin-core
```

## 配置模型

SDK 与桌面应用、CLI 读取同一个数据目录 `~/.penguin/data`。在[桌面应用](/quickstart-desktop)或 [CLI](/quickstart-cli) 里配置好的模型，SDK 可以直接使用，不需要重复配置。

如果这台机器上还没有配置过模型，最省事的办法是装上 CLI，在 CLI 里配置一次：

```bash
npm install -g @prismshadow/penguin-cli
penguin config model add --provider deepseek --model-id deepseek-flash --api-key sk-... --set-default
```

把 `sk-...` 换成你的 API Key。CLI 会把模型写入数据目录，SDK 马上就能使用。

凭据也可以完全不落盘。模型条目没有内联 `api_key` 时，LLM 网关库 AgentHub 会读取 `DEEPSEEK_API_KEY`、`ANTHROPIC_API_KEY`、`OPENAI_API_KEY`、`GEMINI_API_KEY` 等环境变量。工作目录下的 `.env` 文件会自动加载。

## 运行第一个程序

把下面的程序保存到项目里，然后运行：

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

这个程序把当前目录用作 Session 的 Workspace，让 Agent 创建 `hello.txt`，并打印模型的每一条完整文本回复。

### 程序是怎样工作的

- `createAgent` 按 id 载入 Agent 的配置：提示词、工具和运行参数。`default_agent` 是初始化数据目录时自带的 Agent。
- `session.run()` 返回一个异步迭代器，逐条产出 OmniMessage。循环里的判断只挑出模型的完整文本消息；工具调用、思考块等其他内容也在同一个流里。
- `approve` 是审批回调，返回 `"allow"` 即全部放行。四种审批模式与工具的对应关系见[工具与审批](/tools)。

## 下一步

- [接口契约](/interfaces)：`createAgent`、`Session`、LLM 与 Environment 背后的接口契约。
- [OmniMessage 协议](/omni-message)：`session.run()` 产出的消息结构。
- [Agent 运行循环](/agent-loop)：一个 Task 内部经历了什么。
- [Session 与 Trace](/sessions-and-traces)：会话与执行记录如何存储。
