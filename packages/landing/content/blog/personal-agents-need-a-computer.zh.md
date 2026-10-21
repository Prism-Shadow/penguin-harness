---
title: "个人 Agent 需要 Agent 原生云电脑"
date: 2026-10-19
category: perspectives
excerpt: "我们将个人 Agent 拆为模型、运行时、宿主电脑三层。运行时核心循环已定型，后续进展需要专门构建的 Agent 原生云电脑。"
---

Meta 在 2026-09-08 发布了 Muse。[^1]三周后，OpenAI 在 2026-09-29 发布了 dots。[^2]两款产品都为每个 Agent 分配了专属云电脑。[^1][^3]我们把个人 Agent 拆成三层堆叠结构，分别是能力更强的模型、Agent Runtime（运行时）、Agent 原生云电脑。

我们认为运行时循环的核心形态已经定型。近期的变化会来自模型后训练，以及 Agent 工作环境的升级。下面这张图展示了这个拆分。

<figure class="post-figure" data-figure="personal-agent-three-parts"> <svg class="fig-svg" viewBox="0 0 560 201" role="img" aria-labelledby="personal-agents-need-a-computer-personal-agent-three-parts-zh-title"> <title id="personal-agents-need-a-computer-personal-agent-three-parts-zh-title">个人 Agent 的三个组件并排展示，中间列是已定型的运行时循环。</title> <defs><marker id="personal-agents-need-a-computer-personal-agent-three-parts-zh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker><path id="personal-agents-need-a-computer-personal-agent-three-parts-zh-line1" d="M-331 61H469"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-zh-line2" d="M-331 76H469"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-zh-line3" d="M174.75 107H974.75"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-zh-line4" d="M174.75 124H974.75"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-zh-line5" d="M174.75 141H974.75"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-zh-line6" d="M174.75 158H974.75"/></defs> <rect x="370.5" y="0.5" width="189" height="199.5" rx="8" class="fig-s2"/> <text x="69" y="25" class="fig-title" text-anchor="middle">能力更强的模型</text> <path d="M0 40H138" class="fig-axis"/> <text x="254" y="25" class="fig-title" text-anchor="middle">Agent Runtime</text> <path d="M152 40H356" class="fig-axis"/> <text x="465" y="25" class="fig-title" text-anchor="middle">Agent 原生云电脑</text> <path d="M382 40H548" class="fig-axis"/> <text class="fig-note" text-anchor="middle"><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-zh-line1" startOffset="50%">变化点：厂商针对</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-zh-line2" startOffset="50%">Agent 环境做后训练</textPath></text> <text x="254" y="61" class="fig-note" text-anchor="middle">核心形态已定型</text> <text x="465" y="61" class="fig-note" text-anchor="middle">需要新的建设工作</text> <rect x="152.75" y="76" width="202.5" height="124" rx="8" class="fig-terminal"/> <rect x="160.75" y="84" width="186.5" height="88" rx="2" class="fig-box"/> <text><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-zh-line3">组装上下文 →</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-zh-line4">调用模型 →</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-zh-line5">执行工具调用 →</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-zh-line6">追加到 Trace</textPath></text> <path d="M317.25 154H333.25V103H315.25" class="fig-edge" marker-end="url(#personal-agents-need-a-computer-personal-agent-three-parts-zh-arrow)"/> <text x="254" y="191" text-anchor="middle">安全/权限防护层</text> <rect x="384" y="89" width="4" height="4" class="fig-marker"/> <text x="395" y="96">持久化且常驻在线</text> <rect x="384" y="114" width="4" height="4" class="fig-marker"/> <text x="395" y="121">适配 Agent 的软件</text> <rect x="384" y="139" width="4" height="4" class="fig-marker"/> <text x="395" y="146">作为统一入口持有应用连接</text> </svg> <ol class="fig-steps"> <li>能力更强的模型</li> <li>变化点：厂商针对 Agent 环境做后训练</li> <li>Agent Runtime</li> <li>核心形态已定型</li> <li>组装上下文 → 调用模型 → 执行工具调用 → 追加到 Trace</li> <li>安全/权限防护层</li> <li>Agent 原生云电脑</li> <li>需要新的建设工作</li> <li>持久化且常驻在线</li> <li>适配 Agent 的软件</li> <li>作为统一入口持有应用连接</li> </ol> <figcaption>我们认为个人 Agent 拆分为三个独立部分；运行时循环是稳定的中间层，模型训练和宿主电脑是近期变化的来源。</figcaption> </figure>

