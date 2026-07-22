---
title: "AI 基础设施：过去、现在与未来"
date: 2026-07-22
category: practice
excerpt: 三十年来，我们为人的眼睛构建开发者基础设施——渲染后的页面、散文式文档、写给人慢慢读的报错。但消费者变了。本文用可核查的证据梳理：文档、协议、SDK 与错误信息正在如何为 Agent 重建，什么已经失败了，以及那个反复获胜的模式。
---

每一层基础设施都编码了一个关于"谁在消费它"的假设。网页假设了眼睛，文档假设了耐心和一个搜索框，错误信息假设了一个能去翻源码的人，SDK 假设了一个愿意学一次对象模型、然后用一辈子摊销的开发者。

这些假设成立了三十年。**现在它们在相当大的比例上已经不成立了**，而过去十八个月，整个行业一直在搞清楚究竟是哪些部分坏掉了。

这篇文章分三段：我们为人构建了什么，当下正在重建什么，以及什么仍然悬而未决。所有论断都有出处；证据薄弱或存在争议之处，文中会明确说明。

## 第一部分 · 过去：假设了人的基础设施

关于这种错配，最清晰的测量之一也来得最早。2024 年 12 月，Vercel 公布了一个月的网络数据，记录 AI 爬虫的真实行为。其中两项发现已经沉淀为这个时代的定义性事实：

> "none of the major AI crawlers currently render JavaScript"
>
> （当前没有任何一个主流 AI 爬虫会渲染 JavaScript。）

它们会抓取你的 JS 包，但不执行。整整十年的前端架构——客户端渲染、hydration、SPA 路由——对这位消费者而言，产出的是一张白页。

以及：

> "ChatGPT spends 34.82% of its fetches on 404 pages"
>
> （ChatGPT 有 34.82% 的抓取花在了 404 页面上。）

Claude 的爬虫测得 34.16%。**约三分之一的 Agent 抓取是纯粹的浪费**——跟着失效链接、猜测 URL 规律、撞进人类一眼就会跳过的跳转。

这就是"为错误的消费者设计的基础设施"的样子：不是硬性故障，而是一笔持续且隐形的税。**站点是正常的，它只是对真正来访的那位读者不正常。**

关于规模：2026 年 6 月，Cloudflare CEO Matthew Prince 引用 Radar 数据称，自动化请求在 HTML 流量上首次超过人类——机器人 57.5%，人类 42.5%。需要说明的是，该数字出自一条社交媒体发文而非 Cloudflare 的正式博客，且"HTML 流量"这个限定词很关键，因此请对精确数值保持审慎。但方向本身没有争议，而且它比这位 CEO 本人的公开预测提前了数年到来。

## 第二部分 · 现在：正在重建的四条战线

### 1. 文档，以及 llms.txt 极具教益的失败

显而易见的做法，是为机器准备一个标准文件。**llms.txt** 由 Answer.AI 的 Jeremy Howard 于 2024 年 9 月提出——放在 `/llms.txt` 的 Markdown 索引，刻意呼应 `robots.txt`，动机正是上下文窗口的经济学。

它没有成功。Ahrefs 研究了 137,210 个域名，并在 2026 年 6 月公布结果：

> "97% of those files received zero traffic in May 2026. Nothing fetched them at all."
>
> （其中 97% 的文件在 2026 年 5 月零流量，根本没有任何东西去抓过。）

> "Zero requests came from AI bots for llms.txt files that don't exist. They never go looking."
>
> （对于不存在的 llms.txt，AI 机器人的请求数为零——它们从不主动去找。）

28% 的域名发布了这个文件，几乎无人读取。而在确实发生的抓取里，有相当一部分来自行业自我审视——GEO 工具和 llms.txt 检查器。

这个教训值得停下来想一想，因为它和直觉恰好相反：**Agent 并没有采纳为它们发明的新载体，它们读的是"正常的东西"——只要那个正常的东西是机器可读的形态。**

而这恰恰就是那些成功的厂商实际交付的东西。Cloudflare 的 "Docs for agents" 是目前最完整的公开范例：

- 每一页都有 **Copy as Markdown** 按钮
- 任意 URL 加 **`/index.md`** 后缀即可拿到 Markdown 源文
- **`Accept: text/markdown`** 内容协商，并在响应头里返回 **token 计数**
- `/llms-full.txt` —— "Full content of all documentation in a single file, for offline indexing, bulk vectorization"
- 一个**覆盖 2,500 多个 API 端点**的 MCP server

