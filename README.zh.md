<p align="center">
  <img src="packages/landing/public/penguin-logo.svg" alt="PenguinHarness logo" width="88" />
</p>

<h1 align="center">PenguinHarness</h1>

<p align="center"><b>Efficient Self-Improving Harness for Everyone</b></p>

<p align="center">
  开源、本地优先的 AI Agent 基础设施——从自动构建 Agent 到递归自我进化。
</p>

<p align="center">
  <a href="https://github.com/Prism-Shadow/penguin-harness/actions/workflows/ci.yml"><img src="https://github.com/Prism-Shadow/penguin-harness/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/Prism-Shadow/penguin-harness/actions/workflows/pages.yml"><img src="https://github.com/Prism-Shadow/penguin-harness/actions/workflows/pages.yml/badge.svg" alt="Deploy Site" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License: Apache-2.0" /></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2024-brightgreen" alt="Node >= 24" />
</p>

<p align="center">
  <a href="README.md">English</a> | 简体中文 ·
  <a href="https://prism-shadow.github.io/penguin-harness/">官网</a> ·
  <a href="https://prism-shadow.github.io/penguin-harness/docs/">文档</a> ·
  <a href="https://prism-shadow.github.io/penguin-harness/blog">博客</a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="packages/landing/src/assets/shots/chat-zh-dark.webp" />
    <img src="packages/landing/src/assets/shots/chat-zh-light.webp" alt="PenguinHarness Web App——多 Session 对话与实时流式工具调用" width="920" />
  </picture>
</p>

---

## 为什么选择 PenguinHarness

- **Simplest Is the Best**——在干净的底层接口之上刻意保持极简的工具集:更少的工具调用、更少的 Token,高效完成复杂任务。
- **Harness for Building Agents**——基于 PenguinHarness SDK,由一个 Agent 从零开始为你自主构建完整的 Agent 应用。
- **Harness for Recursive Self-Improvement**——基于 PenguinHarness Skills,Agent 评估并优化自己:跑 Benchmark、找失分点、产出 N+1 版本,每轮之前先做快照。
- **本地优先且轻量**——100% 开源,一颗 CPU 即可运行,数据不出机器;经统一网关可接入 1000+ 在线与本地模型。
- **全量可观测**——每次请求、工具调用与审批决策都以追加方式写入 Trace,任何 Session 均可从 Trace 恢复。

## 快速开始

一行命令安装(Linux / macOS,x64 / arm64,内嵌 Node 运行时,解压即用):

```bash
curl -fsSL https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh | sh
```

或经 npm 安装(需系统 Node >= 24,安装后的命令为 `penguin`):

```bash
npm install -g @prismshadow/penguin-cli
```

然后启动 Web App,或直接留在终端:

```bash
penguin web        # 启动服务并打开 http://127.0.0.1:7364(初始账号 admin / admin123)
penguin server     # 同一服务,无头运行

# 先配置一次模型(也可在 Web 的模型页完成)
penguin config model add --model-id deepseek-v4-pro --api-key sk-... --set-default

penguin run -m "创建 hello.txt,内容为 Hello, Penguin"   # 单次任务
penguin chat       # 交互式 REPL(/compact、/exit,Ctrl-C 中断)
```

直接使用 SDK:

```ts
import { createAgent, isCompleteModelMessage, userText } from "@prismshadow/penguin-core";

const agent = await createAgent({ agentId: "default_agent" });
const session = await agent.createSession({ workspaceDir: process.cwd() });

for await (const output of session.run([userText("创建 hello.txt 并写入 hi")], {
  approve: async () => "allow", // 逐个工具审批
})) {
  if (isCompleteModelMessage(output) && output.payload.type === "text") {
    console.log(output.payload.text);
  }
}
```

## 仓库结构

pnpm monorepo(TypeScript,Node >= 24)。一次安装交付四层组件,共享同一数据目录(`~/.penguin/data`)与同一消息协议(OmniMessage):

| 目录 | 包名 | 职责 |
| --- | --- | --- |
| [`packages/core`](packages/core) | `@prismshadow/penguin-core` | SDK 与引擎:ReAct 循环、OmniMessage 协议、LLM/Environment 接口契约、Agent State、Trace |
| [`packages/cli`](packages/cli) | `@prismshadow/penguin-cli` | `penguin` 命令:REPL、单次运行、模型与 Vault 配置、服务启动 |
| [`packages/server`](packages/server) | `@prismshadow/penguin-server` | Web 服务端:HTTP API + SSE 流式、多用户认证、Project 授权、用量统计 |
| [`packages/web`](packages/web) | `@prismshadow/penguin-web` | Web App:多 Session 对话、Agent/技能/模型管理、Trace 观测、评估中心 |
| [`packages/skills`](packages/skills) | `@prismshadow/penguin-skills` | 内置技能库(Agent 创建、Benchmark 设计、评估、优化等) |
| [`packages/landing`](packages/landing) | — | 产品落地页(本仓库官网) |
| [`packages/docs`](packages/docs) | — | 文档站(双语,部署于 `/docs/` 路径) |

职责按事实来源划分:**SDK** 负责协议与执行(消息解析、运行循环、工具),**Server** 负责多用户运行时(认证、SSE 流式、定时任务),`~/.penguin/data` 下的**文件层**承载一切可编辑与被记录的状态(Prompt、Skill、密钥、Trace)。逐项对应表见[架构总览 → 职责划分](https://prism-shadow.github.io/penguin-harness/docs/architecture)。

## 文档

文档站覆盖使用与设计两个层面:[产品介绍](https://prism-shadow.github.io/penguin-harness/docs/) · [快速开始](https://prism-shadow.github.io/penguin-harness/docs/quickstart) · [架构总览](https://prism-shadow.github.io/penguin-harness/docs/architecture) · [OmniMessage 协议](https://prism-shadow.github.io/penguin-harness/docs/omni-message) · [接口契约](https://prism-shadow.github.io/penguin-harness/docs/interfaces) · [Agent 运行循环](https://prism-shadow.github.io/penguin-harness/docs/agent-loop) · [CLI 参考](https://prism-shadow.github.io/penguin-harness/docs/cli) · [Server API](https://prism-shadow.github.io/penguin-harness/docs/server-api) · [配置参考](https://prism-shadow.github.io/penguin-harness/docs/configuration)

每页文档都带「复制 Markdown」按钮,可直接粘贴进模型上下文。

## 本地开发

```bash
pnpm install
pnpm build       # 先构建:core 的导出指向 dist/
pnpm typecheck
pnpm test

pnpm dev:server  # 服务端 127.0.0.1:7364
pnpm dev:web     # Web App(Vite)127.0.0.1:7365,/api 代理到服务端
pnpm dev:docs    # 文档站(Vite)127.0.0.1:7367

BASE_PATH=/ pnpm build:site   # 按 Pages 部署的方式组装 落地页 + 文档
```

开发态模型凭据可复制 `.env.example` 为 `.env` 填写。E2E 测试走真实模型(`pnpm test:e2e`,需要 `DEEPSEEK_API_KEY`)。

## 许可证

[Apache-2.0](LICENSE) © 2026 Prism Shadow
