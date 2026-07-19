---
title: 产品介绍
description: PenguinHarness 是什么，它由哪些部分组成，以及它的设计信条。
---

PenguinHarness 是一个开源的 AI Agent Harness——为「构建 Agent」与「进化 Agent」而生的一整套 TypeScript 基础设施。它完全本地部署，数据不出机器，最低一颗 CPU 即可运行；通过统一的模型网关可接入 1000+ 在线与本地模型。

一句话概括：**Efficient Self-Improving Harness for Everyone.**

## 三大支柱

PenguinHarness 的能力围绕三个递进的概念展开——消息协议、SDK、技能库，分别支撑三个支柱：

| 支柱 | 含义 |
| --- | --- |
| **Simplest Is the Best** | 在干净的底层接口之上刻意保持极简的工具集：更少的工具调用、更少的 Token，高效完成复杂任务。 |
| **Harness for Building Agents** | 基于 PenguinHarness SDK，由一个 Agent 从零开始为你自主构建完整的 Agent 应用。 |
| **Harness for Recursive Self-Improvement** | 基于 PenguinHarness Skills,Agent 评估并优化自己，随时间递归进化。 |

## 产品组成

一次安装即获得完整的四层交付物，它们共享同一套数据目录与同一个消息协议：

| 组件 | 包名 | 说明 |
| --- | --- | --- |
| SDK | `@prismshadow/penguin-core` | 核心引擎：ReAct 循环、[OmniMessage 协议](/omni-message)、LLM 与 Environment [接口契约](/interfaces)、Agent State 与 Trace。 |
| CLI | `@prismshadow/penguin-cli` | 命令行 `penguin`：交互式 REPL、单次任务运行、模型与 Vault 配置。 |
| Server | `@prismshadow/penguin-server` | Web 服务端：HTTP [API 与 SSE 流式通道](/server-api)、多用户认证、Project 授权、用量统计。 |
| Web App | `@prismshadow/penguin-web` | 浏览器界面：多 Session 对话、Agent 管理、技能库、模型配置、Trace 观测与评估中心。 |

## 设计信条

这些原则贯穿所有组件，后续每一页设计文档都会反复引用：

- **极简工具集**:shell 是通用接口，文件读写与命令执行统一经 `exec_command` 完成，见[工具与审批](/tools)。
- **Agent 是可编辑的数据**:Prompt、Skill、配置都是磁盘上的可编辑文件，而非硬编码——你能看到的，Agent 就能改进，见[配置参考](/configuration)。
- **全量可观测**：每一次请求、工具调用与审批决策都以追加方式写入 [Trace](/sessions-and-traces),Session 可从 Trace 完整恢复。
- **错误收敛为消息**：模型与工具的错误不抛异常，而是变成模型可以继续处理的消息，见 [Agent 运行循环](/agent-loop)。
- **流式优先**：文本逐 Token 流出，工具调用与结果实时可见。
- **模型与 Agent 解耦**:Agent 不绑定模型，每个 Session 创建时自由选择，见[模型与 Provider](/models)。

## 命名说明

统一消息协议在技术文档中称为 **OmniMessage**(产品宣传中也叫 Penguin Message)。本文档站一律使用 OmniMessage。

## 下一步

- [安装](/installation) PenguinHarness，然后跟随[快速开始](/quickstart)跑通第一个 Task。
- 从[架构总览](/architecture)进入设计文档，理解各组件如何协作。
