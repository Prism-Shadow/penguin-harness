---
title: "2026 年构建 AI Agent 最简单的方式"
date: 2026-07-22
category: practice
excerpt: 今天写一个 Agent 只要十几行。成本没有消失，只是换了地方——挪到了它外面那一圈：构建、观测、评估分属两三家厂商的独立产品。本文算一算这笔学习成本，再说说另一条路：把它自动化掉，而不是老老实实付掉。
---

问"构建 AI Agent 最简单的方式是什么"，多数答案都在比代码行数。这个比法今天已经没什么意义了：主流工具包写十几行就能跑起一个可用的 Agent。

**成本没有消失，只是换了地方。** 它挪到了 Agent 外面那一圈：编排层、观测平台、评估体系。每一样都是独立的产品，各有各的概念、各有各的文档，甚至各有各的厂商。**写一个 Agent 是一下午的事，把这套栈学明白是一个季度的事。**

这篇文章就来算这笔账，再说说怎么把它去掉，而不是老老实实付掉。

## 一、用 LangChain 做一个 Agent，代价到底是什么

LangChain 是这个领域用得最多的方案，也是多数团队的默认选项，拿它举例最公道。要把一个 Agent 从原型推到能上生产，你得拼出这么一套：

| 层次 | 你要用的东西 | 出品方 | 你必须学会的东西 |
| --- | --- | --- | --- |
| 构建 | **LangChain** | LangChain Inc. | 工具、模型、`create_agent` |
| 编排 | **LangGraph** | LangChain Inc. | 节点、边、状态、检查点、interrupt |
| 观测 | **LangSmith** 或 **Langfuse** | LangChain Inc. / Langfuse | 接追踪 SDK 加托管平台，或者上 OpenTelemetry 加自建部署 |
| 评估 | LangSmith 评估或 Langfuse 评估 | 同上 | 数据集、评判器、实验配置 |
| 部署 | **LangGraph Platform** | LangChain Inc. | 又一套部署模型 |

这五样单拿出来都是好东西，问题不在这儿。**问题在于它们是五样东西。**