他们给出的理由，一句话就是整个论点：Markdown "reduces wasted tokens (the units of text that AI models process) and produces better results."（减少浪费的 token，并带来更好的结果。）

注意这是什么。**不是新的文件格式，而是内容协商**——一个 1997 年就有的 HTTP 特性，终于开始承重。MCP 规范站点更进一步，直接在响应体里对读者喊话：*"Fetch the complete documentation index at: modelcontextprotocol.io/llms.txt — Use this file to discover all available pages before exploring further."* **文档在带内对它的读者说话，因为它知道读者是个程序。**

与此同时，真正扩散开来的约定，是技术上最不进取的那一个：**AGENTS.md**，仓库根目录的一个 Markdown 文件。它从 Codex、Amp、Jules、Cursor 和 Factory 的实践中长出来，官方称已被**超过 60,000 个开源项目**采用，现由 **Linux 基金会下的 Agentic AI Foundation** 托管——该基金会 2025 年 12 月成立，成员包括 AWS、Anthropic、Block、Bloomberg、Cloudflare、Google、Microsoft 与 OpenAI，以 MCP、goose 和 AGENTS.md 为奠基项目。

**一个放在约定位置的普通 Markdown 文件，赢过了一个精心设计的标准。** 这就是那个模式。

### 2. 协议层长大了

**MCP** 由 Anthropic 提出，其架构灵感公开来自开发者工具：

> "MCP takes some inspiration from the Language Server Protocol, which standardizes how to add support for programming languages across a whole ecosystem of development tools."

当前生效的规范版本是 2025-11-25。但更能说明问题的，是 2026 年 5 月发布、面向 2026-07-28 的候选版本——因为它的改动读起来不像一份 AI 协议，而像一支基础设施团队在为规模化加固服务：

- **会话没了。** `initialize`/`initialized` 握手被移除，`Mcp-Session-Id` 头也被移除。用规范作者的话说，结果是：*"any MCP request can land on any server instance, and the sticky routing and shared session stores that horizontal deployments needed before are no longer required at the protocol layer."*（任何请求都可以落到任何一个服务实例上，横向部署此前需要的粘性路由与共享会话存储，在协议层不再必要。）
- **路由头成为强制**（`Mcp-Method`、`Mcp-Name`），负载均衡器无需解析请求体即可路由。
- **缓存元数据**（`ttlMs`、`cacheScope`）加到列表操作上。
- **W3C Trace Context** 透传，让 Agent 调用并入你既有的分布式追踪。
- 工具 schema 升级到**完整 JSON Schema 2020-12**，并确立了**至少十二个月**弃用缓冲期的正式废弃策略。

无状态、缓存头、路由、追踪、弃用承诺。**这就是一个 AI 协议从 demo 变成基础设施的样子。** 与此同时，Google 捐给 Linux 基金会的 **A2A** 在满一年时发布 v1.0，获 150 多家组织支持。

### 3. 工具接口塌缩成了代码

这是这段时期最重要的技术发现，而且**四个月内有三方各自独立抵达了同一结论**。

**Anthropic**，2025 年 11 月——把 MCP server 呈现为"代码 API 的文件系统"，一个工具一个文件，让 Agent 只加载需要的部分，并在执行环境里过滤数据，而不是让数据穿过上下文窗口。在其示例工作流上实测：**150,000 token 降到 2,000，减少 98.7%。** 他们的定调：

> "LLMs are adept at writing code and developers should take advantage of this strength to build agents that interact with MCP servers more efficiently."

**Cloudflare**，2026 年 2 月——同一洞察，API 规模：

> "agents need many tools to do useful work, yet every tool added fills the model's context window, leaving less room for the actual task."
>
> （Agent 需要很多工具才能干活，但每加一个工具都在填满模型的上下文窗口，留给真正任务的空间就更少。）

他们的答案把数千个端点塌缩成**两个工具 `search()` 和 `execute()`，约 1,000 token**，模型写的代码在沙箱 isolate 中执行。实测：**输入 token 减少 99.9%**——对照组是等价传统 MCP server 的 117 万 token。

**MCP 规范本身**，2026 年 7 月——即上文那个无状态、代码形态的方向。