## 运行时与模型的进展路径明确
PenguinHarness 的引擎、运行循环、只追加写入的 Trace，都遵循这套已定型的核心形态。[^4][^5][^6]

Fortune 报道，GPT-6 Astra 搭配标准 Harness 在 ARC-AGI-3 上得分 66%，搭配增强版 Harness 得分达 99.9%。[^7]Meta 在每台 Muse VM 上独立运行 Sentinel 权限防护层；我们判断这类防护层会持续增加。[^8]

OpenAI 将模型能力提升归因于预训练加强化学习。[^9][^10]DeepSeek-V3.2 新的 Agent 训练数据合成方法覆盖 1,800+ 环境。[^11]Anthropic 指出，有缺陷的 RL 环境是模型未对齐行为的主要来源之一。[^12]我们判断，针对 Agent 环境做强化学习，是近期模型能力提升的最大驱动因素。

Agent 的工作环境，仍是这套三层堆叠架构里发展最不充分的一块。

## 单任务沙箱缺少持久状态
很多 Agent 沙箱为单个任务或单个 Session 创建。这类沙箱启动时加载全新环境，任务结束就丢弃所有已安装的工具、正在运行的进程和机器内的全部状态。Manus 标准沙箱、Claude Cowork 与 Managed Agents 沙箱、Windows 365 for Agents、OpenAI 的 Code Interpreter 都采用这种设计。[^13][^14][^15]

我们认为这种设计合理。Anthropic 和 Microsoft 明确按这个思路设计产品。Anthropic 把对话上下文存在 Session 日志里；Microsoft 会在每个 Session 结束后重置 Cloud PC，满足隔离、可审计、资源可复用的要求。[^16][^17]

Vercel 默认给文件系统做快照，E2B 可无限期保存暂停状态的沙箱，Manus 售卖基于 Ubuntu 的持久化 Manus Cloud Computer。[^13][^18][^19]这些方案仍有两个缺口，一是预先适配 Agent 的软件，二是统一存放应用连接的位置。

## Agent 原生云电脑补齐适配软件与统一连接能力
Agent 可用的软件栈分三层，见下图。

<figure class="post-figure" data-figure="personal-agent-software-stack"> <svg class="fig-svg" viewBox="0 0 560 218" role="img" aria-labelledby="personal-agents-need-a-computer-personal-agent-software-stack-zh-title"> <title id="personal-agents-need-a-computer-personal-agent-software-stack-zh-title">Agent 可用的软件访问层级堆叠图，从基础镜像向上到适配接口，标注了图形界面和适配接口模式的性能数据。</title> <rect x="1" y="1" width="558" height="96" rx="6" class="fig-box"/> <text x="16" y="25" class="fig-label">带 Agent 适配接口的应用（CLI（命令行）/API/MCP）</text> <path d="M17 39V59" class="fig-axis"/> <text x="28" y="52">相比 GUI 减少 65–70% 任务完成时间（AXIS，微软研究院）</text> <path d="M17 69V89" class="fig-axis"/> <text x="28" y="82">在 GUI 基础上增加 API 操作，o1 步数减少 58.5%（UFO2，微软）</text> <rect x="1" y="105" width="558" height="66" rx="6" class="fig-box"/> <text x="16" y="129" class="fig-label">仅支持 GUI 的桌面应用</text> <path d="M17 143V163" class="fig-axis"/> <text x="28" y="156">任务完成率 20.6%，OSWorld 2.0 当前最优成绩（Claude Opus 4.8，500 步预算）</text> <rect x="1" y="179" width="558" height="38" rx="6" class="fig-box"/> <text x="16" y="203" class="fig-label">基础沙箱镜像（Linux + 开发工具）</text> </svg> <ol class="fig-steps"> <li>基础沙箱镜像（Linux + 开发工具）</li> <li>仅支持 GUI 的桌面应用</li> <li>任务完成率 20.6%，OSWorld 2.0 当前最优成绩（Claude Opus 4.8，500 步预算）</li> <li>带 Agent 适配接口的应用（CLI（命令行）/API/MCP）</li> <li>相比 GUI 减少 65–70% 任务完成时间（AXIS，微软研究院）</li> <li>在 GUI 基础上增加 API 操作，o1 步数减少 58.5%（UFO2，微软）</li> </ol> <figcaption>很多默认沙箱镜像只预装到开发者工具层；实测对比显示，走 API 路径比纯图形界面操作减少 65–70% 的任务完成时间，在图形界面基础上增加 API 操作可让 o1 的平均步数减少 58.5%。</figcaption> </figure>

