---
title: PenguinHarness 正式发布：让 Agent 为你构建 Agent
date: 2026-07-17
category: news
excerpt: 首个支持递归自我进化的开源 Harness 正式发布——以轻量、高效、安全的方式，提供从 Agent 自动构建到持续自我进化的完整基础设施。
---

今天，我们正式发布 **PenguinHarness**——一个为构建与进化 Agent 而生的开源 Harness：零代码的 Harness CLI 与 Web UI，连接 1000+ 模型。它要讲的故事只有一句话：

> 使用 LangChain，以 1 倍速度人工构建 Agent；使用 PenguinHarness，以 100 倍速度用 Agent 构建 Agent。

而它的主旨一如其名：Efficient Self-Improving Harness for Everyone.

## 为什么是 PenguinHarness

过去一年里，Agent 应用的开发范式在快速收敛：真正决定效果的不是庞大的框架，而是一个简洁、可靠、可观测的 Harness。PenguinHarness 从底层重构，不依赖任何 Agent 框架，开源自研 Harness 内核，并率先把三件事带入开源世界：

- **Simplest Is the Best**：坚持最小化工具集与简洁的底层接口，以更少的工具调用与 Token 消耗，高效完成复杂任务。
- **Harness for Building Agents**：通过 PenguinHarness SDK，让 Agent 从零自主完成 Agent 应用的构建。
- **Harness for Recursive Self-Improvement**：通过 PenguinHarness Skills，Agent 以自我评估与自我优化实现递归式自我提升。

后两项能力，PenguinHarness 是业内首个开源实现。

## 同一模型，同级效果，更低消耗

全部使用同一 DeepSeek V4 Pro 模型，与 Claude Code、OpenAI Codex 在两套题库上正面对比（表中为单次运行均值）。

复杂数据分析（15 题，单次运行）：

| 实验框架 | 模型名称 | 准确率（%） | Token 用量（M） | 成本（$） |
| --- | --- | ---: | ---: | ---: |
| PenguinHarness | DeepSeek V4 Pro | 66.7 | 18.04 | 0.552 |
| Claude Code | DeepSeek V4 Pro | 66.7 | 21.17 | 0.641 |
| OpenAI Codex | DeepSeek V4 Pro | 46.7 | 13.36 | 0.427 |

代码任务（40 题 × 2 runs 取均值，thinking high、单题 30 分钟超时，人民币计价按 $1 = ¥7 折算）：

| 实验框架 | 模型名称 | 准确率（%） | Token 用量（M） | 成本（$） |
| --- | --- | ---: | ---: | ---: |
| PenguinHarness | DeepSeek V4 Pro | 50.00 | 2.10 | 0.041 |
| Claude Code | DeepSeek V4 Pro | 48.75 | 2.00 | 0.048 |
| OpenAI Codex | DeepSeek V4 Pro | 42.50 | 2.65 | 0.043 |

数据分析套件与 Claude Code 准确率持平、显著超过 OpenAI Codex，同时 Token 消耗少 14.8%、成本低 13.8%；代码套件三者中准确率最高、单次成本最低。

## 进化有界，安全先行

自我进化最大的疑虑是失控。PenguinHarness 用一份契约（CONTRACT.md）回答这个问题：

- 进化严格限制在 Workspace 与 Skill 之内，不修改 Harness 核心安全边界；
- 工具调用先经批准，每次批准皆留审计；
- 风险修改之前先留版本快照，任何一次进化都可回退；
- 完全开源、本地部署，数据不出域，满足企业级数据安全。

## 现在就可以开始

一行命令安装（Linux / macOS，x64 / arm64，内嵌 Node 运行时）：

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
```

配置模型（以 DeepSeek 为例）后即可运行第一个任务，或用 `penguin web` 打开桌面级 Web 界面：

```bash
penguin config model add --model-id deepseek-v4-pro --api-key sk-your-key --set-default
penguin run --approve allow-all --message "分析 data.csv，输出各季度销售额汇总"
penguin web
```

PenguinHarness 支持 1000 多种在线与本地模型、多智能体协作进化，最低单 CPU 即可运行。通过不断进化，它会让复杂的 AI 开发越来越简单——为你提供更高效、更可靠、更低幻觉、更低成本的 Agent 生产力引擎。

欢迎在 [GitHub](https://github.com/Prism-Shadow/penguin-harness) 上关注我们，提出你的第一个 Issue。
