---
title: "2026 年构建 AI Agent 最简单的方式"
date: 2026-07-22
category: practice
excerpt: Agent 框架领域已经悄然收敛——AutoGen 进入维护模式，LangChain 把遗留抽象移出核心，而迭代最快的工具包如今只需四到十行就能跑起一个 Agent。我们用可核对的事实横向对比五个主流选项，然后论证一条几乎没人在竞争的赛道：根本不写这个 Agent。
---

两年前，"我该怎么构建 Agent"约等于"我该学哪个框架"。到了 2026 年，这个问题基本已经自己回答了，而答案对框架并不友好：**赢家都变薄了。**

这篇文章做三件事：摆出五个最常用选项今天的真实状况，附上可核对的版本与数字；指出这个领域已经形成的共识——包括好几家厂商公开发表了反对自己所属品类的论点；然后论证我们认为现在真正有意思的那条赛道。

下文所有数据均于 **2026-07-22** 对照 GitHub、PyPI 与官方文档核对。凡属近似值，均已标注。

## 一、构建 Agent 的三种姿势

去掉品牌包装，其实只有三种姿势。

**自己写循环。** 调模型 API、解析工具调用、执行、把结果追加回去、重复。完全可控、没有抽象税，同时你也要独自承担每一个边界情况——包括你还没遇到的那些。

**拼装框架。** 采纳别人的抽象——图、crew、workflow、step——换来编排能力、集成生态和社区支持，代价是层层间接。

**把需求描述出来。** 不写这个 Agent。用一句话说清要干什么，让 Agent 生成配置、提示词和技能。这是最新的一种姿势，也是这个领域几乎还没开始竞争的地方。

市面上几乎一切都属于前两种。**PenguinHarness 是为第三种而生的。**

## 二、2026 年 7 月的战场实况

选取五个覆盖设计空间的代表：一个图框架、一个角色扮演框架、一个厂商 SDK、一个企业级工具包、一个可视化搭建平台。

| 工具 | 归属 | 协议 | ★（2026-07-22） | 最新版本 | 构建方式 |
| --- | --- | --- | ---: | --- | --- |
| **LangChain + LangGraph** | LangChain Inc. | MIT | 142k / 38k | langchain 1.3.14（7-16） | 预置 Agent，编译为状态图 |
| **CrewAI** | CrewAI Inc. | MIT | 56k | 1.15.5（7-20） | 角色扮演的 Agent 团队 + 任务 |
| **OpenAI Agents SDK** | OpenAI | MIT | 28k | 0.18.3（7-17） | Agent 循环原语 + handoff |
| **Google ADK** | Google | Apache-2.0 | 21k | 2.0 GA，py 2.5.0（7-16） | 声明式 Agent + 边列表工作流 |
| **Dify** | LangGenius | 修改版 Apache-2.0 | 150k | 1.16.0（7-17） | 可视化画布，零代码 |
| **PenguinHarness** | Prism Shadow | Apache-2.0 | — | 0.1.0 | 描述需求，由 Agent 构建 |

以及"开箱即得"的部分：

| 工具 | 带工具 Agent 的最少代码 | 终端用户 UI | CLI | 无头服务 | 工具审批 | 一方评测 |
| --- | --- | --- | --- | --- | --- | --- |
| LangChain + LangGraph | 约 15 行 | LangSmith（SaaS） | — | LangGraph Platform | 图 interrupt | LangSmith |
| CrewAI | 5 个文件约 55 行 | — | 脚手架 | — | 经由 Flows | — |
| OpenAI Agents SDK | 约 27 行 | Dashboard 追踪 | — | — | Guardrails | — |
| Google ADK | 约 8 行 | `adk web` + 可视化编排 | `adk run` | `adk api_server` | — | 有，且很深 |
| Dify | **0** | 有 | 有 | REST API | — | — |
| **PenguinHarness** | **0**（CLI 或 Web）· SDK 约 10 行 | 有 | 有 | 有 | **四种模式，可审计** | **内置** |

代码行数取自各项目官方 quickstart，彼此并不完全可比——它们对 import、配置文件、环境准备的计入口径不同。请把它当作数量级，而不是排行榜。空白格表示**我们核查的资料中未记载**，而非"做不到"。

关于协议还有两点值得说，因为"开源"这个词在这个市场里承担了过多含义。Dify 采用的是**修改版** Apache 2.0，**禁止**多租户 SaaS 转售，且**禁止**移除前端的品牌标识。而 n8n——这个领域星标最高的项目，197k——使用 Sustainable Use License，**根本不是开源**。PenguinHarness 是标准 Apache-2.0。

## 三、这个领域已经形成的共识

下面这部分应该改变你阅读框架宣传材料的方式：**如今反对重型 Agent 框架最有力的论证，来自厂商自己。**

