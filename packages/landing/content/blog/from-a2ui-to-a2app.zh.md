---
title: "从 A2UI 到 A2APP"
date: 2026-10-19
category: perspectives
excerpt: "A2UI 将结构化界面嵌入聊天回复。A2APP 为每个 Agent 搭配专属任务应用，承载逐轮推进的工作。"
---

> 本文基于 PenguinHarness 0.2.16 撰写，之后的版本在部分细节上可能有所不同。

Google 开源的 A2UI 项目改变了人机交互方式，把结构化交互从纯文本搬到聊天回复里。[^1]PenguinHarness 参照这套思路做了 A2UI 组件块，组件均来自受信任目录，在回复内联渲染。[^2][^3][^4]

![PenguinHarness 聊天回复界面，包含带「查看源码」按钮的发布流程 Mermaid 流程图、带提示与说明的三步准备步骤块，以及金丝雀流量比例选择题，选项为 5%「推荐」、25%、跳过金丝雀、「其他…」](/blog-assets/penguinharness-0-2-14-a2ui-blocks-zh.png)
_PenguinHarness 的 A2UI 组件块参照 A2UI 设计，在回复内联渲染预先审核的目录组件，图表使用标准 Mermaid 代码块_

A2APP 是我们给这种模式起的名字，不是既定标准。它把交互从聊天消息挪到专属软件界面。PenguinHarness 选择用工作台落地 A2APP。工作台是聊天旁面向具体任务的应用，逐轮调用对应 Agent 完成工作，也能由所属 Agent 在用户提出要求时修改。[^5]

## A2UI 解决了什么，留下了什么
Google 为 A2UI 定下目标，界面要像数据一样安全，又像代码一样有表达力，Agent 只能调用预先审核通过的目录组件，不会发送可执行代码。[^1]

PenguinHarness 的 A2UI 组件块沿用这套安全模型，没有实现 Google 定义的 A2UI 协议。[^3][^4]客户端按 Agent 提供的字段渲染目录组件，Agent 永远不会发送 HTML、脚本或样式。[^2][^6]

用户在组件里的选择只会填进输入框，按下「发送」后才会发出。[^7][^8]只有主对话最新一条回复支持输入，更早的组件块均为只读。[^7]天气、指标类组件是模型生成的静态快照，客户端不额外拉取数据。[^2][^9]组件块只处理单条回复内的选项和步骤，边界到这条回复为止。

跳出单条回复的边界，vibe coding 产出独立应用。Karpathy 在 2025 年初创造这个词，指代未经人工审核的生成代码，适合做周末一次性小项目。[^10][^11]他后来提到，本地跑演示很容易，真要部署成可用应用会麻烦很多。[^12]三者在四个维度上的差异见下图。

<figure class="post-figure" data-figure="a2app-three-ways"> <svg class="fig-svg" viewBox="0 0 560 288" role="img" aria-labelledby="from-a2ui-to-a2app-a2app-three-ways-zh-title"> <title id="from-a2ui-to-a2app-a2app-three-ways-zh-title">从四个核心属性对比 A2UI 组件块、vibe coding 应用、A2APP 工作台的三列表格。</title> <text x="88" y="18" class="fig-title" text-anchor="middle">A2UI 组件块</text> <text x="280" y="18" class="fig-title" text-anchor="middle">vibe coding 应用</text> <text x="472" y="18" class="fig-title" text-anchor="middle">A2APP 工作台</text> <text x="1" y="50" class="fig-label" text-anchor="start">UI 来源</text> <rect x="1" y="58" width="174" height="30" rx="4" class="fig-box"/> <text x="88" y="77.5" text-anchor="middle">可信目录</text> <rect x="193" y="58" width="174" height="30" rx="4" class="fig-box"/> <text x="280" y="77.5" text-anchor="middle">生成代码</text> <rect x="385" y="58" width="174" height="30" rx="4" class="fig-box"/> <text x="472" y="77.5" text-anchor="middle">生成代码</text> <text x="1" y="116" class="fig-label" text-anchor="start">UI 出现位置</text> <rect x="1" y="124" width="174" height="30" rx="4" class="fig-box"/> <text x="88" y="143.5" text-anchor="middle">聊天回复</text> <rect x="193" y="124" width="174" height="30" rx="4" class="fig-box"/> <text x="280" y="143.5" text-anchor="middle">独立部署</text> <rect x="385" y="124" width="174" height="30" rx="4" class="fig-box"/> <text x="472" y="143.5" text-anchor="middle">「聊天」标签旁 / 占满应用</text> <text x="1" y="182" class="fig-label" text-anchor="start">创建后 AI 的角色</text> <rect x="1" y="190" width="174" height="30" rx="4" class="fig-box"/> <text x="88" y="209.5" text-anchor="middle">等待下一轮</text> <rect x="193" y="190" width="174" height="30" rx="4" class="fig-box"/> <text x="280" y="209.5" text-anchor="middle">不在运行中的应用里</text> <rect x="385" y="190" width="174" height="30" rx="4" class="fig-box"/> <text x="472" y="209.5" text-anchor="middle">逐轮运行任务</text> <text x="1" y="248" class="fig-label" text-anchor="start">用户入口</text> <rect x="1" y="256" width="174" height="30" rx="4" class="fig-box"/> <text x="88" y="275.5" text-anchor="middle">选选项 / 填表单</text> <rect x="193" y="256" width="174" height="30" rx="4" class="fig-box"/> <text x="280" y="275.5" text-anchor="middle">打开 URL</text> <rect x="385" y="256" width="174" height="30" rx="4" class="fig-box"/> <text x="472" y="275.5" text-anchor="middle">打开标签页</text> </svg> <ol class="fig-steps"> <li>A2UI 组件块</li> <li>vibe coding 应用</li> <li>A2APP 工作台</li> <li>UI 来源</li> <li>可信目录</li> <li>生成代码</li> <li>生成代码</li> <li>UI 出现位置</li> <li>聊天回复</li> <li>独立部署</li> <li>「聊天」标签旁 / 占满应用</li> <li>创建后 AI 的角色</li> <li>等待下一轮</li> <li>不在运行中的应用里</li> <li>逐轮运行任务</li> <li>用户入口</li> <li>选选项 / 填表单</li> <li>打开 URL</li> <li>打开标签页</li> </ol> <figcaption>A2APP 结合了完整代码的表达能力和与 Agent 之间窄范围的纯文本连接，改变了界面构建完成后 AI 所处的位置。</figcaption> </figure>

