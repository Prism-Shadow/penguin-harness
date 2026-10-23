---
title: "个人 Agent 需要 Agent 原生云电脑"
date: 2026-10-19
category: perspectives
excerpt: "2026 年 9 月 Meta 与 OpenAI 接连发布个人 Agent，这类产品需要模型、运行时与 Agent 原生云电脑三层，缺失的云电脑承担统一入口与应用连接职责。"
---

> 本文基于 PenguinHarness 0.2.16 撰写，之后的版本在部分细节上可能有所不同。

2026 年 9 月接连发布两款个人 Agent。9 月 8 日 Meta 推出 Muse，三周后 OpenAI 在 DevDay 发布 dots。两款产品都为每个用户分配专属云电脑，工作不局限在聊天窗口[^1]。

个人 Agent 分三部分，能力更强的模型、Agent Runtime（运行时）循环，以及 Agent 原生云电脑。运行时设计已收敛，**云电脑是缺失的部分，持有所有应用连接，作为统一入口存在**。

**TL;DR**
- Agent 核心运行时循环形态已稳定，近期增益主要来自模型训练。
- 面向单次任务的沙箱，即使支持持久化，也不适合作为个人 Agent 的长期运行环境。
- 缺失的云电脑层统一持有所有应用连接，作为用户与应用间的单一入口。

## 运行时循环已有成熟路径
个人 Agent 三层里云电脑尚缺，**作为中间层的 Agent Runtime 核心循环则已形成稳定形态**。在 PenguinHarness 里，这个循环分四步，组装上下文、调用模型、运行经审批的工具调用、将所有事件追加到只增的 Trace 中。

<figure class="post-figure" data-figure="personal-agent-three-parts"> <svg class="fig-svg" viewBox="0 0 560 201" role="img" aria-labelledby="personal-agents-need-a-computer-personal-agent-three-parts-zh-title"> <title id="personal-agents-need-a-computer-personal-agent-three-parts-zh-title">个人 Agent 的三个组件并排展示，中间列是已定型的运行时循环。</title> <defs><marker id="personal-agents-need-a-computer-personal-agent-three-parts-zh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker><path id="personal-agents-need-a-computer-personal-agent-three-parts-zh-line1" d="M-331 61H469"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-zh-line2" d="M-331 76H469"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-zh-line3" d="M174.75 107H974.75"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-zh-line4" d="M174.75 124H974.75"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-zh-line5" d="M174.75 141H974.75"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-zh-line6" d="M174.75 158H974.75"/></defs> <rect x="370.5" y="0.5" width="189" height="199.5" rx="8" class="fig-s2"/> <text x="69" y="25" class="fig-title" text-anchor="middle">能力更强的模型</text> <path d="M0 40H138" class="fig-axis"/> <text x="254" y="25" class="fig-title" text-anchor="middle">Agent Runtime</text> <path d="M152 40H356" class="fig-axis"/> <text x="465" y="25" class="fig-title" text-anchor="middle">Agent 原生云电脑</text> <path d="M382 40H548" class="fig-axis"/> <text class="fig-note" text-anchor="middle"><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-zh-line1" startOffset="50%">变化点：厂商针对</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-zh-line2" startOffset="50%">Agent 环境做后训练</textPath></text> <text x="254" y="61" class="fig-note" text-anchor="middle">核心形态已定型</text> <text x="465" y="61" class="fig-note" text-anchor="middle">需要新的建设工作</text> <rect x="152.75" y="76" width="202.5" height="124" rx="8" class="fig-terminal"/> <rect x="160.75" y="84" width="186.5" height="88" rx="2" class="fig-box"/> <text><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-zh-line3">组装上下文 →</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-zh-line4">调用模型 →</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-zh-line5">执行工具调用 →</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-zh-line6">追加到 Trace</textPath></text> <path d="M317.25 154H333.25V103H315.25" class="fig-edge" marker-end="url(#personal-agents-need-a-computer-personal-agent-three-parts-zh-arrow)"/> <text x="254" y="191" text-anchor="middle">安全/权限防护层</text> <rect x="384" y="89" width="4" height="4" class="fig-marker"/> <text x="395" y="96">持久化且常驻在线</text> <rect x="384" y="114" width="4" height="4" class="fig-marker"/> <text x="395" y="121">适配 Agent 的软件</text> <rect x="384" y="139" width="4" height="4" class="fig-marker"/> <text x="395" y="146">作为统一入口持有应用连接</text> </svg> <ol class="fig-steps"> <li>能力更强的模型</li> <li>变化点：厂商针对 Agent 环境做后训练</li> <li>Agent Runtime</li> <li>核心形态已定型</li> <li>组装上下文 → 调用模型 → 执行工具调用 → 追加到 Trace</li> <li>安全/权限防护层</li> <li>Agent 原生云电脑</li> <li>需要新的建设工作</li> <li>持久化且常驻在线</li> <li>适配 Agent 的软件</li> <li>作为统一入口持有应用连接</li> </ol> <figcaption>我们认为个人 Agent 拆分为三个独立部分；运行时循环是稳定的中间层，模型训练和宿主电脑是近期变化的来源。</figcaption> </figure>

