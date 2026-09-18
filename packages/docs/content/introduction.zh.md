---
title: 产品介绍
description: PenguinHarness 是什么，它由哪些部分组成，以及从哪里开始。
---

欢迎阅读 PenguinHarness 文档。PenguinHarness 是一个开源的 Agent Harness，用来构建、运行、评估和持续改进 AI Agent，整体是一套 TypeScript 技术栈。它完全本地部署，存储的一切都留在你的机器上；最低一颗 CPU 即可运行，通过统一的模型网关可以接入 1000+ 在线与本地模型。

## 开始使用

建议按顺序阅读下面这些页面：

1. [快速开始](/quickstart)：用桌面应用、CLI、Docker 或 SDK 安装 PenguinHarness，跑通第一个 Task。
2. [核心概念](/concepts)：了解文档里用到的术语，例如 Project、Session、Task 和 Workspace。
3. [对话](/chat)：在对话中与 Agent 协作，随时看到它在做什么。
4. [Agent](/agents)：创建 Agent，配置它的提示词、Skill、记忆和工具。
5. [评估中心](/evaluation-center)：用 Benchmark 衡量 Agent 的表现，并加以改进。

## 产品组成

PenguinHarness 由下面这些组件构成。它们共用同一个数据目录和同一套消息协议，因此可以自由混用。

| 组件 | 包名 | 说明 |
| --- | --- | --- |
| SDK | `@prismshadow/penguin-core` | 核心引擎：ReAct 循环、[OmniMessage 协议](/omni-message)、LLM 与 Environment 的[接口契约](/interfaces)、Agent State 与 Trace。 |
| CLI | `@prismshadow/penguin-cli` | `penguin` 命令：交互式 REPL、单次 Task 运行，以及模型与 Vault 配置。 |
| Server | `@prismshadow/penguin-server` | Web 服务端：HTTP [API 与 SSE 流式通道](/server-api)、多用户认证、Project 授权和用量统计。 |
| Web App | `@prismshadow/penguin-web` | 浏览器界面：多会话对话、Agent 管理、插件库、模型配置、Trace 观测和评估中心。 |
| 桌面应用 | `@prismshadow/penguin-desktop` | 把 Web App 做成独立应用，支持 macOS、Windows 和 Linux。它内嵌服务端，并会装好 `penguin` 命令。 |

## 三大支柱

PenguinHarness 可以用一句话概括：**Efficient Self-Improving Harness for Everyone**。它围绕三个概念展开，即消息协议、SDK 和技能库，每个概念支撑一个支柱：

| 支柱 | 含义 |
| --- | --- |
| **Simplest Is the Best** | 在干净的底层接口之上刻意保持极简的工具集：更少的工具调用、更少的 Token，高效完成复杂任务。 |
| **Harness for Building Agents** | 借助 PenguinHarness SDK，由 Agent 从零开始为你自主构建完整的 Agent 应用。 |
| **Harness for Recursive Self-Improvement** | 借助 PenguinHarness Skills，Agent 评估并优化自己，随着时间递归进化。 |

## 设计信条

这些原则贯穿所有组件，设计文档也会反复提到它们：

- **极简工具集**：专门的文件工具（`read_file` / `edit_file` / `write_file`）负责精确读写，其余一切由 shell（`exec_command`）兜底。见[工具与审批](/tools)。
- **Agent 是可编辑的数据**：提示词、Skill 和配置都是磁盘上可编辑的文件，而不是硬编码的常量。你能看到的，Agent 就能改进。见[配置参考](/configuration)。
- **一切可观测**：每一次请求、工具调用和审批决定都会追加写入 [Trace](/sessions-and-traces)，Session 可以从 Trace 完整恢复。
- **错误收敛为消息**：模型和工具的失败从不抛出异常，而是变成模型可以继续处理的消息。见 [Agent 运行循环](/agent-loop)。
- **流式优先**：文本逐 Token 流出，工具调用和结果实时可见。
- **模型与 Agent 解耦**：Agent 从不绑定模型，每个 Session 由你选择模型。见[模型与 Provider](/models)。

## 命名说明

统一消息协议在技术文档中称为 **OmniMessage**，产品宣传中也叫 Penguin Message。本文档一律使用 OmniMessage。

## 了解工作原理

想了解各个部分如何协作，可以从[架构总览](/architecture)开始阅读设计文档。
