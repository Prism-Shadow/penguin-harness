---
title: "从 A2UI 到 A2APP"
date: 2026-10-19
category: perspectives
excerpt: "A2UI 让 Agent 在单条回复里提供内联界面代替纯文本。A2APP 让 Agent 在「聊天」标签旁托管专属应用，通过服务端 API 逐轮调用，无需单独部署即可在同一处完成工作。"
---

> 本文基于 PenguinHarness 0.2.16 撰写，之后的版本在部分细节上可能有所不同。

A2UI 改变了单条回复里 Agent 与人的交互方式，让 Agent 不必只发送文本，还能提供内联界面。Google 在 2025 年 12 月发布 A2UI 项目，将其定义为 Agent 驱动 UI 的声明式数据格式，客户端从可信组件目录渲染组件，不执行 Agent 提供的代码。

A2APP 把交互模式再往前推了一步。Agent 可以在「聊天」标签旁托管专属应用，通过一套边界明确的服务端 API 逐轮接收调用。人和 Agent 不用单独部署环境，在同一个界面就能做完所有工作。“A2APP”是我们给这种模式起的名字，不是行业标准。

下面的截图展示了一个典型的 PenguinHarness 回复，使用了我们借鉴 A2UI 设计思路做的 A2UI 组件块。

![PenguinHarness 聊天回复，包含带「查看源码」的上线流程图、带提示和说明的三步准备块，以及未作答的金丝雀流量选择，选项有 5% 推荐、25%、跳过金丝雀、其他…](/blog-assets/penguinharness-0-2-14-a2ui-blocks-zh.png)
_PenguinHarness 的 A2UI 组件块借鉴 A2UI 的声明式设计，在回复内渲染可信目录内的组件；图表使用标准 Mermaid 代码块，仅主对话最新一条回复内的组件可接收输入。_

## 当前权衡的两个边界

我们认为 A2UI 组件块适合单轮交互，但在支撑重复的专属工作界面时会遇到瓶颈。我们借鉴 A2UI 设计思路做的组件块，只传输预审核组件的字段值，从不传输原始 HTML、脚本或样式。用户在组件里做的选择、填的表单内容会先存在输入框里，不会直接触发操作，等用户点「发送」才会真正提交。

只有主对话里最新的一条回复能接收组件输入；更早的回复、子 Agent 对话、Trace 视图里的组件都是只读的。天气和指标组件是模型提供的静态快照，不会在客户端发起请求；只有时钟和倒计时组件会在渲染后做本地更新。

我们认为 vibe coding 站在另一个边界上。这种模式放开安全护栏，换完整的代码表达能力，把代码当成用完即弃的交付物。

Andrej Karpathy 在 2025 年 2 月提出 vibe coding 这个词。他说这种编码方式完全顺着感觉走，接受所有生成的改动，甚至忘记代码存在。拿来做周末的一次性小项目还算可以。Simon Willison 后来收窄了定义，专指用 LLM 构建软件、且不审查生成代码的做法。

Karpathy 后来记录了做 MenuGen 的体验。做本地演示畅快又好玩，按他的说法，把这类 demo 做成可上线的正式应用，过程有点痛苦繁琐，大部分时间都耗在调整配置、拼接服务上。他在 2025 年底的年终文章里写，代码突然变得免费、易逝、可塑，用完一次就可以丢弃。

这种模式在生产场景下有明显短板。Airtable 的 Howie Liu 指出，vibe coding 写出来的应用往往表面精致，底下却可能藏着 bug、边界情况，以及数据或安全漏洞。

A2UI 组件块和 vibe coding 这两种模式，给面向特定工作的专属工具留下了空白。组件块的边界太死，没法支撑重复的多步骤工作。vibe coding 把搭建专属工作界面、和 Agent 协作完成任务拆成了两件事。代码写完之后，AI 就不在运行中的应用里了。

这张对比图梳理了 A2UI 组件块、vibe coding 应用、A2APP 工作台三者的核心差异。