更强的模型不会让运行时设计失去价值。《财富》报道，GPT-6 Astra 在标准 Harness 下 ARC-AGI-3 得分 66%，优化过的 Harness 下可达 99.9%；DeepSeek-V3.2 训练覆盖 1800 余个 Agent 环境[^2]。

这个核心循环形态短期内不会变动，剩下的问题是循环运行在什么环境。

## 单次任务沙箱不是合适的长期宿主
今天 Agent 循环大多运行在单次任务沙箱里，这类沙箱为单次任务和隔离而设计，用完即弃。Anthropic Managed Agents 采用可替换容器，Windows 365 for Agents 每个 Session 结束后重置云电脑，Manus 普通对话的沙箱从空白启动，会话结束即删除[^3]。

持久化沙箱已经存在。Manus 提供始终在线的 Ubuntu 云电脑，E2B 可无限期保存暂停沙箱的文件系统、内存与运行进程[^4]。

单次任务沙箱满足隔离与可复现需求，**因此不适合做个人 Agent 的长期驻地；就算是通用持久化机器，也还有两个缺口**。

## Agent 在为自身设计的界面上表现更好
第一个缺口是缺少专为 Agent 设计的软件。Agent 访问软件分三层，基础沙箱镜像、仅提供 GUI 的桌面应用、带适配接口的应用（CLI/API/MCP）。E2B 默认沙箱镜像是预装开发工具的 Debian，不带桌面或办公软件。

<figure class="post-figure" data-figure="personal-agent-software-stack"> <svg class="fig-svg" viewBox="0 0 560 218" role="img" aria-labelledby="personal-agents-need-a-computer-personal-agent-software-stack-zh-title"> <title id="personal-agents-need-a-computer-personal-agent-software-stack-zh-title">Agent 可用的软件访问层级堆叠图，从基础镜像向上到适配接口，标注了图形界面和适配接口模式的性能数据。</title> <rect x="1" y="1" width="558" height="96" rx="6" class="fig-box"/> <text x="16" y="25" class="fig-label">带 Agent 适配接口的应用（CLI（命令行）/API/MCP）</text> <path d="M17 39V59" class="fig-axis"/> <text x="28" y="52">相比 GUI 减少 65–70% 任务完成时间（AXIS，微软研究院）</text> <path d="M17 69V89" class="fig-axis"/> <text x="28" y="82">在 GUI 基础上增加 API 操作，o1 步数减少 58.5%（UFO2，微软）</text> <rect x="1" y="105" width="558" height="66" rx="6" class="fig-box"/> <text x="16" y="129" class="fig-label">仅支持 GUI 的桌面应用</text> <path d="M17 143V163" class="fig-axis"/> <text x="28" y="156">任务完成率 20.6%，OSWorld 2.0 当前最优成绩（Claude Opus 4.8，500 步预算）</text> <rect x="1" y="179" width="558" height="38" rx="6" class="fig-box"/> <text x="16" y="203" class="fig-label">基础沙箱镜像（Linux + 开发工具）</text> </svg> <ol class="fig-steps"> <li>基础沙箱镜像（Linux + 开发工具）</li> <li>仅支持 GUI 的桌面应用</li> <li>任务完成率 20.6%，OSWorld 2.0 当前最优成绩（Claude Opus 4.8，500 步预算）</li> <li>带 Agent 适配接口的应用（CLI（命令行）/API/MCP）</li> <li>相比 GUI 减少 65–70% 任务完成时间（AXIS，微软研究院）</li> <li>在 GUI 基础上增加 API 操作，o1 步数减少 58.5%（UFO2，微软）</li> </ol> <figcaption>很多默认沙箱镜像只预装到开发者工具层；实测对比显示，走 API 路径比纯图形界面操作减少 65–70% 的任务完成时间，在图形界面基础上增加 API 操作可让 o1 的平均步数减少 58.5%。</figcaption> </figure>

