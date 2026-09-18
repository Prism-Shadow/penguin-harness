---
title: "2026 年构建 AI Agent 最简单的方式"
date: 2026-07-22
category: perspectives
excerpt: 如今写一个 Agent 只要十行左右代码。成本挪到了它周边的技术栈，构建、观测、评估分属几个要各自学习的产品；本文比较这笔成本，并主张把它自动化掉。
---

> 本文基于 PenguinHarness 0.1.1 撰写，之后的版本在部分细节上可能有所不同。

衡量构建一个 AI Agent 有多难，通常的办法是数 quickstart 里的代码行数。按这个标准，问题已经解决了：主流工具包最少只要四到十五行代码，就能跑起一个可用的 Agent。

本文要回答的问题是，2026 年构建一个 Agent 的真实成本在哪里。我们的回答是，成本没有消失，只是挪到了 Agent 周边的技术栈里。更好的做法是把这笔组装成本去掉，而不是老老实实付掉。下文会讲清楚这笔成本在最流行的技术栈上是什么样子，PenguinHarness 怎样去掉它，以及什么情况下你该选别的方案。

Agent 周边的技术栈分成几个清晰的层次：编排，管理 Agent 的控制流；可观测，记录 Agent 做过什么；评估，给结果打分。每一层都是独立的产品，有自己的概念、自己的文档，往往还有自己的厂商。写 Agent 只要一个下午，学这套技术栈却要一个季度。

## 生产级 Agent 技术栈要付出什么

在最流行的技术栈上，一个生产级 Agent 意味着要学习、运行五个独立的产品。LangChain 是这个领域合理的默认选项，用的人也最多，拿它举例最公道。要把 Agent 从原型推到能上生产，你得拼出下面这一套：

| 层次 | 用什么 | 出品方 | 要学什么 |
| --- | --- | --- | --- |
| 构建 | LangChain | LangChain Inc. | 工具、模型、`create_agent` |
| 编排 | LangGraph | LangChain Inc. | 节点、边、状态、检查点、中断 |
| 观测 | LangSmith 或 Langfuse | LangChain Inc. / Langfuse | 接入追踪 SDK 加托管平台，或者 OpenTelemetry 加自建部署 |
| 评估 | LangSmith 评估或 Langfuse 评估 | 同上 | 数据集、评判器、实验配置 |
| 部署 | LangGraph Platform | LangChain Inc. | 又一套部署模式 |

这五样单拿出来都是好产品，问题不在这儿。问题在于它们是五个产品。

