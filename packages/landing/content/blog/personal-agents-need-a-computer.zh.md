---
title: "个人 Agent 需要 Agent 原生云电脑"
date: 2026-10-19
category: perspectives
excerpt: "我们认为当前个人 Agent 的核心循环已基本定型。近期进展将来自模型后训练，以及常驻、适配 Agent、持有用户应用连接的云电脑。"
---

2026 年 9 月，三款个人 Agent 产品先后发布，受到开发者广泛关注。Meta 在 2026-09-08 发布 Muse，为每个用户分配隔离的专属 Secure VM。OpenAI 在 2026-09-29 的 DevDay 活动上发布 dots，每个 dot 在云端配有独立电脑和浏览器，用户本地电脑关机后仍可继续运行。微软在 2026-09-25 发布 Copilot Autopilot，运行在组织租户内，拥有独立身份、记忆、电脑和工作空间，用户离开设备后仍可继续处理任务。微软并未说明这台电脑是否为每个用户单独分配。

我们从这三款产品的设计里看到，个人 Agent 正在拆成三个独立组件，分别是能力更强的模型、Agent Runtime（运行时）、Agent 原生云电脑。我们判断运行时的核心循环已基本定型。近期能带来实质体验提升的进展来自两个方向。第一个方向是厂商针对 Agent 任务场景做的模型后训练。第二个方向是升级宿主环境，把用完即弃的任务级沙箱，换成长生命周期、常驻在线的云电脑。这类云电脑预装适配 Agent 操作的软件，作为统一入口持有用户的所有应用连接。

下图梳理了能力更强的模型、Agent Runtime、Agent 原生云电脑这三个组件，标注了仍需投入工作的部分。

<figure class="post-figure" data-figure="personal-agent-three-parts"> <svg class="fig-svg" viewBox="0 0 560 201" role="img" aria-labelledby="personal-agents-need-a-computer-personal-agent-three-parts-zh-title"> <title id="personal-agents-need-a-computer-personal-agent-three-parts-zh-title">个人 Agent 的三个组件并排展示，中间列是已定型的运行时循环。</title> <defs><marker id="personal-agents-need-a-computer-personal-agent-three-parts-zh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker><path id="personal-agents-need-a-computer-personal-agent-three-parts-zh-line1" d="M-331 61H469"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-zh-line2" d="M-331 76H469"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-zh-line3" d="M174.75 107H974.75"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-zh-line4" d="M174.75 124H974.75"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-zh-line5" d="M174.75 141H974.75"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-zh-line6" d="M174.75 158H974.75"/></defs> <rect x="370.5" y="0.5" width="189" height="199.5" rx="8" class="fig-s2"/> <text x="69" y="25" class="fig-title" text-anchor="middle">能力更强的模型</text> <path d="M0 40H138" class="fig-axis"/> <text x="254" y="25" class="fig-title" text-anchor="middle">Agent Runtime</text> <path d="M152 40H356" class="fig-axis"/> <text x="465" y="25" class="fig-title" text-anchor="middle">Agent 原生云电脑</text> <path d="M382 40H548" class="fig-axis"/> <text class="fig-note" text-anchor="middle"><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-zh-line1" startOffset="50%">变化点：厂商针对</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-zh-line2" startOffset="50%">Agent 环境做后训练</textPath></text> <text x="254" y="61" class="fig-note" text-anchor="middle">核心形态已定型</text> <text x="465" y="61" class="fig-note" text-anchor="middle">需要新的建设工作</text> <rect x="152.75" y="76" width="202.5" height="124" rx="8" class="fig-terminal"/> <rect x="160.75" y="84" width="186.5" height="88" rx="2" class="fig-box"/> <text><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-zh-line3">组装上下文 →</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-zh-line4">调用模型 →</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-zh-line5">执行工具调用 →</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-zh-line6">追加到 Trace</textPath></text> <path d="M317.25 154H333.25V103H315.25" class="fig-edge" marker-end="url(#personal-agents-need-a-computer-personal-agent-three-parts-zh-arrow)"/> <text x="254" y="191" text-anchor="middle">安全/权限防护层</text> <rect x="384" y="89" width="4" height="4" class="fig-marker"/> <text x="395" y="96">持久化且常驻在线</text> <rect x="384" y="114" width="4" height="4" class="fig-marker"/> <text x="395" y="121">适配 Agent 的软件</text> <rect x="384" y="139" width="4" height="4" class="fig-marker"/> <text x="395" y="146">作为统一入口持有应用连接</text> </svg> <ol class="fig-steps"> <li>能力更强的模型</li> <li>变化点：厂商针对 Agent 环境做后训练</li> <li>Agent Runtime</li> <li>核心形态已定型</li> <li>组装上下文 → 调用模型 → 执行工具调用 → 追加到 Trace</li> <li>安全/权限防护层</li> <li>Agent 原生云电脑</li> <li>需要新的建设工作</li> <li>持久化且常驻在线</li> <li>适配 Agent 的软件</li> <li>作为统一入口持有应用连接</li> </ol> <figcaption>我们认为个人 Agent 拆分为三个独立部分；运行时循环是稳定的中间层，模型训练和宿主电脑是近期变化的来源。</figcaption> </figure>

