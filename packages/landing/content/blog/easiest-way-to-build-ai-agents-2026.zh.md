---
title: "2026 年构建 AI Agent 最简单的方式"
date: 2026-07-22
category: practice
excerpt: 今天写一个 Agent 只要十行。成本转移了——转移到了它周围那一整套技术栈上：构建、观测、评估分属两三家厂商的三个独立产品。本文算一算这笔学习成本，并论证另一条路：把它自动化掉，而不是付掉。
---

问"构建 AI Agent 最简单的方式是什么"，得到的回答通常关于代码行数。这类回答如今基本已经过时：主流工具包都能在四到十五行内跑起一个可用的 Agent。

**成本没有消失，它只是转移了。** 它现在坐落在 Agent *周围*的一切之中——编排层、观测平台、评估体系——每一个都是独立产品，有独立的概念、独立的文档，往往还有独立的厂商。**写 Agent 是一个下午的事，学会这套栈是一个季度的事。**

这篇文章讲的就是这笔成本，以及如何把它去掉，而不是付掉。

## 一、"用 LangChain 构建 Agent"的真实代价

LangChain 是合理的默认选择，也是这个领域使用最广的方案，因此拿它举例最公道。要把一个 Agent 从原型推到能上生产，你需要拼装的是：

| 层次 | 你要用的东西 | 出品方 | 你必须学会的东西 |
| --- | --- | --- | --- |
| 构建 | **LangChain** | LangChain Inc. | 工具、模型、`create_agent` |
| 编排 | **LangGraph** | LangChain Inc. | 节点、边、状态、检查点、interrupt |
| 观测 | **LangSmith** 或 **Langfuse** | LangChain Inc. / Langfuse | 接入追踪 SDK 与托管平台，或用 OpenTelemetry 加自建部署 |
| 评估 | LangSmith 评估或 Langfuse 评估 | 同上 | 数据集、评判器、实验配置 |
| 部署 | **LangGraph Platform** | LangChain Inc. | 又一套部署模型 |

这里每一个都是好产品，问题不在于此。**问题在于它们是五个产品。**

