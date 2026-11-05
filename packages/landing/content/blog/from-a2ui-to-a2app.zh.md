---
title: "从 A2UI 到 A2APP，重新思考人与 AI 的交互范式"
date: 2026-10-19
category: perspectives
excerpt: "A2UI 将结构化界面放入聊天回复，A2APP 以 PenguinHarness 的 Agent 工作台落地，为每个 Agent 配对逐轮调用它的专属应用。"
---

> 本文基于 PenguinHarness 0.2.16 撰写，之后的版本在部分细节上可能有所不同。

A2UI 把小型结构化交互从纯文本搬到了聊天回复里。Agent 只发送预定义组件块的字段。客户端在回复里画出流程图、步骤指引和选项提示，不再只输出文字。

![PenguinHarness 聊天回复界面，包含带「查看源码」按钮的发布流程 Mermaid 流程图、带提示与说明的三步准备步骤块，以及金丝雀流量比例选择题，选项为 5%「推荐」、25%、跳过金丝雀、「其他…」](/blog-assets/penguinharness-0-2-14-a2ui-blocks-zh.png)
_单条聊天回复内用预审核组件渲染结构化选项、步骤指引与流程图，不执行任意代码_

A2APP 是我们对这一模式的命名，它把这种交互迁移到专属软件上。**在 PenguinHarness 中，A2APP 的落地形态是 Agent 工作台**。这是 Agent 聊天旁面向具体任务的应用，逐轮调用对应的 Agent，用户也可以在「聊天」标签页里让同一个 Agent 修改它。

**TL;DR**
- A2UI 组件块将可信结构化控件渲染在聊天回复中。
- PenguinHarness 工作台为单个 Agent 配有可编辑标签页，逐轮调用 Agent 执行任务。
- vibe coding 中 AI 写完代码即结束工作，工作台让同一个 Agent 在应用建成后持续为其服务。

## A2UI 解决了什么，又留下了什么
A2UI 组件块是这条路径的起点，参考 Google 2025 年末公布的同名项目设计。客户端从可信组件目录渲染声明式 UI，兼顾数据安全与代码表达力[^1]。PenguinHarness 组件块沿用该思路，未实现 Google 协议；Agent 仅发送组件字段，不发送 HTML、脚本或样式。

用户选完选项，内容直接填入输入框，按「发送」才发出请求[^2]。仅主对话最新回复支持输入，更早的组件块渲染为只读。天气、指标类组件块展示模型提供的静态快照，客户端不会额外拉取数据。**这些组件在单条回复内覆盖选项、步骤、图表，边界限于单条回复**。

vibe coding 跨过这条边界，生成独立于聊天的应用。Karpathy 2025 年初提出该术语，指不读代码、全盘接受 AI 生成的修改，适合周末一次性小项目[^3]。他后续提到，该方式本地演示顺畅，上线真实应用却十分繁琐。

下图对比 A2UI 组件块、vibe coding 应用、A2APP 工作台的差异。