<figure class="post-figure" data-figure="a2app-three-ways"> <svg class="fig-svg" viewBox="0 0 560 288" role="img" aria-labelledby="from-a2ui-to-a2app-a2app-three-ways-zh-title"> <title id="from-a2ui-to-a2app-a2app-three-ways-zh-title">从四个核心属性对比 A2UI 组件块、vibe coding 应用、A2APP 工作台的三列表格。</title> <text x="88" y="18" class="fig-title" text-anchor="middle">A2UI 组件块</text> <text x="280" y="18" class="fig-title" text-anchor="middle">vibe coding 应用</text> <text x="472" y="18" class="fig-title" text-anchor="middle">A2APP 工作台</text> <text x="1" y="50" class="fig-label" text-anchor="start">UI 来源</text> <rect x="1" y="58" width="174" height="30" rx="4" class="fig-box"/> <text x="88" y="77.5" text-anchor="middle">可信目录</text> <rect x="193" y="58" width="174" height="30" rx="4" class="fig-box"/> <text x="280" y="77.5" text-anchor="middle">生成代码</text> <rect x="385" y="58" width="174" height="30" rx="4" class="fig-box"/> <text x="472" y="77.5" text-anchor="middle">生成代码</text> <text x="1" y="116" class="fig-label" text-anchor="start">UI 出现位置</text> <rect x="1" y="124" width="174" height="30" rx="4" class="fig-box"/> <text x="88" y="143.5" text-anchor="middle">聊天回复</text> <rect x="193" y="124" width="174" height="30" rx="4" class="fig-box"/> <text x="280" y="143.5" text-anchor="middle">独立部署</text> <rect x="385" y="124" width="174" height="30" rx="4" class="fig-box"/> <text x="472" y="143.5" text-anchor="middle">「聊天」标签旁 / 占满应用</text> <text x="1" y="182" class="fig-label" text-anchor="start">创建后 AI 的角色</text> <rect x="1" y="190" width="174" height="30" rx="4" class="fig-box"/> <text x="88" y="209.5" text-anchor="middle">等待下一轮</text> <rect x="193" y="190" width="174" height="30" rx="4" class="fig-box"/> <text x="280" y="209.5" text-anchor="middle">不在运行中的应用里</text> <rect x="385" y="190" width="174" height="30" rx="4" class="fig-box"/> <text x="472" y="209.5" text-anchor="middle">逐轮运行任务</text> <text x="1" y="248" class="fig-label" text-anchor="start">用户入口</text> <rect x="1" y="256" width="174" height="30" rx="4" class="fig-box"/> <text x="88" y="275.5" text-anchor="middle">选选项 / 填表单</text> <rect x="193" y="256" width="174" height="30" rx="4" class="fig-box"/> <text x="280" y="275.5" text-anchor="middle">打开 URL</text> <rect x="385" y="256" width="174" height="30" rx="4" class="fig-box"/> <text x="472" y="275.5" text-anchor="middle">打开标签页</text> </svg> <ol class="fig-steps"> <li>A2UI 组件块</li> <li>vibe coding 应用</li> <li>A2APP 工作台</li> <li>UI 来源</li> <li>可信目录</li> <li>生成代码</li> <li>生成代码</li> <li>UI 出现位置</li> <li>聊天回复</li> <li>独立部署</li> <li>「聊天」标签旁 / 占满应用</li> <li>创建后 AI 的角色</li> <li>等待下一轮</li> <li>不在运行中的应用里</li> <li>逐轮运行任务</li> <li>用户入口</li> <li>选选项 / 填表单</li> <li>打开 URL</li> <li>打开标签页</li> </ol> <figcaption>A2APP 结合了完整代码的表达能力和与 Agent 之间窄范围的纯文本连接，改变了界面构建完成后 AI 所处的位置。</figcaption> </figure>

## PenguinHarness 中的 Agent Workbench

在 PenguinHarness 里，这种模式的落地就是 Agent Workbench。每个 Agent 都可以有自己的专属应用，以纯文件形式存储在 Agent 的目录下。下面的截图来自法务智能体示例里的「合同工作台」，这个页面会作为「聊天」旁的标签页打开，也可以占满整个应用窗口。

![「合同工作台」在「聊天」旁的标签页打开，展示合同审核的上传提示和文件状态表格。](/blog-assets/workflow-page-zh.png)
_工作台作为 Agent 聊天旁的专属标签页出现，搭载为特定工作定制的界面。_

工作台选了和 A2UI 组件块相反的信任策略。Agent 可以把 TypeScript 服务入口、纯 HTML/CSS/JavaScript 页面写入标准文件夹结构，不需要单独走构建、打包、部署流程。服务端每次加载都会先检查 TypeScript 入口的类型，通过后热重载已打开的标签页，同时保留最近 20 个加载成功的版本。

工作台从属于创建它的 Agent，不会脱离 Agent 单独存在。我们给工作台服务开放了一套边界明确的宿主 API。API 支持创建 Session、启动纯文本 Agent 轮次、轮询结果快照、持久化状态。

Agent 不会直接收到页面点击事件或 UI 状态。工作台服务逐轮调用 Agent，只传入文本内容。调用方轮询最新任务的快照，拿到运行中、最终回答或失败三类状态。

工作台的服务端代码目前没做沙箱隔离，这是我们还没解决的工程限制。运行时通过 import() 加载 TypeScript 入口，代码直接跑在主服务进程里，持有服务端全部权限。插件附带的工作台代码（比如内置的客服工作台）也遵循同样的运行规则。

