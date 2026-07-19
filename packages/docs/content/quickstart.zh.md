---
title: 快速开始
description: 安装 PenguinHarness、配置模型并运行第一个 Task。
---

## 安装

Linux / macOS 一键安装：

```bash
curl -fsSL https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh | sh
```

其他方式（npm、源码）见[安装](/installation)。

## 配置模型

PenguinHarness 不内置任何模型凭据，使用前需要先配置一个模型。可以在 Web UI 的 Models 页面完成，也可以用 CLI：

```bash
penguin config model add --model-id deepseek-v4-pro --api-key sk-... --set-default
```

- 省略 `--provider` 时，根据内置目录自动推断 Provider。
- API Key 也可以来自环境变量：当模型条目没有内联 api_key 时，LLM 网关库 AgentHub 会读取 `DEEPSEEK_API_KEY`、`ANTHROPIC_API_KEY`、`OPENAI_API_KEY`、`GEMINI_API_KEY` 等变量；工作目录下的 `.env` 会被自动加载。

## 启动 Web App

```bash
penguin web
```

服务运行在 http://127.0.0.1:7364 并自动打开浏览器（`--no-open` 跳过）。首次登录使用 `admin` / `admin123`，请立即修改密码。`penguin server` 启动同一进程的 headless 版本。

## 单次运行

```bash
penguin run -m "创建 hello.txt，内容为 Hello, Penguin"
```

Workspace 默认为当前目录，可用 `--workspace /path` 指定；目标目录必须已存在。

## 交互式对话

```bash
penguin chat
```

- 每输入一行即发起一个 Task。
- `/compact` 压缩上下文；`/exit` 或 `/quit` 退出；Ctrl-C 中断正在运行的 Task。
- 退出时会打印 `penguin chat --resume <sessionId>` 提示，用于恢复本次 Session；`--resume` 不带 id 时恢复该 Agent 最近的 Session。

## SDK 示例

安装 `@prismshadow/penguin-core` 后：

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

## 下一步

- [Web App 指南](/web-app)：在浏览器中使用 PenguinHarness。
- [CLI 参考](/cli)：完整命令与选项。
- [架构总览](/architecture)：了解整体设计。