## 作为 A2APP 的工作台
在 PenguinHarness 里，工作台是绑定单个 Agent 的小型应用。代码存放在对应 Agent 的专属目录，标签页显示在「聊天」旁，不用等用户发消息，加载完就能直接用。[^5][^13]法务场景的「合同工作台」是典型例子，整个界面只为合同审核这一项任务设计，包含文件上传区域和审核状态表格。[^5]

![「合同工作台」在「聊天」旁的标签页打开，界面展示合同审核场景的上传提示与文件状态表格](/blog-assets/workflow-page-zh.png)
_工作台在对应 Agent 的聊天侧边以专属标签页呈现，界面为单一具体任务定制_

工作台的服务端代码直接跑在主服务进程里，不做沙箱隔离。[^14]它启动的 Session 运行在全允许模式，没有哪一步会停下来等人审批。[^14][^15]服务端和 Agent 之间只走一组固定、边界清晰的 host API。[^16]

Agent 全程看不到前端页面，也感知不到用户的点击操作。[^14][^16]它只逐轮收到服务端发来的文本，[^14][^16]服务端会主动轮询 Agent 返回的最终结果快照，用这份数据更新前端展示。[^13][^16]

整套机制并行跑着两个循环，分别是页面经服务端发起的任务循环，以及在「聊天」标签页提出的编辑循环。