工作台的 UI 页面是纯 HTML、CSS、JavaScript，直接从磁盘发给浏览器。页面以同源 iframe 形式运行，可以用当前登录用户的身份调用任意 API。

工作台启动的 Session 运行在全允许模式下，没有每一步的审批提示。只运行你信任的工作台代码。

Agent 和对应的工作台之间跑着两套独立的循环。一套是处理工作台 UI 触发后台任务的工作台任务循环，另一套是处理聊天里编辑请求的聊天编辑循环。工作台任务循环和聊天编辑循环各自独立运行，下图画出了两者的交互路径。

<figure class="post-figure" data-figure="a2app-two-loops"> <svg class="fig-svg" viewBox="0 0 560 482" role="img" aria-labelledby="from-a2ui-to-a2app-a2app-two-loops-zh-title"> <title id="from-a2ui-to-a2app-a2app-two-loops-zh-title">双流程图，展示运行后台工作的工作台任务循环，以及编辑应用的聊天循环。</title> <defs><marker id="from-a2ui-to-a2app-a2app-two-loops-zh-use" viewBox="0 0 10 10" refX="10" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto"><path d="M0 0L10 5L0 10Z" class="fig-s1"/></marker><marker id="from-a2ui-to-a2app-a2app-two-loops-zh-build" viewBox="0 0 10 10" refX="10" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto"><path d="M0 0L10 5L0 10Z" class="fig-s3"/></marker></defs> <path d="M16 12L44 12" class="fig-s2" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-use)"/> <text x="52" y="16" class="fig-label" text-anchor="start">工作台任务循环</text> <path d="M176 12L204 12" class="fig-s3" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-build)"/> <text x="212" y="16" class="fig-label" text-anchor="start">聊天编辑循环</text> <g transform="translate(0 26)"> <rect x="16" y="20" width="180" height="36" rx="6" class="fig-terminal"/> <text x="106" y="42" class="fig-label" text-anchor="middle">用户</text> <rect x="400" y="20" width="132" height="36" rx="6" class="fig-box"/> <text x="466" y="42" class="fig-label" text-anchor="middle">聊天标签页</text> <path d="M196 31L400 31" class="fig-s3" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-build)"/> <text x="298" y="26" text-anchor="middle">编辑请求</text> <path d="M400 45L196 45" class="fig-s3" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-build)"/> <path d="M28 56L28 136" class="fig-s2" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-use)"/> <text x="34" y="100" text-anchor="start">点击/上传</text> <path d="M124 136L124 56" class="fig-s2" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-use)"/> <text x="130" y="100" text-anchor="start">展示输出</text> <path d="M412 56L412 136" class="fig-s3" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-build)"/> <path d="M520 136L520 56" class="fig-s3" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-build)"/> <text x="514" y="108" text-anchor="end">状态回复</text> <rect x="16" y="136" width="180" height="36" rx="6" class="fig-box"/> <text x="106" y="158" class="fig-label" text-anchor="middle">工作台 UI</text> <rect x="400" y="136" width="132" height="36" rx="6" class="fig-terminal"/> <text x="466" y="158" class="fig-label" text-anchor="middle">Agent</text> <path d="M28 172L28 262" class="fig-s2" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-use)"/> <text x="34" y="217" text-anchor="start">API 调用</text> <path d="M92 262L92 172" class="fig-s2" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-use)"/> <text x="98" y="217" text-anchor="start">状态更新</text> <path d="M184 262L184 172" class="fig-s3" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-build)"/> <text x="190" y="207" text-anchor="start">成功后刷新</text> <path d="M466 262L466 172" class="fig-s2" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-use)"/> <text x="460" y="227" text-anchor="end">仅文本，无 UI 点击</text> <rect x="16" y="262" width="180" height="80" rx="6" class="fig-box"/> <text x="106" y="306" class="fig-label" text-anchor="middle">工作台服务</text> <rect x="400" y="262" width="132" height="80" rx="6" class="fig-box"/> <text x="466" y="306" class="fig-label" text-anchor="middle">宿主 API</text> <path d="M196 284L400 284" class="fig-s2" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-use)"/> <text x="298" y="279" text-anchor="middle">createSession/run</text> <path d="M196 308L400 308" class="fig-s2" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-use)"/> <text x="298" y="303" text-anchor="middle">轮询 sessionResult 快照</text> <path d="M400 332L196 332" class="fig-s2" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-use)"/> <text x="298" y="327" text-anchor="middle">sessionResult 快照</text> <path d="M532 154L548 154" class="fig-s3"/> <path d="M548 154L548 430" class="fig-s3"/> <path d="M548 430L532 430" class="fig-s3" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-build)"/> <text x="542" y="392" text-anchor="end">编辑代码</text> <path d="M420 412L420 372" class="fig-s3"/> <path d="M420 372L150 372" class="fig-s3"/> <path d="M150 372L150 342" class="fig-s3" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-build)"/> <text x="285" y="366" text-anchor="middle">类型检查 + 重载</text> <rect x="16" y="412" width="180" height="36" rx="6" class="fig-box"/> <text x="106" y="434" class="fig-label" text-anchor="middle">版本历史</text> <rect x="400" y="412" width="132" height="36" rx="6" class="fig-box"/> <text x="466" y="434" class="fig-label" text-anchor="middle">工作台文件</text> <path d="M400 430L196 430" class="fig-s3" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-build)"/> <text x="298" y="425" text-anchor="middle">保存版本</text> </g> </svg> <ol class="fig-steps"> <li>工作台任务循环</li> <li>用户</li> <li>工作台 UI</li> <li>工作台服务</li> <li>宿主 API</li> <li>Agent</li> <li>点击/上传</li> <li>API 调用</li> <li>createSession/run</li> <li>仅文本，无 UI 点击</li> <li>轮询 sessionResult 快照</li> <li>sessionResult 快照</li> <li>状态更新</li> <li>展示输出</li> <li>聊天编辑循环</li> <li>聊天标签页</li> <li>工作台文件</li> <li>版本历史</li> <li>编辑请求</li> <li>编辑代码</li> <li>类型检查 + 重载</li> <li>成功后刷新</li> <li>保存版本</li> <li>状态回复</li> </ol> <figcaption>两个循环相互独立，聊天里的编辑操作不会打断正在运行的后台任务；Agent 只接收工作台服务发来的文本，看不到页面上的直接操作。</figcaption> </figure>