<figure class="post-figure" data-figure="a2app-three-ways"> <svg class="fig-svg" viewBox="0 0 560 288" role="img" aria-labelledby="from-a2ui-to-a2app-a2app-three-ways-zh-title"> <title id="from-a2ui-to-a2app-a2app-three-ways-zh-title">从四个核心属性对比 A2UI 组件块、vibe coding 应用、A2APP 工作台的三列表格。</title> <text x="88" y="18" class="fig-title" text-anchor="middle">A2UI 组件块</text> <text x="280" y="18" class="fig-title" text-anchor="middle">vibe coding 应用</text> <text x="472" y="18" class="fig-title" text-anchor="middle">A2APP 工作台</text> <text x="1" y="50" class="fig-label" text-anchor="start">UI 来源</text> <rect x="1" y="58" width="174" height="30" rx="4" class="fig-box"/> <text x="88" y="77.5" text-anchor="middle">可信目录</text> <rect x="193" y="58" width="174" height="30" rx="4" class="fig-box"/> <text x="280" y="77.5" text-anchor="middle">生成代码</text> <rect x="385" y="58" width="174" height="30" rx="4" class="fig-box"/> <text x="472" y="77.5" text-anchor="middle">生成代码</text> <text x="1" y="116" class="fig-label" text-anchor="start">UI 出现位置</text> <rect x="1" y="124" width="174" height="30" rx="4" class="fig-box"/> <text x="88" y="143.5" text-anchor="middle">聊天回复</text> <rect x="193" y="124" width="174" height="30" rx="4" class="fig-box"/> <text x="280" y="143.5" text-anchor="middle">独立部署</text> <rect x="385" y="124" width="174" height="30" rx="4" class="fig-box"/> <text x="472" y="143.5" text-anchor="middle">「聊天」标签旁 / 占满应用</text> <text x="1" y="182" class="fig-label" text-anchor="start">创建后 AI 的角色</text> <rect x="1" y="190" width="174" height="30" rx="4" class="fig-box"/> <text x="88" y="209.5" text-anchor="middle">等待下一轮</text> <rect x="193" y="190" width="174" height="30" rx="4" class="fig-box"/> <text x="280" y="209.5" text-anchor="middle">不在运行中的应用里</text> <rect x="385" y="190" width="174" height="30" rx="4" class="fig-box"/> <text x="472" y="209.5" text-anchor="middle">逐轮运行任务</text> <text x="1" y="248" class="fig-label" text-anchor="start">用户入口</text> <rect x="1" y="256" width="174" height="30" rx="4" class="fig-box"/> <text x="88" y="275.5" text-anchor="middle">选选项 / 填表单</text> <rect x="193" y="256" width="174" height="30" rx="4" class="fig-box"/> <text x="280" y="275.5" text-anchor="middle">打开 URL</text> <rect x="385" y="256" width="174" height="30" rx="4" class="fig-box"/> <text x="472" y="275.5" text-anchor="middle">打开标签页</text> </svg> <ol class="fig-steps"> <li>A2UI 组件块</li> <li>vibe coding 应用</li> <li>A2APP 工作台</li> <li>UI 来源</li> <li>可信目录</li> <li>生成代码</li> <li>生成代码</li> <li>UI 出现位置</li> <li>聊天回复</li> <li>独立部署</li> <li>「聊天」标签旁 / 占满应用</li> <li>创建后 AI 的角色</li> <li>等待下一轮</li> <li>不在运行中的应用里</li> <li>逐轮运行任务</li> <li>用户入口</li> <li>选选项 / 填表单</li> <li>打开 URL</li> <li>打开标签页</li> </ol> <figcaption>A2APP 结合了完整代码的表达能力和与 Agent 之间窄范围的纯文本连接，改变了界面构建完成后 AI 所处的位置。</figcaption> </figure>

## 作为 A2APP 落地形态的工作台
**PenguinHarness 工作台是绑定单个 Agent 的小型应用**，存储在对应 Agent 的文件夹下。它作为「聊天」旁的标签页打开，不需要单独部署。法务 Agent 的「合同工作台」是典型例子，界面包含上传区域和用于审核的文件表格，完全为合同审核这一个任务设计[^4]。

![「合同工作台」在「聊天」旁的标签页打开，界面展示合同审核场景的上传提示与文件状态表格](/blog-assets/workflow-page-zh.png)
_工作台在对应 Agent 的聊天侧边以专属标签页呈现，界面为单一具体任务定制_

这是工作台当前的几个明确限制：服务端代码运行在服务端进程内，持有服务端的全部权限；代码本身和同源页面都没有沙箱隔离[^5]。工作台启动的 Session 运行在 `allow-all` 审批模式下，所有步骤都不会暂停等待用户确认。

工作台服务端通过一套边界清晰、范围固定的 host API 调用对应的 Agent[^6]。Agent 看不到页面内容，也看不到用户的点击操作，只会逐轮收到服务端发送的文本。服务端轮询 Agent 结果快照，更新页面状态。

这一机制形成两个并行循环：页面经服务端触发的任务循环，以及「聊天」里发起的编辑循环。