<figure class="post-figure" data-figure="a2app-two-loops"> <svg class="fig-svg" viewBox="0 0 560 456" role="img" aria-labelledby="from-a2ui-to-a2app-a2app-two-loops-zh-title"> <title id="from-a2ui-to-a2app-a2app-two-loops-zh-title">双流程示意图，分别展示工作台执行后台任务的任务循环，以及用于修改应用的聊天编辑循环</title> <defs><marker id="from-a2ui-to-a2app-a2app-two-loops-zh-use" viewBox="0 0 10 10" refX="10" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto"><path d="M0 0L10 5L0 10Z" class="fig-s1"/></marker><marker id="from-a2ui-to-a2app-a2app-two-loops-zh-build" viewBox="0 0 10 10" refX="10" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto"><path d="M0 0L10 5L0 10Z" class="fig-s3"/></marker></defs> <rect x="16" y="20" width="180" height="36" rx="6" class="fig-terminal"/> <text x="106" y="42" class="fig-label" text-anchor="middle">人</text> <rect x="400" y="20" width="132" height="36" rx="6" class="fig-box"/> <text x="466" y="42" class="fig-label" text-anchor="middle">「聊天」标签页</text> <path d="M196 31L400 31" class="fig-s3" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-build)"/> <text x="298" y="26" text-anchor="middle">编辑请求</text> <path d="M400 45L196 45" class="fig-s3" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-build)"/> <text x="298" y="59" text-anchor="middle">确认信息</text> <path d="M28 56L28 136" class="fig-s2" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-use)"/> <text x="34" y="100" text-anchor="start">点击/上传</text> <path d="M124 136L124 56" class="fig-s2" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-use)"/> <text x="130" y="100" text-anchor="start">展示输出</text> <path d="M412 56L412 136" class="fig-s3" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-build)"/> <text x="406" y="92" text-anchor="end">用户消息</text> <path d="M520 136L520 56" class="fig-s3" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-build)"/> <text x="514" y="108" text-anchor="end">状态回复</text> <rect x="16" y="136" width="180" height="36" rx="6" class="fig-box"/> <text x="106" y="158" class="fig-label" text-anchor="middle">工作台 UI</text> <rect x="400" y="136" width="132" height="36" rx="6" class="fig-terminal"/> <text x="466" y="158" class="fig-label" text-anchor="middle">Agent</text> <path d="M28 172L28 262" class="fig-s2" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-use)"/> <text x="34" y="217" text-anchor="start">API 调用</text> <path d="M92 262L92 172" class="fig-s2" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-use)"/> <text x="98" y="217" text-anchor="start">状态更新</text> <path d="M184 262L184 172" class="fig-s3" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-build)"/> <text x="190" y="207" text-anchor="start">成功后刷新</text> <path d="M466 262L466 172" class="fig-s2" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-use)"/> <text x="460" y="227" text-anchor="end">仅传文本，不含 UI 点击</text> <rect x="16" y="262" width="180" height="80" rx="6" class="fig-box"/> <text x="106" y="306" class="fig-label" text-anchor="middle">工作台服务端</text> <rect x="400" y="262" width="132" height="80" rx="6" class="fig-box"/> <text x="466" y="306" class="fig-label" text-anchor="middle">Host API</text> <path d="M196 284L400 284" class="fig-s2" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-use)"/> <text x="298" y="279" text-anchor="middle">createSession/run</text> <path d="M196 308L400 308" class="fig-s2" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-use)"/> <text x="298" y="303" text-anchor="middle">轮询 sessionResult 快照</text> <path d="M400 332L196 332" class="fig-s2" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-use)"/> <text x="298" y="327" text-anchor="middle">sessionResult 快照</text> <path d="M532 154L548 154" class="fig-s3"/> <path d="M548 154L548 430" class="fig-s3"/> <path d="M548 430L532 430" class="fig-s3" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-build)"/> <text x="542" y="392" text-anchor="end">修改代码</text> <path d="M420 412L420 372" class="fig-s3"/> <path d="M420 372L150 372" class="fig-s3"/> <path d="M150 372L150 342" class="fig-s3" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-build)"/> <text x="285" y="366" text-anchor="middle">类型检查 + 重新加载</text> <rect x="16" y="412" width="180" height="36" rx="6" class="fig-box"/> <text x="106" y="434" class="fig-label" text-anchor="middle">版本历史</text> <rect x="400" y="412" width="132" height="36" rx="6" class="fig-box"/> <text x="466" y="434" class="fig-label" text-anchor="middle">工作台文件</text> <path d="M400 430L196 430" class="fig-s3" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-build)"/> <text x="298" y="425" text-anchor="middle">保存版本</text> </svg> <ol class="fig-steps"> <li>人</li> <li>工作台 UI</li> <li>工作台服务端</li> <li>Host API</li> <li>Agent</li> <li>点击/上传</li> <li>API 调用</li> <li>createSession/run</li> <li>仅传文本，不含 UI 点击</li> <li>轮询 sessionResult 快照</li> <li>sessionResult 快照</li> <li>状态更新</li> <li>展示输出</li> <li>「聊天」标签页</li> <li>工作台文件</li> <li>版本历史</li> <li>编辑请求</li> <li>用户消息</li> <li>修改代码</li> <li>类型检查 + 重新加载</li> <li>成功后刷新</li> <li>保存版本</li> <li>状态回复</li> <li>确认信息</li> </ol> <figcaption>两个循环并行运行。工作台通过纯文本的服务端调用触发 Agent 后台任务，「聊天」标签页里的请求会让 Agent 修改工作台文件。任务运行过程中，Agent 只接收来自工作台服务端的文本，不会收到直接的 UI 输入</figcaption> </figure>

## 在同一处使用并修改应用
你直接在为具体任务定制的工作台界面里操作。你在界面里完成上传、查看结果这类操作，Agent 处理工作台服务端交给它的后台任务，也会按你在「聊天」里的要求修改应用，人和 Agent 围绕同一项任务在这套专属界面配合完成工作。如果「合同工作台」缺了风险列，在旁边的「聊天」标签页提一句就行。[^5]同一个 Agent 会直接编辑工作台目录下的纯 HTML、CSS 和 JavaScript 文件。[^5][^13][^17]

服务端会对后端 TypeScript 代码做类型检查。检查通过就热重载当前打开的工作台标签页，无需手动刷新。修改失败就自动保留上一个能正常运行的版本。[^5][^18]整个过程没有单独的构建步骤，也不需要安装任何依赖。[^13][^17]每一次成功加载的版本，服务端都会自动存入「历史」面板，最多保留最近 20 条记录。[^5][^19]