## 在同一处使用和修改应用

用户可以打开工作台标签页上传合同、提交客服问题、查看结果，不需要先发任何聊天消息。要改应用，就在工作台旁的「聊天」标签页里提需求。比如你可以让法务 Agent 给「合同工作台」加一列风险等级。表格会直接更新，不需要单独部署，也不用复制粘贴代码。所有改动的版本都会保存在工作台栏的「历史」面板里。

![工作台的「历史」面板打开，列出两个已保存的版本，下方是更新后的「合同工作台」，现在包含风险列。](/blog-assets/workflow-history-zh.png)
_在「聊天」里提出的修改会更新工作台文件，最近加载的版本保存在「历史」面板里；「恢复」操作回滚代码，不回滚已保存的数据。_

你在「聊天」里提完修改需求，Agent 会直接编辑工作台下的文件。新版本通过类型检查加载完成后，已打开的标签页会自动刷新。你也可以在「Agent 设置」的「工作台」标签页里找到同样的版本控制功能。

## 尝试这种模式

行业里已经有类似的思路。MCP Apps 允许工具返回可在对话中渲染的交互式 UI。Claude artifacts 和 Opal 的 agent step 允许模型为用户生成小型交互式应用。Ink & Switch 的 Patchwork 项目也在探索可塑软件的类似方向。用户可以从聊天里构建、调整小型工具。

我们聚焦的是一个特定组合。Agent 生成并编辑专属应用，应用作为「聊天」旁的标签页打开，逐轮调用 Agent 完成工作。

新建 Project 时，默认 Agent 已经预装了生成工作台需要的构建类 Skill。

要端到端尝试这个模式，可以按以下步骤操作。
- 打开起始页，选择「一句话构建法务智能体应用」，然后按「发送」生成一个带专属工作台标签页的法务 Agent。
- 打开创建好的 Agent，新建对话，选择工作台标签页开始使用。
- 在这个 Agent 的「聊天」标签页里提出调整需求，比如加一列按风险等级排序合同。
- 如果需要，用工作台栏上的「历史」面板回滚到之前的代码版本。

---
**Sources**: [Google A2UI 团队](https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/) · [Simon Willison](https://simonwillison.net/2025/Mar/19/vibe-coding/) · [Andrej Karpathy](https://karpathy.bearblog.dev/vibe-coding-menugen/) · [Andrej Karpathy](https://karpathy.bearblog.dev/year-in-review-2025/) · [Airtable](https://airtable.com/newsroom/introducing-the-ai-native-airtable) · [MCP 核心维护团队](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/) · [Simon Willison](https://simonwillison.net/2025/Jun/25/ai-powered-apps-with-claude/) · [Anthropic](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them) · [Google Labs](https://blog.google/innovation-and-ai/models-and-research/google-labs/opal-agent/) · [Ink & Switch](https://www.inkandswitch.com/essay/malleable-software/)