## 我们认为 Agent Runtime 的核心形态已定型

我们描述的核心循环形态，来自对当前主流设计的归纳。在 PenguinHarness 里，一次运行对应一个 Task。每次运行按固定流程推进。它会组装上下文、调用模型、执行返回的工具调用、把结果追加到 Trace，循环往复，直到模型输出不带工具调用的最终结果，或是运行中止。本文提到的 Harness，指 Agent Runtime 里决定每次模型请求包含哪些内容的部分。我们在 0.1.1 版本的文章里提过一个判断。后训练会让模型绑定统一的函数调用约定，不与特定 Harness 耦合，因此精简的设计在切换模型时仍可正常工作。

有两个细节不会动摇这个核心循环的基本形态。第一，Harness 调优仍会影响基准测试分数。《财富》报道，同一个 GPT-6 Astra 模型用标准 Harness 在 ARC-AGI-3 上得分 66%，用增强版 Harness 得分 99.9%。我们不清楚那个增强版 Harness 具体改了什么。第二，我们判断随着 Agent 执行更高风险的操作，循环外围的权限和安全层会持续加厚。比如 Meta 在每台 Muse VM 上运行独立的 Sentinel Agent，作为连接器操作和网络出口的唯一权限判定方；我们把这归为核心循环之外的防护层。

## 模型能力随 Agent 环境上的后训练提升

我们判断近期模型能力提升的第一个来源，是厂商针对 Agent 场景做的后训练。VentureBeat 报道，OpenAI 将 GPT-6 Astra 的能力提升归因于大规模预训练与强化学习的结合。我们判断近期大部分可感知的能力提升，来自在精选 Agent 环境上开展的强化学习。2025-12-01 发布的 DeepSeek-V3.2，引入了覆盖 1800+ 环境的合成 Agent 训练数据生成方法。Anthropic 指出，强化学习所用环境的缺陷，是 Agent 行为不对齐的主要来源。

即便训练侧有这些进展，开放式场景下的 Computer Use（图形界面操作）能力仍然有限。OSWorld 2.0 长程 Computer Use 基准的当前最优成绩来自 Claude Opus 4.8。该配置开启最大思考长度、启用批量工具调用，在 500 步预算下二元任务完成率为 20.6%。基准作者指出，当前 Agent 距离专业级图形界面操作能力仍有明显差距。

## 用完即弃的沙箱缺乏持久性

宿主环境是另一个核心变革方向，首先要解决的是持久性问题。面向单个任务或单个 Session 构建的沙箱每次全新启动。任务或 Session 结束后它会直接重置，丢弃机器内积累的所有状态，包括文件、运行中的进程、内存数据。

Manus 的标准沙箱每次聊天都会重置，无法访问之前的工作内容。Claude Cowork 在 Session 结束时销毁沙箱；Session 和文件会保存到用户的 Claude 账户中。OpenAI 的代码解释器容器在闲置 20 分钟后过期，数据直接丢弃，无法恢复。Windows 365 for Agents 在 30 分钟无 MCP 活动后逐出 Session。每次 Session 结束后它会把 Cloud PC 重置到初始配置，保障隔离性和可审计性。