观测这一行的代价最高，因为它不是一个步骤，而是一道岔路。LangSmith 是 LangChain 自家的商业平台，原生集成。如果你已经在用这套技术栈，它是最省事的选择，代价是从此依赖一个托管 SaaS。[Langfuse](https://github.com/langfuse/langfuse) 是开源的那条路：除企业版目录外采用 MIT 许可证，不绑定框架，可以用 Docker 或 Kubernetes 自建部署，团队已在 2026 年 1 月加入 ClickHouse。在我们看来，它确实做得很好。但它也意味着多一家厂商、多一套数据模型，以及一个从此要你自己运维的服务。

所以，Agent 还没在生产环境里做成任何有用的事，团队里就已经有人学完了两个库，接好了追踪 SDK，自建或订阅了一个观测平台，还手工攒了一套评估数据集。等 Agent 表现不好，去读 trace、调提示词的还是这个人，因为这套技术栈里没有任何一环会替你做这件事。

## 2026 年 7 月的格局

下表对比了五个覆盖整个设计空间的代表性方案，PenguinHarness 列在最后一行。所有数据均于 2026-07-22 核对。

| 工具 | 许可证 | ★ | 最少代码 | UI / CLI / 服务 | 观测 | 评估 |
| --- | --- | ---: | --- | --- | --- | --- |
| LangChain + LangGraph | MIT | 142k / 38k | 约 15 行 | — / — / Platform | LangSmith（SaaS）或 Langfuse | LangSmith 或 Langfuse |
| CrewAI | MIT | 56k | 约 55 行，5 个文件 | — / 脚手架 / — | `verbose` 日志 | — |
| OpenAI Agents SDK | MIT | 28k | 约 27 行 | — / — / — | OpenAI Dashboard | — |
| Google ADK | Apache-2.0 | 21k | 约 8 行 | `adk web` / `adk run` / `adk api_server` | — | 内置，且做得很深 |
| Dify | 修改版 Apache-2.0 | 150k | 0 | 有 / 有 / REST | — | — |
| PenguinHarness | Apache-2.0 | — | 0 | 有 / 有 / 有 | 内置（Trace） | 内置 |

代码行数取自各项目官方的 quickstart，彼此并不完全可比。破折号（—）表示「我们查到的资料里没有写」，不是「做不到」。

关于许可证还得补一句，因为「开源」这个词在这个市场里用得太宽。Dify 用的是**修改版** Apache 2.0 许可证，禁止多租户 SaaS 转售，也禁止把前端的品牌标识去掉。n8n 是这个领域星标最多的项目，有 197k，但它用的是 Sustainable Use License，根本算不上开源。PenguinHarness 是标准的 Apache-2.0。

## 行业正在转向轻量 Harness

反对重型 Agent 框架最有力的说法，如今恰恰来自厂商自己。

Anthropic 的工程指南至今仍是他们的权威参考，里面写道：

> 「最成功的落地案例都没有用复杂框架或专用库，而是用简单、可组合的模式搭起来的。」

同一份指南还提醒，框架往往多加一层抽象，把底层的提示词和响应挡在后面，让 Agent 更难调试。

微软自家 Agent Framework 文档的开篇，摆着一句多数厂商不会印出来的话：

> 「如果能写一个函数来完成这个任务，那就写函数，不要用 AI Agent。」

AutoGen 以 60k 星标仍是星标最多的多 Agent 框架，它的 README 现在第一段就写着：

> 「AutoGen 已进入维护模式，不再添加新功能或增强，今后由社区管理。」

LangChain 自己也把遗留的 chain、retriever 和 hub 模块挪进了独立的 `langchain-classic` 包，好让核心「精简、专注」。与此同时，「Harness」成了行业通用词。大约两个月里，AWS 把 Agent 仓库改名为 `harness-sdk`，微软在 Agent Framework 里推出了 Harness 一档，Anthropic 发表了《A harness for every task》。

这个品类没有死，它只是承认了一件事：真正有价值的从来不是那些抽象。这样一来，上文那笔组装成本就更说不过去了。

## PenguinHarness 去掉了什么，又自动化了什么

PenguinHarness 给出的答案不是一个更薄的框架。它先去掉组装这一步，再把调优循环自动化。

### 一次安装覆盖全部五层

装一次，就有了第一张表里的全部五行，它们共用同一个数据目录、同一套消息协议：

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web        # http://127.0.0.1:7364 — 首次登录：admin / penguin-2026，登录页上也有提示
```

安装后就有多会话对话、Agent 与 Skill 管理、模型配置、用量与成本统计、Trace 可观测，以及**评估中心**，彼此已经打通。不用订阅什么，也不用另外自建什么。每个请求、每次工具调用、每个审批决策都已经记录下来，会话可以从 Trace 完整恢复。这里没有追踪 SDK 要接，因为产品之间根本不存在需要埋点的接缝。

### 是零行，不是「更少的行」

运行一个 Agent，不用建工程，不用写 import，也不用框架：

```bash
penguin run -m "分析 data.csv 并总结季度销售情况"
```

同一套引擎还驱动着 REPL（`penguin chat`）、无头服务（`penguin server`）和 Web App。

### 让 Agent 来写 Agent

你把想要的东西描述出来，剩下的交给一个 Agent：它写好新 Agent 的 `AGENTS.md`，装上需要的 Skill，把一个能跑的成品交给你。我们用一句话生成过一个完整的 RAG 应用，文档摄取、检索、带出处的引用、Web 界面一应俱全，在 DeepSeek V4 Pro 上只花了 $0.02 的 Token。[可运行示例](https://github.com/Prism-Shadow/penguin-harness/tree/main/examples/build-agent-with-agent)是一个 82 行的脚本：根据一句自然语言需求构建新 Agent，然后运行它。

这件事能成立，是因为 **Agent 是可编辑的数据，不是写死的常量**：提示词、Skill 和配置都是磁盘上的普通文件。

### 调优循环也自动化了

这正好回应了 LangChain 那个例子的最后一步：由人去读 trace、调提示词。内置的 Benchmark 设计、评估与优化 Skill，让 Agent 自己给输出打分，找出丢分的地方，然后发布第 N+1 版。当前版本的快照不存在，下一轮就不会开始；每个请求都能在 Trace 视图里回放。

在别的技术栈上，优化器就是**你**自己：你读 trace，你调提示词，你重跑评估。在这里，这个循环归 Agent 管，你不必把自己练成这方面的行家。

### 管控依然都在

去掉组装这一步，不等于去掉监管。每次工具调用恰好触发一次审批决策，审批模式有四种：`allow-all`、`deny-all`、`read-only` 和 `always-ask`，每个决策都写入 Trace 留作审计。PenguinHarness 可以完全在本地运行，单个 CPU 也带得动，并能通过任意 OpenAI 协议端点接入 1000+ 模型。

## 什么时候不该用 PenguinHarness

一份每一行都是同一个选项获胜的对比是广告，不是分析。有两种情况，你该选别的：

- **团队写 Python。** PenguinHarness 的 SDK 是 TypeScript。CLI 和服务端与语言无关，但如果你的团队用 Python，还想通过继承框架里的类来扩展 Agent，上面的多数方案会更顺手。
- **深度绑定某一家云。** 已经全面押注 Azure 的话，Microsoft Agent Framework 阻力最小；如果是 Vertex，那就是 ADK。

## 结论

难的早就不是构建 Agent 本身，而是把它周边那套技术栈拼起来、学明白。在最流行的方案上，这意味着两个库、一个自家或第三方的观测平台、一套评估体系，外加一个人肉充当的优化循环。比较工具包时，要把这一整套栈都算进去，别只数 quickstart 的代码行数。

PenguinHarness 把这些层收进一次安装，再把优化循环交给 Agent。它不是一个更小的框架：根本没有框架要学，写 Agent 的也是 Agent。对以 Python 为主的团队和深度绑定云平台的场景，上面提到的替代方案仍然更合适。

---

- **文档**：[快速开始](https://penguin.ooo/docs/quickstart) · [技能与插件](https://penguin.ooo/docs/skills) · [Session 与 Trace](https://penguin.ooo/docs/sessions-and-traces)
- **社区**：[GitHub](https://github.com/Prism-Shadow/penguin-harness) · [Discord](https://discord.gg/eFHKqqcU3D)

**参考来源**（数据均于 2026-07-22 核对）：[LangChain v1 发布说明](https://docs.langchain.com/oss/python/releases/langchain-v1) · [Langfuse](https://github.com/langfuse/langfuse) · [AutoGen README](https://github.com/microsoft/autogen) · [Microsoft Agent Framework](https://learn.microsoft.com/en-us/agent-framework/overview/) · [Google ADK](https://adk.dev/) · [CrewAI](https://docs.crewai.com/en/quickstart) · [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/quickstart/) · [Dify LICENSE](https://github.com/langgenius/dify/blob/main/LICENSE) · [n8n LICENSE](https://github.com/n8n-io/n8n/blob/master/LICENSE.md) · [Anthropic, Building Effective AI Agents](https://www.anthropic.com/engineering/building-effective-agents)