默认沙箱多只预装开发工具链，部分搭载需额外封装的办公软件。Agent 需要预装适配 CLI（命令行）、API 或 MCP (Model Context Protocol) 的软件。[^20][^21][^22]

微软两项研究对比 API 与 GUI 路径：AXIS 显示 API 耗时更短，UFO2 显示加入 API 后步骤更少。[^23][^24]

我们将 GUI 层 Computer Use（操作图形界面）作为兜底。OSWorld 2.0 榜首方案完成率仍有限。[^25]

第二项核心属性是统一连接。这台机器保存一次配置的连接器、登录态和凭证，Agent 无法读取密钥明文。

Meta 将 Muse 凭证存在专属 VM，由 Sentinel 替换真实 Token，Agent 仅能拿到代理凭证。[^1][^8]OpenAI 将 dot 登录态存在云浏览器，连接消息渠道不连带接入收件箱或其他应用。[^3]目前尚无产品同时满足持久常驻、适配软件、统一连接三项要求。

## PenguinHarness 当前进展
PenguinHarness 已交付稳定的 Agent Runtime。引擎与可替换 Environment 边界拆分，仅本地进程版。[^4][^26]

「机器管理」可在 SSH 可达的 Linux/macOS 主机装服务端。[^27]主机本地服务端直接运行对话，关页面后控制端仍连接，断连或控制端重启后自动重连。[^27]远程主机重启后，下次探测显示服务未运行，不自启，需控制端拉起。[^28][^29]

「机器管理」页列所有已连主机，见下图。

![PenguinHarness「机器管理」页面，展示两台已连接主机，一台是本地服务器，一台通过 SSH 连接。](/blog-assets/machines-page-zh.png)
_「机器管理」页面展示 PenguinHarness 可运行会话的已连接主机；我们不创建也不托管这些机器，也不会在上面预装适配 Agent 的软件。_

Agent 可添加 MCP Server，无内置 Plugin 预设。[^30][^31][^32]「密钥保险柜」不向模型暴露密钥。我们注入密钥到命令环境。shell 输出未脱敏。命令可打印密钥到模型可读工具结果中。[^5][^30][^33]

浏览器自动化用桌面内置浏览器或配对 Chrome。[^34]飞书、Telegram、QQ、微信只转消息，不访问其数据。[^35]

连接分属不同作用域，无统一入口和内置连接器目录。不支持 MCP OAuth 登录，无边缘凭据代理。[^30][^36][^37]

我们未交付 Agent 原生云电脑。