![打开的工作台「历史」面板列出两条已保存版本，下方是更新后的「合同工作台」，表格已新增风险列](/blog-assets/workflow-history-zh.png)
_在「聊天」中提出的修改会直接更新工作台文件，最近加载成功的版本保存在「历史」面板；点击「恢复」只会回滚代码，不会改动已保存的数据_

vibe coding 模式下，AI 交付完生成的代码就结束全部工作。在工作台里，同一个 Agent 继续负责应用交给它的工作，并按你的要求调整界面。

## 一个具体的上手起点
MCP Apps、Claude artifacts、Opal mini-apps、Patchwork 都在探索和 Agent 直连的界面形态。[^20][^21][^22]PenguinHarness 的设计是，每个应用绑定负责修改它的那个 Agent，逐轮任务调用全部走 host API。[^16]

PenguinHarness 0.2.16 的启动页有「一句话生成 AI 应用」板块，下面预置了三个一句话启动模板。[^23][^24]用户选任意模板，系统都会创建独立 Agent，同时配好专属工作台。三个模板分别是 RAG 文档专家、投资分析师、法务智能体。[^23][^24]新建 Project 生成的默认 Agent，已经预装了构建工作台所需的三个 Skill。[^13][^25]最终生成的 A2APP 可以直接打开、直接编辑，不需要走单独部署流程，也不用配置外部托管服务。

你现在就可以上手试。新建一个 Project，选法务智能体模板，打开对应的 Agent，点击「新建对话」，切换到工作台标签页就能开始。[^23][^24]

[^1]: [Introducing A2UI: An open project for agent-driven interfaces - Google Developers Blog](https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/)
[^2]: [packages/core/src/a2ui/types.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/core/src/a2ui/types.ts)
[^3]: [packages/](https://github.com/Prism-Shadow/penguin-harness/tree/v0.2.16/packages)
[^4]: [plugins/](https://github.com/Prism-Shadow/penguin-harness/tree/v0.2.16/plugins)
[^5]: [PenguinHarness blog: Give every agent its own hot-reloaded workbench](https://penguin.ooo/blog/build-agent-apps-with-workflows)
[^6]: [plugins/a2ui/skills/a2ui/SKILL.md](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/plugins/a2ui/skills/a2ui/SKILL.md)
[^7]: [changelog/0.2.15/2026-10-03-a2ui-blocks.md](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/changelog/0.2.15/2026-10-03-a2ui-blocks.md)
[^8]: [packages/ui/src/components/content/a2ui/actions.tsx](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/ui/src/components/content/a2ui/actions.tsx)
[^9]: [PenguinHarness docs: Chat](https://penguin.ooo/docs/chat)
[^10]: [Andrej Karpathy (@karpathy) on X](https://x.com/karpathy/status/1886192184808149383)
[^11]: [Not all AI-assisted programming is vibe coding (but vibe coding rocks)](https://simonwillison.net/2025/Mar/19/vibe-coding/)
[^12]: [Vibe coding MenuGen – karpathy](https://karpathy.bearblog.dev/vibe-coding-menugen/)
[^13]: [plugins/agent-development/skills/penguin-plugin/SKILL.md](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/plugins/agent-development/skills/penguin-plugin/SKILL.md)
[^14]: [packages/server/src/workbenches/service.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/server/src/workbenches/service.ts)
[^15]: [changelog/0.2.16/2026-10-14-workbench-management.md](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/changelog/0.2.16/2026-10-14-workbench-management.md)
[^16]: [packages/server/src/mechanisms/workbenches.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/server/src/mechanisms/workbenches.ts)
[^17]: [packages/server/src/workbenches/routes.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/server/src/workbenches/routes.ts)
[^18]: [packages/server/src/workbenches/compile.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/server/src/workbenches/compile.ts)
[^19]: [packages/server/src/workbenches/store.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/server/src/workbenches/store.ts)
[^20]: [MCP Apps - Bringing UI Capabilities To MCP Clients | Model Context Protocol Blog](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/)
[^21]: [Build and share AI-powered apps with Claude](https://simonwillison.net/2025/Jun/25/ai-powered-apps-with-claude/)
[^22]: [Build and share AI-powered apps with Claude | Claude by Anthropic](https://claude.com/blog/claude-powered-artifacts)
[^23]: [changelog/0.2.16/RELEASE.md](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/changelog/0.2.16/RELEASE.md)
[^24]: [packages/web/src/lib/strings-en.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/web/src/lib/strings-en.ts)
[^25]: [changelog/0.2.15/2026-08-30-workflows.md](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/changelog/0.2.15/2026-08-30-workflows.md)