观测这一行最扎手，因为它不是一个步骤，而是一个岔路口。LangSmith 是 LangChain 自家的商业平台，原生集成、接入最省事，但你也就此依赖上了一个托管 SaaS。[Langfuse](https://github.com/langfuse/langfuse) 是开源替代品：除企业版目录外采用 MIT 协议，与框架无关，可用 Docker 或 Kubernetes 自建，其团队已于 2026 年 1 月加入 ClickHouse。它确实非常优秀，但它同时也是**第二家厂商、第二套数据模型，以及一个你从此要运维的服务**。

于是，在你的 Agent 在生产环境里做成任何一件有用的事情之前，团队里已经有人学完了两个库、接好了一个追踪 SDK、订阅或自建了一个观测平台，并手工攒出了一套评估数据集。而当 Agent 表现不佳时，还是这个人去读 trace、调提示词——**因为这套栈里没有任何东西会替你做这一步。**

**这才是"2026 年构建 Agent 有多难"的真实答案。不是那十行，是那一个季度。**

## 二、2026 年 7 月的战场实况

五个覆盖设计空间的代表。数据均于 2026-07-22 核对。

| 工具 | 协议 | ★ | 最少代码 | UI / CLI / 服务 | 观测 | 评估 |
| --- | --- | ---: | --- | --- | --- | --- |
| LangChain + LangGraph | MIT | 142k / 38k | 约 15 行 | — / — / Platform | LangSmith 或 Langfuse | LangSmith 或 Langfuse |
| CrewAI | MIT | 56k | 5 个文件约 55 行 | — / 脚手架 / — | `verbose` 日志 | — |
| OpenAI Agents SDK | MIT | 28k | 约 27 行 | — / — / — | 官方 Dashboard | — |
| Google ADK | Apache-2.0 | 21k | 约 8 行 | `adk web` / `adk run` / `adk api_server` | — | 内置，且很深 |
| Dify | 修改版 Apache-2.0 | 150k | **0** | 有 / 有 / REST | — | — |
| **PenguinHarness** | Apache-2.0 | — | **0** | **有 / 有 / 有** | **内置（Trace）** | **内置** |

代码行数取自各项目官方 quickstart，彼此并不完全可比。空白格表示**我们核查的资料中未记载**，而非"做不到"。

关于协议补一句，因为"开源"这个词在这个市场里承担了过多含义：Dify 采用**修改版** Apache 2.0，禁止多租户 SaaS 转售，也禁止移除其品牌标识；而 n8n——这个领域星标最高的项目，197k——使用 Sustainable Use License，**根本不是开源**。PenguinHarness 是标准 Apache-2.0。

## 三、这个领域已经承认："薄"赢了

如今反对重型 Agent 框架最有力的论证，来自厂商自己。

Anthropic 的工程指南（至今仍是他们的权威参考）认为：**最成功的实现并没有使用复杂框架或专用库，而是用简单、可组合的模式搭起来的**；这类框架往往制造额外的抽象层，遮蔽底层的提示词与响应，让调试更困难。

微软自家 Agent Framework 文档的开篇，写着一句多数厂商不会印出来的话：**如果一个函数就能搞定，那就写函数，别用 AI Agent。**

而 AutoGen——多智能体框架中星标仍然最高的，60k——现在 README 开头写着：**本项目已进入维护模式，不再接受新特性或增强，后续由社区管理。**

LangChain 自己也把遗留的 chain、retriever 和 hub 模块移进了独立的 `langchain-classic` 包，以保持核心"精简、专注"。与此同时，"harness"成了行业词汇：大约两个月内，AWS 把 Agent 仓库改名为 `harness-sdk`，微软在 Agent Framework 中推出 Harness 层，Anthropic 发表了《A harness for every task》。

这个品类没有死，它只是在承认：**有价值的从来不是那些抽象**——这也让第一节里那笔拼装成本更加难以自圆其说。

## 四、PenguinHarness：一次安装，且不用再学

我们的答案不是"更薄的框架"，而是**取消拼装这一步，然后把调优这个循环也自动化掉**。

### 4.1 那几层，本来就是同一个产品

一次安装就得到第一张表里的全部五行，共享同一份数据目录与同一套消息协议：

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web        # http://127.0.0.1:7364 — 首次登录：admin / penguin-2026
```

多会话对话、Agent 与技能管理、模型配置、用量与成本统计、**Trace 可观测**、**评测中心**——开箱即有、彼此已经打通，**不需要订阅什么，也不需要另外自建什么**。每个请求、每次工具调用、每个审批决策都已被记录，会话可由其 Trace 完整恢复。**这里没有追踪 SDK 要装，因为压根不存在需要跨越的接缝。**

### 4.2 是零行，不是更少的行

```bash
penguin run -m "分析 data.csv 并总结季度销售情况"
```

没有工程、没有 import、没有框架。同一套引擎还驱动 REPL（`penguin chat`）、无头服务（`penguin server`）和 Web App。

### 4.3 让 Agent 构建你的 Agent

你描述想要什么，由一个 Agent 撰写它的 `AGENTS.md`、安装所需技能，并交给你一个能跑的东西。一句话产出过一个完整的 RAG 应用——摄取、检索、带引用的来源、Web UI——在 DeepSeek V4 Pro 上 token 花费 **$0.02**。[可运行示例](https://github.com/Prism-Shadow/penguin-harness/tree/main/examples/build-agent-with-agent)是一个 82 行脚本：从一句自然语言需求构建出新 Agent，然后运行它。

它之所以成立，是因为 **Agent 是可编辑的数据，不是硬编码的常量**——提示词、技能与配置都是磁盘上的普通文件。

### 4.4 调优循环也被自动化了

这一节正面回答第一节最后那段。内置的基准设计、评测与优化技能，让 Agent 给自己的输出打分、定位失分点、发布第 N+1 版——每轮之前留快照，每个请求都可在 Trace 视图回放。

在别的技术栈上，**优化器是你**：你读 trace、你调提示词、你重跑评估。**在这里，这个循环是 Agent 的工作。你不需要再把自己训练成这方面的专家。**

### 4.5 管控没有因此消失

每次工具调用恰好触发一次审批决策，四种模式——全部允许、全部拒绝、只读放行、每次询问——且每个决策都写入 Trace 审计。完全本地运行，单核 CPU 即可；通过任意 OpenAI 协议端点触达 1000+ 模型。

## 五、什么时候**不该**用 PenguinHarness

一份每一行都自己赢的对比是广告，不是分析。我们有好几行是输的。

- **把 Agent 嵌进既有应用。** 要在 Django 服务或 Next.js 路由里塞一个 Agent，请用为此设计的库——Pydantic AI 和 Vercel AI SDK 都很出色，LangChain 的生态广度也确实难以匹敌。
- **Python 团队。** 我们的 SDK 是 TypeScript。CLI 与服务端与语言无关，但希望继承扩展类的 Python 团队在别处会更顺手。
- **真正是图结构的问题。** 如果你确实需要在带检查点的状态上做条件路由，LangGraph 和 ADK 对此建模更明确。我们提供子 Agent 且刻意限制深度为 1——因为多数委派并不是一张图。
- **深度绑定云厂商。** 在 Azure 上，Microsoft Agent Framework 阻力最小；在 Vertex 上，是 ADK。

## 六、一句话版本

**构建 Agent 已经不是难的部分了，拼装并学会它周围那套栈才是**——而在最流行的那个选项上，这意味着两个库、一个一方或三方的观测平台、一套评估体系，外加一个把自己变成优化循环的人。

PenguinHarness 把这些收进一次安装，然后**把优化循环交给 Agent 自己**。

不是最小的框架——**而是没有框架、有一个来写 Agent 的 Agent，以及没有什么再需要你去学。**

---

- **文档**：[快速开始](https://penguin.ooo/docs/quickstart) · [Skills](https://penguin.ooo/docs/skills) · [会话与 Trace](https://penguin.ooo/docs/sessions-and-traces)
- **社区**：[GitHub](https://github.com/Prism-Shadow/penguin-harness) · [Discord](https://discord.gg/eFHKqqcU3D)

**参考来源**（数据均于 2026-07-22 核对）：[LangChain v1 发布说明](https://docs.langchain.com/oss/python/releases/langchain-v1) · [Langfuse](https://github.com/langfuse/langfuse) · [AutoGen README](https://github.com/microsoft/autogen) · [Microsoft Agent Framework](https://learn.microsoft.com/en-us/agent-framework/overview/) · [Google ADK](https://adk.dev/) · [CrewAI](https://docs.crewai.com/en/quickstart) · [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/quickstart/) · [Dify LICENSE](https://github.com/langgenius/dify/blob/main/LICENSE) · [n8n LICENSE](https://github.com/n8n-io/n8n/blob/master/LICENSE.md) · [Anthropic, Building Effective AI Agents](https://www.anthropic.com/engineering/building-effective-agents)