Anthropic 的工程指南从 2024 年就这么说，至今仍是他们的权威参考：

> "the most successful implementations weren't using complex frameworks or specialized libraries. Instead, they were building with simple, composable patterns."
>
> （最成功的实现并没有使用复杂框架或专用库，而是用简单、可组合的模式搭起来的。）

> "they often create extra layers of abstraction that can obscure the underlying prompts and responses, making them harder to debug."
>
> （它们往往制造额外的抽象层，遮蔽底层的提示词与响应，让调试更困难。）

微软自家 Agent Framework 文档的开篇，写着一句多数厂商不会印出来的话：

> "If you can write a function to handle the task, do that instead of using an AI agent."
>
> （如果一个函数就能搞定，那就写函数，别用 AI Agent。）

LangChain 的 v1 发布说明，描述了把遗留的 chain、retriever 和 hub 模块移出核心：

> "Legacy functionality has moved to `langchain-classic` to keep the core packages lean and focused."
>
> （遗留功能已迁至 `langchain-classic`，以保持核心包精简、专注。）

而 AutoGen——多智能体框架中星标仍然最高的，60k——现在 README 开头写着：

> "AutoGen is now in maintenance mode. It will not receive new features or enhancements and is community managed going forward."
>
> （AutoGen 现已进入维护模式，不再接受新特性或增强，后续由社区管理。）

独立批评更直接。browser-use 的 Gregor Zunic，2026 年 1 月：

> "Every abstraction is a liability. Every 'helper' is a failure point."
>
> （每一层抽象都是负债，每一个"helper"都是故障点。）

但公平地说，他同样警告了幼稚的极简主义，而且他是对的：

> "The naive approach - stop when the model returns no tool calls - doesn't work well. Agents prematurely finish."
>
> （"模型不再返回工具调用就停止"这种朴素做法效果不好，Agent 会过早收工。）

三个信号指向同一个方向：

- **整合。** AutoGen 进入维护模式；Semantic Kernel 被 Microsoft Agent Framework 取代；LangChain 隔离了遗留接口；Coze Studio 自二月起未再发版。
- **向"薄"收敛。** 迭代最快的项目如今用个位数行数就能跑起带工具的 Agent——AWS Strands 约 4 行、Anthropic 的 Claude Agent SDK 约 6 行、Google ADK 约 8 行。
- **"Harness"成了行业词汇。** 大约两个月内，AWS 把 Agent 仓库从 `sdk-python` 改名为 **`harness-sdk`**；微软在 Agent Framework 中推出 **Harness** 层（含上下文压缩与"不再询问"式工具审批）；Anthropic 发表了 *"A harness for every task"*。三家厂商各自独立地落在了同一个名词上——正是我们给这个项目命名时用的那个。

这个品类没有死，它只是在承认：有价值的从来不是那些抽象。

## 四、还没有人解决的问题

顺着这个收敛推到尽头，一个缺口就浮现了。如果理想形态就是"薄"，那么写 4 行还是 40 行只是舍入误差。真正的问题变成了：

**为什么还要写这个 Agent？** 四行代码依然意味着一个仓库、一套语言运行时、一棵依赖树，和一个开发者。而对一大类真实工作——分析这份数据、盯住这个仓库、生成这些报告——代码本身是附带品。

**生产管控在哪里？** 薄框架往往正好丢掉了那些"让自主进程敢在真机上跑"的东西。上表五个里，只有 ADK 同时提供终端用户 UI、CLI 和无头服务；带审计轨迹的逐次工具审批很少见；一方评测能力更少。

**Agent 上线之后靠什么变好？** 这里每个选项都把 Agent 当作构建产物：你写它、部署它，之后所有改进都是你本人在手动改提示词。

## 五、第四种选项

PenguinHarness 回答的是另一个问题。不是*一个 Agent 需要多少行*，而是*你为什么要写这些行*。