Anthropic 和微软主动选择了这种重置设计，以简化隔离、审计和故障恢复逻辑。我们认为这种设计没有给 Agent 留出跨天运行进程的空间。Anthropic 在 Managed Agents 重构中，把状态从长生命周期的「宠物」容器迁移到只追加的 Session 日志里。如果容器挂掉，Harness 会把故障捕获为工具调用错误，传回模型处理。

部分服务商提供持久化选项，部分产品直接把持久化设为默认。Vercel Sandbox 默认保留文件系统快照；恢复时你可以通过 `onResume` 钩子重启服务、重建缓存。E2B 沙箱默认运行 5 分钟后超时终止。如果你主动暂停沙箱，文件系统和内存状态会永久保存，不会自动过期。Manus 提供持久化 Cloud Computer 付费档位，可保留用户文件和已安装工具。

在这类用完即弃沙箱的主流设计之外，Meta 和 OpenAI 近期发布的个人 Agent，都为每个用户分配了专属云端主机。Meta 将 Muse Secure VM 定位为用户数据的记录系统，提供持续备份能力。Muse 和 dots 的公开文档没有列出操作系统、机器配置或预装应用清单。我们没有找到公开说明，明确这些主机上的运行进程可以保留多久。dots 本身支持暂停和唤醒后继续工作，但相关文档没有给出进程保留时长的明确承诺。

下表对比了常见主机设计跨任务保留状态的能力。

| 主机类型 | 保留文件 | 保留运行中进程 | 默认重置 |
| --- | --- | --- | --- |
| 单任务沙箱 | ✗（沙箱被丢弃；账户存储可能单独保存文件） | ✗ | 是，任务/Session 结束或闲置超时后重置 |
| 文件系统持久化沙箱（Vercel Sandbox） | ✓（停止时生成快照） | ✗（通过 `onResume` 钩子重启） | 否，文件系统默认在停止后保留 |
| 主动暂停的沙箱（E2B） | ✓ | ✓（暂停时保存内存） | 否，永久保留直到恢复；默认运行超时时间为 5 分钟，超时后杀死进程 |
| 专属个人 Agent 云主机（Muse、dots） | ✓（每用户专属机器） | 未找到公开说明；dots 支持暂停和唤醒继续工作 | 未找到公开说明；厂商称用户离开时工作可继续 |

## 多数默认沙箱缺少适配 Agent 的软件

只解决持久性问题，还做不出可用的个人 Agent 宿主。很多默认沙箱镜像只预装开发者工具链，不带桌面环境，也没有日常工作需要的完整办公套件。E2B 的默认 Debian 基础镜像预装 Python 3、Node、git 和 build-essential，没有桌面环境；可选的 Ubuntu 桌面模板会额外安装 LibreOffice、Firefox、Chrome 和 VS Code。Anthropic 的代码执行沙箱禁用公网访问，文档列出的预装包包含 python-docx、python-pptx 和 openpyxl，但没有 LibreOffice。

下图展示了 Agent 可用的软件访问层级，从基础镜像向上到适配接口，同时标注了已发表研究中图形界面模式和适配接口模式的实测性能。