把这些和 llms.txt 的结果并排看，模式已无从误认。Agent 收敛到的接口不是什么专属 Agent 格式，而是**代码与文件系统**——这两样本来就是机器形态的、本来就可组合的，也本来就存在于每个模型的训练数据里。

我们觉得这颇为印证，因为这正是 PenguinHarness 下的赌注：**shell 是通用接口，skill 是文件。**

### 4. 错误信息成为一种接口

最不光鲜的一条战线，也可能是杠杆最高的一条。

Anthropic 关于为 Agent 写工具的指南明确指出，**错误文本如今是一种机器接口**：好的错误应当"specific and actionable"（具体且可操作），而不是"opaque error codes or tracebacks"（晦涩的错误码或调用栈），并且应当把 Agent 引向一个有效的下一步——比如建议使用过滤或分页，或直接给出格式正确的示例。同一篇文档还提到，Claude Code 默认将工具响应限制在 **25,000 token**，并且响应详略本身值得做成一等选项。

Stripe 提供了现场证据。他们构建了一套基准来检验 Agent 能否产出真实可用的 Stripe 集成，结果发现了一个应该让所有 API 提供方警觉的失败模式：

> Agents "would pass in nonexistent Stripe data, observe 400s, and consider the task complete."
>
> （Agent 会传入并不存在的 Stripe 数据，看到 400，然后认为任务已经完成。）

一个正确的 HTTP 400——对人类开发者完全够用，他会读一眼然后去查——**却没能把"失败"传达给 Agent**。状态码是对的，接口依然是坏的。跑这套基准还顺带暴露了若干真实的文档 bug（已修复）：**一次 Agent 评测，充当了文档的 QA 工具。**

## 第三部分 · 模式，以及它的要求

把四条战线剥到底，只剩一条规律：

> **Agent 不会采纳专门为它们打造的基础设施。它们采纳的是碰巧就是机器形态的既有基础设施——并且惩罚一切假设了人的东西。**

llms.txt 为 Agent 而设计，无人问津。Markdown、HTTP 内容协商、文件系统、shell，以及一个叫 AGENTS.md 的文件，压根不是为 Agent 设计的，却赢了。与此同时，SPA 渲染、只有散文的文档、只给人看的错误信息，正在向每一个路过的 Agent 悄悄收税。

由此得到四条应当为之设计的性质。它们正是我们构建 PenguinHarness 所围绕的，而且**可以在仓库里核对，而不只是在这里被宣称**。

**接口的简洁。** 我们的 SDK 只有一个执行入口——`session.run()`，流式吐出每一步；一个可用 Agent 约十行。引擎暴露 **6 个内置工具**，且其中没有任何文件工具：读、写、编辑、搜索全部经由 `exec_command`，因为 **shell 正是 Agent 早就会用的那个接口**。你每多加一个工具，就是多一份按轮计费的 schema。

**Agent 消费得了的文档。** 17 个双语文档页面；更关键的是 **Skills**——以 `SKILL.md` 文件形式存放的指令包，由 Agent 在需要时用一条 shell 命令读取。系统里没有 skill 工具：系统提示词只携带名字和一行描述，正文在相关时才加载，不相关时不花钱。**这就是渐进式披露，用文件系统实现。** 其中 `penguin-sdk` 和 `penguin-cli` 两个技能的存在意义，就是教 Agent 如何驱动我们自己的 SDK 与 CLI——**读者是机器的文档**。

**错误的透明。** 在我们的引擎里，**工具永不向循环抛异常**。失败——超时、非零退出、被拒绝的审批——都收敛成模型可读可反应的工具输出消息，并且退出码被追加在**截断窗口之外**，长输出被砍时依然幸存。服务端则统一使用带机器可读 `code` 的错误结构，与面向人的文案并存。这也正是精简系统提示词依然安全的原因：**当环境把自己的失败讲清楚，提示词就不必预先描述它们。**

**可观测与管控。** 每个请求、每次工具调用、每个审批决策都追加进 Trace，会话可由其完整恢复。每次工具调用恰好一次审批决策（四种模式），以 `approval_decision` 事件写入 Trace。压缩会轮转 Trace 文件，因此**一个文件永远恰好等于一个模型上下文**。

## 第四部分 · 未来：真正还没解决的事

诚实的汇报要求点名那些还不成立的部分。