最难受的是"观测"这一行。它不是一个步骤，而是一道岔路。LangSmith 是 LangChain 自家的商业平台，原生集成，接入最省事，代价是你从此绑在一个托管 SaaS 上。[Langfuse](https://github.com/langfuse/langfuse) 是开源的那条路：除企业版目录外采用 MIT 协议，不绑定框架，可以用 Docker 或 Kubernetes 自建，团队已在 2026 年 1 月加入 ClickHouse。它确实做得很好，但它同时也意味着**多一家厂商、多一套数据模型，以及一个从此要你自己运维的服务**。

于是，在这个 Agent 于生产环境里做成第一件有用的事之前，团队里已经有人学完了两个库、接好了追踪 SDK、订阅或自建了一个观测平台，还手工攒出了一套评估数据集。等到 Agent 表现不好，还是这个人去读 trace、改提示词。**因为这套栈里没有任何一环会替你做这件事。**

**这才是"2026 年构建 Agent 有多难"的真实答案。不是那十几行，是那一个季度。**

## 二、2026 年 7 月的战场实况

五个覆盖设计空间的代表。数据均于 2026-07-22 核对。

| 工具 | 协议 | ★ | 最少代码 | UI / CLI / 服务 | 观测 | 评估 |
| --- | --- | ---: | --- | --- | --- | --- |
| LangChain + LangGraph | MIT | 142k / 38k | 约 15 行 | — / — / Platform | LangSmith 或 Langfuse | LangSmith 或 Langfuse |
| CrewAI | MIT | 56k | 5 个文件约 55 行 | — / 脚手架 / — | `verbose` 日志 | — |
| OpenAI Agents SDK | MIT | 28k | 约 27 行 | — / — / — | 官方 Dashboard | — |
| Google ADK | Apache-2.0 | 21k | 约 8 行 | `adk web` / `adk run` / `adk api_server` | — | 内置，且做得很深 |
| Dify | 修改版 Apache-2.0 | 150k | **0** | 有 / 有 / REST | — | — |
| **PenguinHarness** | Apache-2.0 | — | **0** | **有 / 有 / 有** | **内置（Trace）** | **内置** |

代码行数取自各项目官方 quickstart，彼此并不完全可比。空白格的意思是**我们查到的资料里没有写**，不是"做不到"。

关于协议还得补一句，因为"开源"这个词在这个市场里被用得太宽。Dify 用的是**修改版** Apache 2.0，禁止多租户 SaaS 转售，也禁止把前端的品牌标识去掉；n8n 是这个领域星标最高的项目，197k，但它用的是 Sustainable Use License，**根本算不上开源**。PenguinHarness 是标准 Apache-2.0。

## 三、这个领域自己已经承认：薄的那一方赢了

今天反对重型 Agent 框架最有力的说法，恰恰来自厂商自己。

Anthropic 的工程指南至今仍是他们的权威参考，其中写道：**最成功的落地案例都没有用复杂框架或专用库，而是用简单、可组合的模式搭起来的**；这类框架往往多加一层抽象，把底层的提示词和响应挡在后面，反而更难调试。

微软自家 Agent Framework 文档的开篇，摆着一句多数厂商不会印出来的话：**一个函数能搞定的事，就写函数，别上 AI Agent。**

而 AutoGen，多智能体框架里星标依然最高的那个（60k），现在 README 第一段就写着：**本项目已进入维护模式，不再接受新特性或增强，后续由社区管理。**

LangChain 自己也把遗留的 chain、retriever 和 hub 模块挪进了独立的 `langchain-classic` 包，好让核心"精简、专注"。与此同时，"harness"成了行业通用词：两个月左右的时间里，AWS 把 Agent 仓库改名叫 `harness-sdk`，微软在 Agent Framework 里加了一层 Harness，Anthropic 发了一篇《A harness for every task》。

这个品类没有死，它只是承认了一件事：**真正有价值的从来不是那些抽象**。而这也让第一节那笔拼装成本更难自圆其说。

## 四、PenguinHarness：装一次，然后不用再学

我们的答案不是"做一个更薄的框架"，而是**把拼装这一步取消掉，再把调优那个循环也自动化掉**。

### 4.1 那几层，本来就该是同一个产品

装一次，第一张表里的五行就都有了，而且共用同一份数据目录、同一套消息协议：

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web        # http://127.0.0.1:7364 — 首次登录：admin / penguin-2026
```

多会话对话、Agent 与技能管理、模型配置、用量与成本统计、**Trace 可观测**、**评测中心**，开箱即有，彼此已经打通，**不用订阅什么，也不用另外自建什么**。每个请求、每次工具调用、每个审批决策都已经记下来了，会话可以从 Trace 完整恢复。**这里没有追踪 SDK 要接，因为根本不存在需要跨越的接缝。**

### 4.2 是零行，不是"更少的行"

```bash
penguin run -m "分析 data.csv 并总结季度销售情况"
```

不用建工程，不用写 import，也没有框架要学。同一套引擎还驱动着 REPL（`penguin chat`）、无头服务（`penguin server`）和 Web App。

### 4.3 让 Agent 来写你的 Agent

你把想要的东西描述出来，剩下的交给一个 Agent：它来写目标 Agent 的 `AGENTS.md`，装好需要的技能，最后把一个能跑的成品交给你。我们用一句话生成过一个完整的 RAG 应用——文档摄取、检索、带出处的引用、Web 界面一应俱全，在 DeepSeek V4 Pro 上的 token 成本是 **$0.02**。[可运行示例](https://github.com/Prism-Shadow/penguin-harness/tree/main/examples/build-agent-with-agent)是一个 82 行的脚本：从一句自然语言需求造出新 Agent，然后跑起来验证它。

这件事能成立，靠的是一条设计原则：**Agent 是可编辑的数据，不是硬编码的常量**。提示词、技能、配置，全都是磁盘上的普通文件。

### 4.4 连调优的循环也自动化了

这一节正面回应第一节结尾那个问题。内置的基准设计、评测与优化技能，让 Agent 自己给输出打分、找出失分在哪，然后发布第 N+1 版。每一轮开始前留快照，每个请求都能在 Trace 视图里回放。

在别的技术栈上，**那个优化器就是你本人**：你读 trace，你改提示词，你重跑评估。**在这里，这个循环归 Agent 管，你不必再把自己练成这方面的老手。**

### 4.5 管控并没有因此消失

每次工具调用恰好触发一次审批决策，四种模式可选：全部允许、全部拒绝、只读放行、每次询问，每个决策都写进 Trace 留档。整套东西完全本地运行，单核 CPU 也带得动；通过任意 OpenAI 协议端点接得上 1000+ 模型。

## 五、什么时候**不该**用 PenguinHarness

一份每一行都自己赢的对比是广告，不是分析。有两种情况，你该选别的：

- **团队写 Python。** 我们的 SDK 是 TypeScript。CLI 和服务端与语言无关，但如果你的团队习惯在 Python 里继承、扩展这些类，上表里的多数选项都会更顺手。
- **深度绑定某一家云。** 已经全面押注 Azure 的话，Microsoft Agent Framework 阻力最小；如果是 Vertex，那就是 ADK。

## 六、小结

**难的早就不是构建 Agent 本身，而是把它周围那套栈拼起来、学明白。** 在最流行的那个选项上，这意味着两个库、一个自家或第三方的观测平台、一套评估体系，外加一个人肉充当的优化循环。

PenguinHarness 把这些收进一次安装，然后**把优化循环交给 Agent 自己**。

我们做的不是最小的框架。**是没有框架，有一个替你写 Agent 的 Agent，以及一份不再需要你去学的清单。**

---

- **文档**：[快速开始](https://penguin.ooo/docs/quickstart) · [Skills](https://penguin.ooo/docs/skills) · [会话与 Trace](https://penguin.ooo/docs/sessions-and-traces)
- **社区**：[GitHub](https://github.com/Prism-Shadow/penguin-harness) · [Discord](https://discord.gg/eFHKqqcU3D)

**参考来源**（数据均于 2026-07-22 核对）：[LangChain v1 发布说明](https://docs.langchain.com/oss/python/releases/langchain-v1) · [Langfuse](https://github.com/langfuse/langfuse) · [AutoGen README](https://github.com/microsoft/autogen) · [Microsoft Agent Framework](https://learn.microsoft.com/en-us/agent-framework/overview/) · [Google ADK](https://adk.dev/) · [CrewAI](https://docs.crewai.com/en/quickstart) · [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/quickstart/) · [Dify LICENSE](https://github.com/langgenius/dify/blob/main/LICENSE) · [n8n LICENSE](https://github.com/n8n-io/n8n/blob/master/LICENSE.md) · [Anthropic, Building Effective AI Agents](https://www.anthropic.com/engineering/building-effective-agents)
