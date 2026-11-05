---
title: PenguinHarness 正式发布：让 Agent 为你构建 Agent
date: 2026-07-17
category: news
pinned: true
excerpt: 我们在 GDPevo Benchmark 中验证了 Agent 可以自我进化，现在把这项能力带给所有人：一个支持递归自我进化的开源 Harness，从一句话构建 Agent，到持续自我进化，全部覆盖。
---

> 本文基于 PenguinHarness 0.1.0 撰写，之后的版本在部分细节上可能有所不同。

今天，我们正式发布 **PenguinHarness**，一个用于构建和进化 Agent 的开源 Harness，提供零代码的 CLI 与 Web App，可以连接 1000+ 模型。背后的理念一句话就能说清：

> 使用 LangChain，以 1 倍速度人工构建 Agent；使用 PenguinHarness，以 100 倍速度用 Agent 构建 Agent。

## 我们为什么做 PenguinHarness

在 PenguinHarness 之前，我们团队发布了 [GDPevo Benchmark](https://prism-shadow.github.io/GDPevo/)。在 GDPevo 中，我们系统地验证了一件事：**Agent 可以自我进化**。Agent 能给自己的表现打分，找出失分的地方，改写自己的提示词和 Skill，分数随版本一路上升。

能力验证了，问题就变成怎么让每个人都用上它。自我进化不该只是论文里的一条曲线，而应该是每个开发者开箱即用的基础设施。让每个人都用上高效的自我进化 Harness，就是我们做 PenguinHarness 的原因，这个目标也写在名字里：Efficient Self-Improving Harness for Everyone。

## 复杂任务表现更好，成本更低

PenguinHarness 在干净的底层接口上刻意只提供一套精简的工具集，所以工具调用更少，Token 消耗也更少。它还针对 DeepSeek 等开放模型做了深度适配。

我们在两套题库上把它和 Claude Code、OpenAI Codex 正面对比。每个 Harness 都搭配它平时常用的模型，比的是大家实际会怎么用。

![Benchmark 结果：PenguinHarness 在数据分析题库上准确率最高，编程题库与 OpenAI Codex 持平，成本只是两个对手的零头](/blog-assets/benchmark-light.svg)

### 复杂数据分析

15 题，每题运行一次。PenguinHarness 与 OpenAI Codex 的思考等级为 `xhigh`，Claude Code 为 `max`。

| 实验框架       | 模型名称        | 准确率（%） | Token 用量（M） | 成本（$） |
| -------------- | --------------- | ----------: | --------------: | --------: |
| PenguinHarness | DeepSeek V4 Pro |       66.67 |           18.04 |      0.55 |
| Claude Code    | Claude Opus 4.8 |       53.33 |           22.20 |     38.48 |
| OpenAI Codex   | GPT-5.5         |       53.33 |           13.72 |     19.41 |

### 编程

40 题 × 2 次运行，准确率按全部 80 次结果计算。

| 实验框架       | 模型名称        | 准确率（%） | Token 用量（M） | 成本（$） |
| -------------- | --------------- | ----------: | --------------: | --------: |
| PenguinHarness | DeepSeek V4 Pro |       71.25 |          200.00 |      3.81 |
| Claude Code    | Claude Opus 4.8 |       86.25 |          151.61 |    146.97 |
| OpenAI Codex   | GPT-5.5         |       71.25 |          251.20 |    220.08 |

Token 与成本都是整套题库的合计，不是单次运行的均值。数据分析题库上，PenguinHarness 的准确率在三者中最高，为 66.67%，另外两家都是 53.33%，花的钱却只有 Codex 的 1/35、Claude Code 的 1/70。编程题库上，它与 Codex 同为 71.25%，低于 Claude Code 的 86.25%，但整套题只花了 $3.81，Codex 和 Claude Code 分别花了 $220.08 和 $146.97。活干得差不多，账单差出一到两个数量级。

## 一句话构建 Agent 应用

输入一句话，Agent 就能为你从头到尾构建一个完整的 Agent 应用，包括脚手架、代码和运行说明。例如：

```text
收集 https://github.com/ericbuess/claude-code-docs 的文档，做一个化身 Claude Code 配置专家、回答带来源引用的 RAG 问答应用。
```

做出来的成品是一个文档专家：检索增强，引用可点击直达原文，还内置了示例问题。

![生成的 RAG 应用：Claude Code 配置专家，回答带可点击的来源引用与示例问题](/blog-assets/rag-app-zh-light.webp)

生成整个 RAG 应用消耗了 0.2 元（$0.02）的 Token，使用的模型是 DeepSeek V4 Pro。

## 自我进化：越用越强

借助 PenguinHarness 的 Skill，Agent 自己评估、自己优化。每一轮：

1. Optimizer 并行调度多个 Evaluator，给 Agent 打分。
2. Optimizer 根据分数和运行 Trace，定位失分原因。
3. Optimizer 把 Agent 从版本 N 优化到版本 N+1。

每轮开始前都会自动快照，每个请求都能在**轨迹观测**页面回放。自我进化的演示视频即将上线。

## 进化有界，安全先行

自我进化最大的顾虑是失控。PenguinHarness 用一份契约（CONTRACT.md）回答这个问题：

- 进化严格限制在 Workspace 与 Skill 之内。Harness 核心是安全边界，从不修改。
- 工具调用先经审批，每次审批都留有审计记录。
- 有风险的修改之前先留版本快照，任何一轮进化都可以回滚。
- PenguinHarness 完全开源、本地部署。除了发往你配置的模型供应商的请求，数据都留在你的机器上，满足企业级数据安全要求。

## 支持的模型

PenguinHarness 为以下模型提供了预置配置：

| 模型             | 可用供应商                                                                       |
| ---------------- | -------------------------------------------------------------------------------- |
| DeepSeek V4      | DeepSeek、OpenRouter、Fireworks AI、SiliconFlow、Qwen Token Plan                 |
| Kimi K3          | Moonshot AI、OpenRouter、Qwen Pay-As-You-Go                                      |
| GLM 5.2          | Z.AI、OpenRouter、Fireworks AI、SiliconFlow、Qwen Token Plan、Qwen Pay-As-You-Go |
| Hunyuan 3        | OpenRouter                                                                       |
| Qwen 3.8 Max     | Qwen Token Plan（预览）                                                          |
| GPT 5.5          | OpenAI、OpenRouter                                                               |
| Gemini 3.5 Flash | Google Gemini、OpenRouter                                                        |
| Claude Opus 4.8  | Anthropic、OpenRouter                                                            |

任何 OpenAI 协议的端点都能接入：从上表选择预置，或者用自定义端点连接 1000+ 在线与本地模型中的任意一个。

## 发展计划

- Benchmark 套件正式公开
- 推出桌面应用
- 支持 Windows

## 加入社区

会自我进化的 Harness，也需要一个一起进化的社区。欢迎加入讨论、提出需求、贡献代码，提交你的第一个 Issue 就是很好的开始。

- [Discord](https://discord.gg/eFHKqqcU3D)：与我们和其他开发者实时交流。
- [X（Twitter）](https://x.com/code_hiyouga)：关注最新动态。
- [微信群](https://github.com/Prism-Shadow/penguin-harness-community/blob/main/wechat/group.jpg)：中文社区讨论。
- [GitHub](https://github.com/Prism-Shadow/penguin-harness)：Star、Issue 和 PR 都欢迎。

## 快速开始

1. 用一条命令安装 PenguinHarness，然后启动 Web App。安装脚本支持 Linux 与 macOS（x64 / arm64），内嵌 Node 运行时。

   ```bash
   curl -fsSL https://penguin.ooo/install.sh | sh
   penguin web        # 打开 http://127.0.0.1:7364（首次登录：admin / penguin-2026，登录页上也有提示）
   ```

2. 打开**模型仓库**页面，在 DeepSeek 或 OpenRouter 分组里填入 API key，把组里的一个模型设为默认。
3. 回到**对话**页面，把第一个任务交给 Agent，例如「分析 data.csv，输出各季度销售额汇总」。