<figure class="post-figure" data-figure="personal-agent-software-stack"> <svg class="fig-svg" viewBox="0 0 560 218" role="img" aria-labelledby="personal-agents-need-a-computer-personal-agent-software-stack-zh-title"> <title id="personal-agents-need-a-computer-personal-agent-software-stack-zh-title">Agent 可用的软件访问层级堆叠图，从基础镜像向上到适配接口，标注了图形界面和适配接口模式的性能数据。</title> <rect x="1" y="1" width="558" height="96" rx="6" class="fig-box"/> <text x="16" y="25" class="fig-label">带 Agent 适配接口的应用（CLI（命令行）/API/MCP）</text> <path d="M17 39V59" class="fig-axis"/> <text x="28" y="52">相比 GUI 减少 65–70% 任务完成时间（AXIS，微软研究院）</text> <path d="M17 69V89" class="fig-axis"/> <text x="28" y="82">在 GUI 基础上增加 API 操作，o1 步数减少 58.5%（UFO2，微软）</text> <rect x="1" y="105" width="558" height="66" rx="6" class="fig-box"/> <text x="16" y="129" class="fig-label">仅支持 GUI 的桌面应用</text> <path d="M17 143V163" class="fig-axis"/> <text x="28" y="156">二元成功率 20.6%，OSWorld 2.0 当前最优成绩（Claude Opus 4.8，500 步预算）</text> <rect x="1" y="179" width="558" height="38" rx="6" class="fig-box"/> <text x="16" y="203" class="fig-label">基础沙箱镜像（Linux + 开发工具）</text> </svg> <ol class="fig-steps"> <li>基础沙箱镜像（Linux + 开发工具）</li> <li>仅支持 GUI 的桌面应用</li> <li>二元成功率 20.6%，OSWorld 2.0 当前最优成绩（Claude Opus 4.8，500 步预算）</li> <li>带 Agent 适配接口的应用（CLI（命令行）/API/MCP）</li> <li>相比 GUI 减少 65–70% 任务完成时间（AXIS，微软研究院）</li> <li>在 GUI 基础上增加 API 操作，o1 步数减少 58.5%（UFO2，微软）</li> </ol> <figcaption>很多默认沙箱镜像只预装到开发者工具层；实测对比显示，走 API 路径比纯图形界面操作减少 65–70% 的任务完成时间，在图形界面基础上增加 API 操作可让 o1 的平均步数减少 58.5%。</figcaption> </figure>

Claude Managed Agents 默认 Ubuntu 镜像预装了无头模式 LibreOffice、pandoc、Playwright 和 Chromium。Anthropic 公开的 pptx Skill 自带自定义封装，解决在目标沙箱里直接调用 `soffice` 二进制时的进程挂起问题。这是一个有公开记录的案例。预装的办公软件需要做小幅适配，才能被 Agent 稳定调用。大型厂商目前为生产力场景提供 MCP Server、CLI 和应用内插件的组合，没有做预装的、适配 Agent 的办公套件。微软公开的 Agent 365 Model Context Protocol（MCP）Server 覆盖 Outlook 邮件、日历、Teams 和 SharePoint/OneDrive；没有列出可编辑 Word、Excel 或 PowerPoint 文档内容的 MCP Server。Google 公开的 Workspace Agent 工具列表包含 Gmail、Drive、日历、Chat 和联系人的 MCP Server，外加一个 CLI；没有提到 Docs、Sheets 或 Slides 的 MCP Server。

Every 提出的对等规则要求，用户能通过 UI 完成的操作，Agent 都应该能通过工具完成。预装软件需要提供对应的适配接口，不能只留一个可点击的桌面给 Agent 操作。

## Agent 原生云电脑的必要条件

我们认为可用的个人 Agent 宿主需要四个具体特性。

第一是常驻在线与持久性。文件、已安装工具、已登录的浏览器会话、长运行进程要能跨任务保留，用户离开设备时也不丢失。

第二是预装日常使用的软件，覆盖范围不局限于开发者工具链。

第三是为这些软件优先提供适配接口，包括 CLI、API、MCP。Computer Use 只作为没有专用端点应用的兜底方案。

第四是作为统一入口持有用户的所有应用连接。连接器、网站登录态和凭证只需配置一次，就能服务所有任务，不需要每个 Session 或每台设备重复配置。

Meta 已经把所有连接服务的凭证存在 Muse Secure VM 上。独立的 Sentinel Agent 会在网络边界替换真实 Token，主 Agent 永远接触不到原始凭证。

OpenAI 为 dots 划分了三类连接。三类分别是消息渠道、已连接应用与插件，以及可选的本地电脑。仅连接消息渠道，不会授予 Agent 访问收件箱或应用数据的权限。

这个统一入口只覆盖 Agent 访问用户应用的出站连接，不涉及用户给 Agent 发消息的入站渠道。

我们目前不知道有任何现有产品完全满足以上所有要求。

## PenguinHarness 当前的位置