### 零行代码，跑起一个 Agent

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin run -m "分析 data.csv 并总结季度销售情况"
```

没有工程、没有 import、没有框架。同一套引擎同时驱动 REPL（`penguin chat`）、无头服务（`penguin server`）和完整 Web App（`penguin web`，含多会话对话、Agent 与技能管理、用量统计、Trace 可观测、评测中心）。**一次安装，四个入口，一份数据目录。**

### 一句话，让 Agent 构建你的 Agent

这是上面那张表里没有真正对应物的部分。你描述想要的 Agent，然后由一个 Agent 撰写它的 `AGENTS.md`、安装它需要的技能，并把一个能跑的东西交给你：

```text
收集 https://github.com/ericbuess/claude-code-docs 的文档，构建一个 RAG 应用，
以配置专家的身份回答 Claude Code 相关问题，并给出引用来源。
```

这条提示词产出的是一个完整可用的 RAG 应用——摄取、检索、带引用的来源和一个 Web UI。在 DeepSeek V4 Pro 上，token 花费 **$0.02**。[可运行版本](https://github.com/Prism-Shadow/penguin-harness/tree/main/examples/build-agent-with-agent)是一个 82 行的 SDK 脚本：从一句自然语言需求构建出全新 Agent，再运行它，验证生成的配置确实塑造了它的行为。

它之所以成立，原因在架构：**Agent 是可编辑的数据，不是硬编码的常量。** 提示词、技能与配置都是磁盘上的普通文件。**你能看见的，Agent 就能改写**——这也正是下一部分成立的前提。

### 它会自我进化

内置的基准设计、评测与优化技能，让 Agent 能给自己的输出打分、定位失分点、发布第 N+1 版——每轮之前留快照，每个请求都可在 Trace 视图回放。这就是"Agent 作为构建产物"与"Agent 作为持续过程"的区别。

### 而且管控没丢

**上下文层讲极简，运行时层讲严谨：**

- **每次工具调用恰好一次审批决策**，四种模式：全部允许、全部拒绝、只读放行、每次询问。SDK 在未注入审批回调时默认拒绝。
- **每个决策都写入 Trace**，形成 `approval_decision` 审计事件。
- **完全本地。** 数据不离开你的机器，单核 CPU 即可运行。
- **1000+ 模型。** 任何 OpenAI 协议端点都能接——云端或本地——且 Agent 从不与模型绑定，你按会话选择。

如果你确实想用 SDK，那是约十行、一个入口：

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

## 六、什么时候**不该**用 PenguinHarness

一份每一行都自己赢的对比是广告，不是分析。我们有好几行是输的。

**把 Agent 嵌进既有应用。** 如果你要在 Django 服务或 Next.js 路由里塞一个 Agent，请用为此设计的库——Pydantic AI 和 Vercel AI SDK 都很出色，而 LangChain 的生态广度确实难以匹敌。

**Python 团队。** 我们的 SDK 是 TypeScript。CLI 与服务端与语言无关，但如果你的团队写 Python 且希望继承和扩展类，上表多数选项更合适。

**复杂的多 Agent 拓扑。** 如果你的问题确实是一张带条件路由和检查点状态的有向图，LangGraph 和 ADK 对此建模更明确。我们提供子 Agent，且**刻意限制深度为 1**——因为多数委派并不需要一张图。

**深度绑定云厂商。** 在 Azure 上，Microsoft Agent Framework 阻力最小；在 Vertex 上，是 ADK。

**当你希望 Agent 去"完成一份工作"而不是"充当一个组件"，并且希望它在这份工作上越做越好时，用 PenguinHarness。**

## 七、结论

这个领域花了两年证明重抽象是错误的赌注，如今也基本承认了。**薄，赢了。** 但"薄"只是把问题往后推了一步：当循环只剩四行，循环就不再是难的部分。

难的部分正是那张表大面积留白的地方——**人能真正用起来的 UI、可审计的审批、真的跑得起来的评测，以及某种让 Agent 下个月比今天更强的机制。**

这就是我们构建的东西。不是最小的框架——**而是没有框架，外加一个来写这个 Agent 的 Agent。**

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web        # http://127.0.0.1:7364 — 首次登录：admin / penguin-2026
```

---

- **文档**：[快速开始](https://penguin.ooo/docs/quickstart) · [核心接口](https://penguin.ooo/docs/interfaces) · [Skills](https://penguin.ooo/docs/skills)
- **社区**：[GitHub](https://github.com/Prism-Shadow/penguin-harness) · [Discord](https://discord.gg/eFHKqqcU3D)

**参考来源**（数据均于 2026-07-22 核对）：[LangChain v1 发布说明](https://docs.langchain.com/oss/python/releases/langchain-v1) · [AutoGen README](https://github.com/microsoft/autogen) · [Microsoft Agent Framework 文档](https://learn.microsoft.com/en-us/agent-framework/overview/) · [Google ADK](https://adk.dev/) · [CrewAI quickstart](https://docs.crewai.com/en/quickstart) · [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/quickstart/) · [Dify LICENSE](https://github.com/langgenius/dify/blob/main/LICENSE) · [n8n LICENSE](https://github.com/n8n-io/n8n/blob/master/LICENSE.md) · [Anthropic, Building Effective AI Agents](https://www.anthropic.com/engineering/building-effective-agents) · [Anthropic, A harness for every task](https://claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code) · [Gregor Zunic, The Bitter Lesson of Agent Frameworks](https://browser-use.com/posts/bitter-lesson-agent-frameworks)