[^1]: [Introducing Muse: The World’s First Personal AI Agent Built for Everyone](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/)
[^2]: [OpenAI launches Dots, its bubbly agentic avatar | TechCrunch](https://techcrunch.com/2026/09/29/openai-launches-dots-its-bubbly-agentic-avatar/)
[^3]: [Meet dots | ChatGPT Learn](https://learn.chatgpt.com/docs/dots)
[^4]: [PenguinHarness docs: Architecture](https://penguin.ooo/docs/architecture)
[^5]: [PenguinHarness docs: The Agent Loop](https://penguin.ooo/docs/agent-loop)
[^6]: [PenguinHarness docs: Sessions &amp; Traces](https://penguin.ooo/docs/sessions-and-traces)
[^7]: [OpenAI launches GPT-6 Astra, its most powerful model yet, and touts its ability to use your computer | Fortune](https://fortune.com/2026/09/03/openai-debuts-gpt-6-astra-computer-use-greg-brockman-says-start-of-agi/)
[^8]: [How We Built Safety Into Muse | Meta AI Research](https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse)
[^9]: ['Welcome to the AGI era': OpenAI launches GPT-6 Astra | VentureBeat](https://venturebeat.com/technology/welcome-to-the-agi-era-openai-launches-gpt-6-astra)
[^10]: [OpenAI Just Released Its Powerful New ChatGPT Agent | Sequoia Capital](https://sequoiacap.com/podcast/training-data-chatgpt-agent)
[^11]: [DeepSeek-V3.2 Release | DeepSeek API Docs](https://api-docs.deepseek.com/news/news251201)
[^12]: [Introducing Claude Opus 5.5 \ Anthropic](https://www.anthropic.com/news/claude-opus-5-5)
[^13]: [Introducing Cloud Computer: Lowering the Barrier to Building](https://manus.im/blog/manus-cloud-computer)
[^14]: [Claude Cowork architecture overview | Claude Help Center](https://support.claude.com/en/articles/14479288-claude-cowork-desktop-architecture-overview)
[^15]: [Cloud environment setup - Claude Platform Docs](https://platform.claude.com/docs/en/managed-agents/environments)
[^16]: [Scaling Managed Agents: Decoupling the brain from the hands \ Anthropic](https://www.anthropic.com/engineering/managed-agents)
[^17]: [Agent session lifecycle | Microsoft Learn](https://learn.microsoft.com/en-us/windows-365/agents/agent-session-lifecycle)
[^18]: [Persistence](https://vercel.com/docs/sandbox/concepts/persistent-sandboxes)
[^19]: [Sandbox persistence - E2B Docs](https://docs.e2b.dev/sandbox/persistence)
[^20]: [Base image - E2B Docs](https://docs.e2b.dev/template/base-image)
[^21]: [e2b-dev/desktop: template/template.py](https://raw.githubusercontent.com/e2b-dev/desktop/main/template/template.py)
[^22]: [Code execution tool - Claude Platform Docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool)
[^23]: [AXIS: Efficient Human-Agent-Computer Interaction with API-First LLM-Based Agents](https://arxiv.org/abs/2409.17140)
[^24]: [UFO2: The Desktop AgentOS](https://arxiv.org/html/2504.14603v2)
[^25]: [OSWorld 2.0: Benchmarking computer-use agents on long-horizon real-world tasks](https://osworld-v2.xlang.ai/)
[^26]: [packages/core/src/environment/environment.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/core/src/environment/environment.ts)
[^27]: [PenguinHarness blog: One window, agents on every machine you have](https://penguin.ooo/blog/run-agents-on-remote-machines)
[^28]: [packages/server/src/machines/server-control.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/server/src/machines/server-control.ts)
[^29]: [packages/server/src/machines/install-server.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/server/src/machines/install-server.ts)
[^30]: [PenguinHarness docs: Agents](https://penguin.ooo/docs/agents)
[^31]: [PenguinHarness docs: Skills &amp; Plugins](https://penguin.ooo/docs/skills)
[^32]: [plugins/](https://github.com/Prism-Shadow/penguin-harness/tree/v0.2.16/plugins)
[^33]: [PenguinHarness docs: Configuration Reference](https://penguin.ooo/docs/configuration)
[^34]: [PenguinHarness docs: Built-in Browser](https://penguin.ooo/docs/builtin-browser)
[^35]: [PenguinHarness docs: Remote control](https://penguin.ooo/docs/remote-control)
[^36]: [PenguinHarness docs: Tools &amp; Approval](https://penguin.ooo/docs/tools)
[^37]: [PenguinHarness docs: Settings](https://penguin.ooo/docs/settings)