在 PenguinHarness 里，Agent Runtime 已经可用。核心循环、只追加的 JSONL Trace、基于文件的 Agent State 目前都稳定运行。桌面端不需要保持主窗口打开。关闭窗口默认会把应用隐藏到系统托盘，嵌入式服务器和后台任务会继续运行。

「机器管理」功能支持通过 SSH 连接现有 Linux 或 macOS 主机，只要服务器能访问到目标主机即可。该功能暂不支持 Windows 主机，页面仅管理员可见。连接成功后，远程主机会运行独立的普通权限 `penguin server` 进程；安装过程不会修改 sudo 配置，也不会添加系统服务单元，对用户的 profile 文件不做任何编辑。远程服务器没有内置监管机制。机器重启后，下一次探测时会显示为「未运行」；服务器完全关闭会中止正在运行的任务，杀死残留的后台进程。

我们不创建也不托管云机器。产品没有内置操作系统级的 Computer Use 控制能力，成套的适配版办公应用也不在预装范围内。

针对访问用户应用的出站连接，我们提供两类基础能力。一类是单 Agent 粒度的 MCP Server 配置项与「密钥保险柜」，另一类是通过桌面应用或配对 Chrome 扩展实现的浏览器访问能力。

针对入站消息，我们支持飞书/Lark、Telegram、QQ 和微信渠道。这些渠道只负责在会话和聊天软件之间转发消息，不会授予 Agent 访问这些应用自身数据的权限。

这些组件的作用范围各不相同。MCP Server 和密钥保险柜是单 Agent 粒度。内置浏览器登录态是单 Project 粒度，配对 Chrome 访问权绑定到单个用户。聊天机器人的配置按单会话生效。

当前产品没有统一的连接入口。当前产品没有内置连接器目录。MCP Server 暂不支持 OAuth 登录，网络边界也没有部署用于替换密钥的凭证代理。

密钥保险柜里的值不会出现在初始提示词中，但会传入命令执行环境。Shell 命令的输出不会做脱敏处理，因此命令可以把密钥打印到模型能读取的工具结果里。

连接层之外，我们在 Environment 实现上也还没走到云电脑这一步。我们设计核心 Environment（运行环境）接口时，目标是替换后端实现时不需要改动运行时循环。目前这个接口只提供了本地进程的实现。远程机器上运行的是完整独立服务器，没有通过这个接口接入。

下图是「机器管理」页面的截图，已连接的主机会以卡片形式展示，你可以直接在卡片上发起会话。

![PenguinHarness「机器管理」页面，展示两台已连接主机，一台是本地服务器，一台通过 SSH 连接。](/blog-assets/machines-page-zh.png)
_「机器管理」页面展示 PenguinHarness 可运行会话的已连接主机；我们不创建也不托管这些机器，也不会在上面预装适配 Agent 的软件。_

---

**Sources**: [Meta Muse 发布公告](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/) · [Meta Muse 安全与防护说明](https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse) · [OpenAI dots 文档](https://learn.chatgpt.com/docs/dots) · [微软 Copilot Autopilot 发布公告](https://blogs.microsoft.com/blog/2026/09/25/introducing-the-new-copilot-with-home-code-and-autopilot/) · [GPT-6 Astra ARC-AGI-3 测试结果（财富）](https://fortune.com/2026/09/03/openai-debuts-gpt-6-astra-computer-use-greg-brockman-says-start-of-agi/) · [OSWorld 2.0 基准测试](https://osworld-v2.xlang.ai/) · [Claude Managed Agents 扩展实践](https://www.anthropic.com/engineering/managed-agents) · [Vercel Sandbox 持久化说明](https://vercel.com/docs/sandbox/concepts/persistent-sandboxes) · [E2B Sandbox 持久化说明](https://docs.e2b.dev/sandbox/persistence) · [Claude Managed Agents 云沙箱参考文档](https://platform.claude.com/docs/en/managed-agents/cloud-sandboxes-reference) · [AXIS 研究（arXiv）](https://arxiv.org/abs/2409.17140) · [UFO2 研究（arXiv）](https://arxiv.org/html/2504.14603v2) · [Every Agent 原生架构指南](https://every.to/guides/agent-native)