**身份。** 如果 Agent 已是流量主体，"这是不是真人"就不再能靠验证码回答。**Web Bot Auth** 是当前的现实尝试——基于 RFC 9421 的 HTTP 消息签名、一份 IETF 草案、以及 Cloudflare 2025 年 8 月的 signed agents 上线（首批伙伴包括 OpenAI 的 ChatGPT agent 与 Block 的 goose）。它目前是草案加厂商部署，**还不是定型标准**。

**工具元数据的信任——这条最要紧。** MCP 自己的规范是承认问题，而不是解决问题：

> "descriptions of tool behavior such as annotations should be considered untrusted, unless obtained from a trusted server."
>
> （诸如 annotation 之类的工具行为描述应被视为不可信，除非来自可信的 server。）

> "MCP itself cannot enforce these security principles at the protocol level."
>
> （MCP 自身无法在协议层强制这些安全原则。）

2026 年 3 月的同行评议工作评估了七个主流 MCP 客户端，认定**工具投毒（tool poisoning，即把恶意指令嵌进工具元数据）是最普遍、影响最大的客户端侧漏洞**，原因是静态校验与参数可见性不足。**一段工具描述就是一段穿了正装的提示词**，而当前生态正在从陌生人那里分发成千上万段。防御方案已有提出，但都还没有标准化。

这正是我们把审批当作承重结构而非可选项、并让每个决策都落进审计轨迹的原因。

**长时运行的状态。** MCP 一边删掉自己的会话层，一边新增 **Tasks** 扩展：工具调用返回一个句柄供你轮询。状态正在被推到协议之上——这在设计上是自洽的，但意味着**持久化要每个人自己解决**。

**支付与 Agent 间商务。** 据 Linux 基金会，AP2 已有 60 多家组织支持。至于流传的 Agent 支付通道交易量，来源均为厂商相关渠道且我们无法核实，因此不予转述。

**治理吞吐。** MCP 自己的 2026 路线图点名了瓶颈：每一份提案无论属于哪个领域，都需要核心维护者完整评审。**生态已经大过了它的评审能力。**

## 结语

过去为眼睛而建。现在正在为程序重建，而迄今为止的回报并非来自发明 Agent 原生格式，**而是来自把普通的东西变得机器可读**：用 Markdown 而非渲染后的 HTML，用代码而非工具堆砌，用文件系统而非专用注册中心，以及**会告诉你下一步该做什么的错误信息**。

至于未来，它多半是一个穿着基础设施外衣的安全与身份问题。

我们认为这件事最终会在 harness 这一层见分晓，因为 harness 是最后一公里——**真正花掉上下文、读取错误、决定模型看见什么的那一层**。把它当作"消费者是程序，而不是一个盯着截图看的人"来构建，就是这份工作的全部。

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

---

- **文档**：[工具与审批](https://penguin.ooo/docs/tools) · [Agent Loop](https://penguin.ooo/docs/agent-loop) · [Skills](https://penguin.ooo/docs/skills) · [Server API](https://penguin.ooo/docs/server-api)
- **社区**：[GitHub](https://github.com/Prism-Shadow/penguin-harness) · [Discord](https://discord.gg/eFHKqqcU3D)

**参考来源**：[Vercel, The rise of the AI crawler](https://vercel.com/blog/the-rise-of-the-ai-crawler) · [Ahrefs, llms.txt 研究](https://ahrefs.com/blog/llmstxt-study/) · [llmstxt.org](https://llmstxt.org/) · [Cloudflare, Docs for agents](https://developers.cloudflare.com/docs-for-agents/) · [Cloudflare, Code Mode](https://blog.cloudflare.com/code-mode-mcp/) · [Cloudflare, signed agents](https://blog.cloudflare.com/signed-agents/) · [MCP 规范](https://modelcontextprotocol.io/specification/latest) · [MCP 2026-07-28 候选版本](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/) · [MCP 2026 路线图](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/) · [Linux 基金会, Agentic AI Foundation](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation) · [Linux 基金会, A2A 一周年](https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year) · [agents.md](https://agents.md/) · [Anthropic, Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) · [Anthropic, Writing effective tools for AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents) · [Stripe, Can AI agents build real Stripe integrations?](https://stripe.com/blog/can-ai-agents-build-real-stripe-integrations) · [MCP 威胁建模（arXiv）](https://arxiv.org/abs/2603.22489)