<figure class="post-figure" data-figure="a2app-two-loops"> <svg class="fig-svg" viewBox="0 0 560 456" role="img" aria-labelledby="from-a2ui-to-a2app-a2app-two-loops-zh-title"> <title id="from-a2ui-to-a2app-a2app-two-loops-zh-title">双流程示意图，分别展示工作台执行后台任务的任务循环，以及用于修改应用的聊天编辑循环</title> <defs><marker id="from-a2ui-to-a2app-a2app-two-loops-zh-use" viewBox="0 0 10 10" refX="10" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto"><path d="M0 0L10 5L0 10Z" class="fig-s1"/></marker><marker id="from-a2ui-to-a2app-a2app-two-loops-zh-build" viewBox="0 0 10 10" refX="10" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto"><path d="M0 0L10 5L0 10Z" class="fig-s3"/></marker></defs> <rect x="16" y="20" width="180" height="36" rx="6" class="fig-terminal"/> <text x="106" y="42" class="fig-label" text-anchor="middle">人</text> <rect x="400" y="20" width="132" height="36" rx="6" class="fig-box"/> <text x="466" y="42" class="fig-label" text-anchor="middle">「聊天」标签页</text> <path d="M196 31L400 31" class="fig-s3" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-build)"/> <text x="298" y="26" text-anchor="middle">编辑请求</text> <path d="M400 45L196 45" class="fig-s3" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-build)"/> <text x="298" y="59" text-anchor="middle">确认信息</text> <path d="M28 56L28 136" class="fig-s2" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-use)"/> <text x="34" y="100" text-anchor="start">点击/上传</text> <path d="M124 136L124 56" class="fig-s2" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-use)"/> <text x="130" y="100" text-anchor="start">展示输出</text> <path d="M412 56L412 136" class="fig-s3" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-build)"/> <text x="406" y="92" text-anchor="end">用户消息</text> <path d="M520 136L520 56" class="fig-s3" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-build)"/> <text x="514" y="108" text-anchor="end">状态回复</text> <rect x="16" y="136" width="180" height="36" rx="6" class="fig-box"/> <text x="106" y="158" class="fig-label" text-anchor="middle">工作台 UI</text> <rect x="400" y="136" width="132" height="36" rx="6" class="fig-terminal"/> <text x="466" y="158" class="fig-label" text-anchor="middle">Agent</text> <path d="M28 172L28 262" class="fig-s2" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-use)"/> <text x="34" y="217" text-anchor="start">API 调用</text> <path d="M92 262L92 172" class="fig-s2" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-use)"/> <text x="98" y="217" text-anchor="start">状态更新</text> <path d="M184 262L184 172" class="fig-s3" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-build)"/> <text x="190" y="207" text-anchor="start">成功后刷新</text> <path d="M466 262L466 172" class="fig-s2" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-use)"/> <text x="460" y="227" text-anchor="end">仅传文本，不含 UI 点击</text> <rect x="16" y="262" width="180" height="80" rx="6" class="fig-box"/> <text x="106" y="306" class="fig-label" text-anchor="middle">工作台服务端</text> <rect x="400" y="262" width="132" height="80" rx="6" class="fig-box"/> <text x="466" y="306" class="fig-label" text-anchor="middle">Host API</text> <path d="M196 284L400 284" class="fig-s2" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-use)"/> <text x="298" y="279" text-anchor="middle">createSession/run</text> <path d="M196 308L400 308" class="fig-s2" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-use)"/> <text x="298" y="303" text-anchor="middle">轮询 sessionResult 快照</text> <path d="M400 332L196 332" class="fig-s2" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-use)"/> <text x="298" y="327" text-anchor="middle">sessionResult 快照</text> <path d="M532 154L548 154" class="fig-s3"/> <path d="M548 154L548 430" class="fig-s3"/> <path d="M548 430L532 430" class="fig-s3" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-build)"/> <text x="542" y="392" text-anchor="end">修改代码</text> <path d="M420 412L420 372" class="fig-s3"/> <path d="M420 372L150 372" class="fig-s3"/> <path d="M150 372L150 342" class="fig-s3" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-build)"/> <text x="285" y="366" text-anchor="middle">类型检查 + 重新加载</text> <rect x="16" y="412" width="180" height="36" rx="6" class="fig-box"/> <text x="106" y="434" class="fig-label" text-anchor="middle">版本历史</text> <rect x="400" y="412" width="132" height="36" rx="6" class="fig-box"/> <text x="466" y="434" class="fig-label" text-anchor="middle">工作台文件</text> <path d="M400 430L196 430" class="fig-s3" marker-end="url(#from-a2ui-to-a2app-a2app-two-loops-zh-build)"/> <text x="298" y="425" text-anchor="middle">保存版本</text> </svg> <ol class="fig-steps"> <li>人</li> <li>工作台 UI</li> <li>工作台服务端</li> <li>Host API</li> <li>Agent</li> <li>点击/上传</li> <li>API 调用</li> <li>createSession/run</li> <li>仅传文本，不含 UI 点击</li> <li>轮询 sessionResult 快照</li> <li>sessionResult 快照</li> <li>状态更新</li> <li>展示输出</li> <li>「聊天」标签页</li> <li>工作台文件</li> <li>版本历史</li> <li>编辑请求</li> <li>用户消息</li> <li>修改代码</li> <li>类型检查 + 重新加载</li> <li>成功后刷新</li> <li>保存版本</li> <li>状态回复</li> <li>确认信息</li> </ol> <figcaption>两个循环并行运行。工作台通过纯文本的服务端调用触发 Agent 后台任务，「聊天」标签页里的请求会让 Agent 修改工作台文件。任务运行过程中，Agent 只接收来自工作台服务端的文本，不会收到直接的 UI 输入</figcaption> </figure>

## 在同一个地方使用和修改应用
运行任务循环的同一个 Agent，会在编辑循环中收到请求时编辑应用的文件。如果「合同工作台」缺少风险等级列，用户可以在工作台旁的「聊天」标签页提出修改需求。Agent 会直接编辑工作台的对应文件。

服务端会对 TypeScript 后端代码做类型检查，修改通过后打开的标签页会自动重新加载[^7]。工作台前端是纯 HTML、CSS 和 JavaScript，没有额外构建步骤，也不需要安装依赖。

系统会保存所有加载成功的工作台版本，最多留 20 个最近的修订版本，列在「历史」面板中。如果某次修改不符合预期，用户可以在旧版本上选择「恢复」，回滚代码但不会影响已经保存的业务数据[^8]。

![打开的工作台「历史」面板列出两条已保存版本，下方是更新后的「合同工作台」，表格已新增风险列](/blog-assets/workflow-history-zh.png)
_在「聊天」中提出的修改会直接更新工作台文件，最近加载成功的版本保存在「历史」面板；点击「恢复」只会回滚代码，不会改动已保存的数据_

vibe coding 中 AI 写完代码就结束了它的工作；**有了工作台，同一个 Agent 会持续为应用服务，也能按要求修改应用**。

## 一个具体的上手起点
沿着同一个 Agent 既服务应用、也能按需修改应用的方向，其他团队也拿出了相近的探索。MCP Apps 通过工具渲染带沙箱的交互式 UI，Claude artifacts 运行可回调 Claude 的小型应用。Opal 支持用户用自然语言构建 AI 迷你应用，Patchwork 可以从对话生成可修改的工具[^9]。我们的实现把应用绑定到负责修改它的 Agent，经这套边界清晰的 host API 逐轮调用它。

在 PenguinHarness 0.2.16 中，起始页在「一句话生成 AI 应用」下列出三个一句话启动模板，分别是 RAG 文档专家、投资分析师、法务智能体。**每个模板都会创建一个带专属工作台的独立 Agent**。新建 Project 的默认 Agent 已经预装了构建所需的 Skill[^10]。

你可以新建一个 Project，选择法务智能体模板，打开生成的 Agent 发起「新建对话」，切到工作台标签页即可开始使用。

[^1]: [Introducing A2UI: An open project for agent-driven interfaces - Google Developers Blog](https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/)
[^2]: [changelog/0.2.15/2026-10-03-a2ui-blocks.md](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/changelog/0.2.15/2026-10-03-a2ui-blocks.md)
[^3]: [Andrej Karpathy (@karpathy) on X](https://x.com/karpathy/status/1886192184808149383)
[^4]: [PenguinHarness blog: Give every agent its own hot-reloaded workbench](https://penguin.ooo/blog/build-agent-apps-with-workflows)
[^5]: [packages/server/src/workbenches/service.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/server/src/workbenches/service.ts)
[^6]: [packages/server/src/mechanisms/workbenches.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/server/src/mechanisms/workbenches.ts)
[^7]: [packages/server/src/workbenches/compile.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/server/src/workbenches/compile.ts)
[^8]: [packages/server/src/workbenches/store.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/server/src/workbenches/store.ts)
[^9]: [MCP Apps - Bringing UI Capabilities To MCP Clients | Model Context Protocol Blog](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/)
[^10]: [plugins/agent-development/skills/penguin-plugin/SKILL.md](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/plugins/agent-development/skills/penguin-plugin/SKILL.md)