**Agent 走适配接口的表现远好于纯 GUI 操作**。API 优先的 AXIS Agent 在 Word 任务上，完成时间缩短 65%–70%，认知负载降低 38%–53%。用户研究中，它比人工操作 GUI 和操作 GUI 的 UI Agent 都快[^5]。UFO2 混合 API 与 GUI 操作，相同任务上 o1 步骤数减少 58.5%。

Computer Use（操作图形界面）还无法替代适配接口。OSWorld 2.0 榜首方案在 500 步预算下，长周期 GUI 任务完成率仅 20.6%[^6]。

适配接口补上第一个缺口，剩下的问题是应用连接存在哪里。

## 连接应当存放在机器层面
针对应用连接的存放，现有设计将用户凭证存在单独受保护位置，不让 Agent 直接接触。

Muse 把凭证存在用户专属云电脑上，Agent 代码只能拿到代理凭证，Sentinel 在网络边界替换真实凭证[^7]。dots 的云浏览器登录状态与用户本地浏览器分开，接入一个消息渠道不会自动连通其他应用，Agent 仅在授权范围内访问已连接应用。Anthropic Managed Agents 中，MCP 调用经代理从保险库取凭证，Harness 始终看不到。

**连接存放在机器上，无需按 Agent 或对话分别保存**。用户登录一次，机器上所有 Agent 都可在权限内使用，访问控制集中管理。

有人担心集中存放连接会放大攻击目标。这类设计把密钥挡在 Agent 上下文之外，无需跨 Agent、对话或工具复制凭证，防护集中在这台替用户持有全部连接的机器上。

## PenguinHarness 当前的进展
对照这台机器，**PenguinHarness 已跑通稳定的运行时循环，尚未推出这台机器**。「机器管理」页面可通过 SSH 在用户已有 Linux 或 macOS 主机上安装 PenguinHarness。服务端维持主机连接，断连或重启后自动重连，安装最后一步将 Project 配置同步到主机。

![PenguinHarness「机器管理」页面，展示两台已连接主机，一台是本地服务器，一台通过 SSH 连接。](/blog-assets/machines-page-zh.png)
_「机器管理」页面展示 PenguinHarness 可运行会话的已连接主机；我们不创建也不托管这些机器，也不会在上面预装适配 Agent 的软件。_

我们不创建、托管或售卖云电脑，也不在用户连接的主机上预装软件。

0.2.16 版本中，连接分散在各处。每个 Agent 持有 MCP 配置与「密钥保险柜」密钥，每段对话绑定远程控制机器人，每个浏览器实例保存登录状态，没有统一连接目录。该版本暂无法登录需 OAuth 的 MCP Server。

我们尚未交付 Agent 原生云电脑。

连接在机器层面配置一次，供这台机器上的所有 Agent 使用。

[^1]: [Introducing Muse: The World’s First Personal AI Agent Built for Everyone](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/)
[^2]: [OpenAI launches GPT-6 Astra, its most powerful model yet, and touts its ability to use your computer | Fortune](https://fortune.com/2026/09/03/openai-debuts-gpt-6-astra-computer-use-greg-brockman-says-start-of-agi/)
[^3]: [Scaling Managed Agents: Decoupling the brain from the hands \ Anthropic](https://www.anthropic.com/engineering/managed-agents)
[^4]: [Introducing Cloud Computer: Lowering the Barrier to Building](https://manus.im/blog/manus-cloud-computer)
[^5]: [AXIS: Efficient Human-Agent-Computer Interaction with API-First LLM-Based Agents](https://arxiv.org/abs/2409.17140)
[^6]: [OSWorld 2.0: Benchmarking computer-use agents on long-horizon real-world tasks](https://osworld-v2.xlang.ai/)
[^7]: [How We Built Safety Into Muse | Meta AI Research](https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse)
