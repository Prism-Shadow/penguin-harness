---
title: "如何在 vibe coding 时候立住规矩，写出来的代码不烧心"
date: 2026-10-19
category: perspectives
excerpt: "vibe coding 求快易埋维护隐患，把三层约定写进仓库作为 AI 持久记忆，能在保速度的同时让代码不烧心。"
---

vibe coding 提效快，但无约束的快写会埋隐患。GitClear 统计 2020-2024 年 2.11 亿行改动，重构占比下降，复制粘贴上升。[^1]DORA 2025 报告称，无管控时 AI 拉低交付稳定性。[^2]Veracode 发现大模型代码样本 45% 未过安全测试，Replit 有用户遭 AI 误删生产库。[^3][^4]

我们认为，要让代码不烧心，核心是把 AI 要守的约定分三层写进仓库，作为跨会话持久记忆，即人的规矩、接口抽象、可复用组件。

<figure class="post-figure" data-figure="vibe-rules-three-layers"> <svg class="fig-svg" viewBox="0 0 560 282" role="img" aria-labelledby="rules-for-vibe-coding-vibe-rules-three-layers-zh-title"> <title id="rules-for-vibe-coding-vibe-rules-three-layers-zh-title">三层约束自上而下堆叠，侧边标注代码即记忆，说明三层的核心内容</title> <defs><marker id="rules-for-vibe-coding-vibe-rules-three-layers-zh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs> <rect x="52" y="34" width="277.8" height="62" rx="6" class="fig-box"/> <text x="70" y="60" class="fig-title">人的规矩</text> <text x="70" y="81">原则条款、提案、代码、测试</text> <rect x="52" y="110" width="277.8" height="62" rx="6" class="fig-box"/> <text x="70" y="136" class="fig-title">接口抽象</text> <text x="70" y="157">目录布局、类型、依赖契约</text> <rect x="52" y="186" width="277.8" height="62" rx="6" class="fig-box"/> <text x="70" y="212" class="fig-title">可复用组件</text> <text x="70" y="233">共享包、Skill、插件</text> <path d="M26 36V246" class="fig-edge" marker-start="url(#rules-for-vibe-coding-vibe-rules-three-layers-zh-arrow)" marker-end="url(#rules-for-vibe-coding-vibe-rules-three-layers-zh-arrow)"/> <text x="16" y="22" class="fig-note">越往上越硬</text> <text x="16" y="270" class="fig-note">越往下越常变</text> <path d="M337.8 34H343.8V248H337.8M343.8 141H351.8" class="fig-bracket"/> <text x="359.8" y="145.5" class="fig-label">代码即记忆（code as memory）</text> </svg> <ol class="fig-steps"> <li>人的规矩</li> <li>原则条款、提案、代码、测试</li> <li>接口抽象</li> <li>目录布局、类型、依赖契约</li> <li>可复用组件</li> <li>共享包、Skill、插件</li> <li>代码即记忆（code as memory）</li> <li>越往上越硬</li> <li>越往下越常变</li> </ol> <figcaption>我们把管 AI 的约束分三层写进仓库，硬约束靠代码和测试守住，抽象边界定在中间，组件层允许持续迭代</figcaption> </figure>

## 第一层的硬规矩要钉到代码和测试
第一层是人和团队定的硬底线，我们要求 AI 必须始终遵守。

提案沿用 Rust RFC 模板的九个节名，一篇记一个决定；条款、定义、提案逐条编号，落地后设计文档留一句原文指针。[^5][^6]

Claude Code 每次会话开始读取 CLAUDE.md，这类文件只作上下文加载，长文件消耗上下文、降低遵从度。拦截违规动作靠代码路径和 PreToolUse 钩子。[^7]

PenguinHarness 的 Trace append-only 规矩就是例子。公开文档定为只追加 JSON Lines 文件，写入器用 O_APPEND 单次 write 落盘，测试校验轮转停写、大记录单写。[^8][^9][^10]

硬规矩从确立到生效的链路如下。

<figure class="post-figure" data-figure="vibe-rules-rule-path"> <svg class="fig-svg" viewBox="0 0 560 242" role="img" aria-labelledby="rules-for-vibe-coding-vibe-rules-rule-path-zh-title"> <title id="rules-for-vibe-coding-vibe-rules-rule-path-zh-title">硬规矩从确立到生效的四个线性环节，旁路标注会话提示为软约束路径</title> <defs><marker id="rules-for-vibe-coding-vibe-rules-rule-path-zh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs> <g transform="translate(16 0)"> <rect x="92" y="10" width="168" height="36" rx="6" class="fig-box"/> <text x="176" y="32.5" class="fig-label" text-anchor="middle">编号原则/单决定提案</text> <path d="M176 46V71" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-rule-path-zh-arrow)"/> <rect x="92" y="72" width="168" height="36" rx="6" class="fig-box"/> <text x="176" y="94.5" class="fig-label" text-anchor="middle">公开文档</text> <path d="M176 108V133" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-rule-path-zh-arrow)"/> <rect x="92" y="134" width="168" height="36" rx="6" class="fig-box"/> <text x="176" y="156.5" class="fig-label" text-anchor="middle">代码实现</text> <path d="M176 170V195" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-rule-path-zh-arrow)"/> <rect x="92" y="196" width="168" height="36" rx="6" class="fig-box"/> <text x="176" y="218.5" class="fig-label" text-anchor="middle">测试断言</text> <path d="M260 28H367.95V71" class="fig-link" marker-end="url(#rules-for-vibe-coding-vibe-rules-rule-path-zh-arrow)"/> <rect x="300" y="72" width="135.9" height="36" rx="6" class="fig-link"/> <text x="368" y="94.5" class="fig-label" text-anchor="middle">会话提示（软约束）</text> </g> </svg> <ol class="fig-steps"> <li>编号原则/单决定提案</li> <li>公开文档</li> <li>代码实现</li> <li>测试断言</li> <li>会话提示（软约束）</li> </ol> <figcaption>硬规矩不能只停留在提示词里，代码在运行时拦住违规动作，测试在 CI 里抓回归，会话提示只做软提醒</figcaption> </figure>

硬规矩只守底线，模块协作边界靠下一层接口约定划清。

## 第二层的接口按最小必要划清边界
我们给核心接口划边界时只保留最小必要能力。决定 Agent 行为的可编辑文件集中放在 Agent State 目录，改动在下次上下文压缩后生效。[^9][^11][^12]模型选择、用户密钥、命令策略、审批模式刻意放在边界外，Agent 通过自身设置碰不到，也不能放宽自己的审批规则。[^13][^14][^15]

Agent State 与周边目录、外部配置的布局如下。

<figure class="post-figure" data-figure="vibe-rules-agent-state"> <svg class="fig-svg" viewBox="0 0 560 290" role="img" aria-labelledby="rules-for-vibe-coding-vibe-rules-agent-state-zh-title"> <title id="rules-for-vibe-coding-vibe-rules-agent-state-zh-title">项目目录树，区分 Agent 可编辑的状态目录、其他项目目录，树外标注服务端保存的配置</title> <defs><marker id="rules-for-vibe-coding-vibe-rules-agent-state-zh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs> <rect x="68" y="119" width="299" height="22" rx="4" class="fig-s2"/> <path d="M24 28V102M24 46H38M24 74H38M24 102H38" class="fig-axis"/> <path d="M54 112V270M54 130H68M54 158H68M54 186H68M54 214H68M54 242H68M54 270H68" class="fig-axis"/> <text x="16" y="22" class="fig-code">&lt;root&gt;/&lt;project&gt;/</text> <text x="46" y="50" class="fig-code">.project_config.toml（模型表/凭据/命令策略）</text> <text x="46" y="78" class="fig-code">benchmarks/</text> <text x="46" y="106" class="fig-code">agents/&lt;agent&gt;/</text> <text x="76" y="134" class="fig-code">agent_state/（配置/提示词/Skill/钩子/记忆）</text> <text x="76" y="162" class="fig-code">traces/</text> <text x="76" y="190" class="fig-code">scratchpad/</text> <text x="76" y="218" class="fig-code">shared_env/</text> <text x="76" y="246" class="fig-code">workspaces/</text> <text x="76" y="274" class="fig-code">snapshots/</text> <rect x="341.3" y="186" width="206.7" height="40" rx="6" class="fig-box"/> <text x="444.7" y="210.5" class="fig-label" text-anchor="middle">服务端保存：审批模式、API 开关</text> </svg> <ol class="fig-steps"> <li>&lt;root&gt;/&lt;project&gt;/</li> <li>benchmarks/</li> <li>.project_config.toml（模型表/凭据/命令策略）</li> <li>agents/&lt;agent&gt;/</li> <li>agent_state/（配置/提示词/Skill/钩子/记忆）</li> <li>traces/</li> <li>scratchpad/</li> <li>shared_env/</li> <li>workspaces/</li> <li>snapshots/</li> <li>服务端保存：审批模式、API 开关</li> </ol> <figcaption>目录布局统一定义在 paths.ts 里，Agent State 只放能改变 Agent 行为的可编辑文件，其余内容各归其位</figcaption> </figure>

目录边界定好后，运行时协作靠核心接口约定。context_engine 居中，只通过 OmniMessage 与 Human、LLM、Environment 三个边界交互，不靠标记文本判断消息来源。[^14][^16][^17]每次工具调用对应一条审批决定，决定权在 Human 接口，由用户或用户选定的审批模式作答，服务端新会话默认全部放行。[^14][^18][^19]SDK 不注入审批回调时一律拒绝，钩子放行压不过 Project 级命令策略的否决，所有审批与执行结果都写入 Trace 留痕。[^12][^16][^18]

各边界的交互与留痕路径如下。

<figure class="post-figure" data-figure="vibe-rules-interfaces"> <svg class="fig-svg" viewBox="0 0 560 272" role="img" aria-labelledby="rules-for-vibe-coding-vibe-rules-interfaces-zh-title"> <title id="rules-for-vibe-coding-vibe-rules-interfaces-zh-title">context_engine 居中，仅通过 OmniMessage 与三个边界交互，所有审批决定与执行结果写入 Trace</title> <defs><marker id="rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs> <rect x="16" y="10" width="204.5" height="36" rx="6" class="fig-box"/> <text x="118.3" y="32.5" class="fig-label" text-anchor="middle">Human（审批回调）</text> <rect x="339.5" y="10" width="204.5" height="36" rx="6" class="fig-box"/> <text x="441.8" y="32.5" class="fig-label" text-anchor="middle">LLM（模型响应）</text> <rect x="132" y="90" width="296" height="92" rx="10" class="fig-bracket"/> <text x="280" y="112" class="fig-code fig-label" text-anchor="middle">OmniMessage</text> <rect x="207.7" y="126" width="144.7" height="40" rx="6" class="fig-box"/> <text x="280" y="150.5" class="fig-code fig-label" text-anchor="middle">context_engine</text> <rect x="16" y="226" width="204.5" height="36" rx="6" class="fig-box"/> <text x="118.3" y="248.5" class="fig-label" text-anchor="middle">Environment（工具执行结果）</text> <rect x="339.5" y="226" width="204.5" height="36" rx="6" class="fig-terminal"/> <text x="441.8" y="248.5" class="fig-label" text-anchor="middle">Trace（全量审计记录）</text> <path d="M172.5 47V89" class="fig-edge" marker-start="url(#rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow)" marker-end="url(#rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow)"/> <path d="M387.5 47V89" class="fig-edge" marker-start="url(#rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow)" marker-end="url(#rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow)"/> <path d="M172.5 183V225" class="fig-edge" marker-start="url(#rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow)" marker-end="url(#rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow)"/> <path d="M387.5 182V225" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow)"/> </svg> <ol class="fig-steps"> <li>context_engine</li> <li>OmniMessage</li> <li>Human（审批回调）</li> <li>LLM（模型响应）</li> <li>Environment（工具执行结果）</li> <li>Trace（全量审计记录）</li> </ol> <figcaption>引擎只在 OmniMessage 上做处理，三个边界各管一摊，所有决定都留审计记录</figcaption> </figure>

接口边界固定后，日常迭代的效率靠最下层的可复用组件支撑。

## 第三层的可复用组件让 AI 沿着抽象改进
这层约束最弱、变更最频繁。我们判断，把复用规则写进仓库，AI 沿已有抽象改进，不会碰到新需求就从头写一套，避免仓库膨胀。写提案时先核对两件事，需求能不能靠现有配置或扩展点完成，仓库里有没有可以照搬的先例。

新需求进来后的复用决策路径如下。

<figure class="post-figure" data-figure="vibe-rules-reuse"> <svg class="fig-svg" viewBox="0 0 560 348" role="img" aria-labelledby="rules-for-vibe-coding-vibe-rules-reuse-zh-title"> <title id="rules-for-vibe-coding-vibe-rules-reuse-zh-title">新需求进入后的复用决策分支流程，标注抽象的停留边界</title> <defs><marker id="rules-for-vibe-coding-vibe-rules-reuse-zh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs> <rect x="162.1" y="10" width="80" height="36" rx="6" class="fig-terminal"/> <text x="202.1" y="32.5" class="fig-label" text-anchor="middle">新需求</text> <path d="M202.05 46V69" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-reuse-zh-arrow)"/> <rect x="143.8" y="70" width="116.6" height="36" rx="6" class="fig-box"/> <text x="202.1" y="92.5" class="fig-label" text-anchor="middle">查已有组件/机制</text> <rect x="328" y="124" width="76" height="36" rx="6" class="fig-terminal"/> <text x="366" y="146.5" class="fig-label" text-anchor="middle">直接复用</text> <path d="M202.05 142H327" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-reuse-zh-arrow)"/> <rect x="328" y="174" width="100" height="36" rx="6" class="fig-terminal"/> <text x="378" y="196.5" class="fig-label" text-anchor="middle">扩展现有实现</text> <path d="M202.05 192H327" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-reuse-zh-arrow)"/> <path d="M202.05 106V231" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-reuse-zh-arrow)"/> <polygon points="108.1,254 122.1,232 282,232 296,254 282,276 122.1,276" class="fig-box"/> <text x="202.1" y="258.5" class="fig-label" text-anchor="middle">是否为跨场景通用行为？</text> <rect x="328" y="302" width="123.9" height="36" rx="6" class="fig-terminal"/> <text x="390" y="324.5" class="fig-label" text-anchor="middle">抽新组件入共享层</text> <path d="M296 254H389.95V301" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-reuse-zh-arrow)"/> <rect x="140.1" y="302" width="123.9" height="36" rx="6" class="fig-terminal"/> <text x="202.1" y="324.5" class="fig-label" text-anchor="middle">留在单业务逻辑内</text> <path d="M202.05 276V301" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-reuse-zh-arrow)"/> </svg> <ol class="fig-steps"> <li>新需求</li> <li>查已有组件/机制</li> <li>直接复用</li> <li>扩展现有实现</li> <li>是否为跨场景通用行为？</li> <li>抽新组件入共享层</li> <li>留在单业务逻辑内</li> </ol> <figcaption>复用优先，抽象只落在真正跨场景通用的行为上，既不重复造轮子，也不过度抽象</figcaption> </figure>

做前端先查共享 UI 包，能直接复用就不新写；缺能力就扩展共享组件、同步改调用方，不复制控件、不改包内默认样式；只出现一次的业务规则留在对应功能内，不提前抽成通用组件。[^20]

复用不止前端。每个包的测试替身集中放在一处，写新测试先复用已有替身。[^21]热更新不打断运行中的 Task，复用终端移交的注册、资源校验、挂起上下文机制，只新增一个纯数据组件和移交指针。[^22][^23]

可选的 continual-learning 插件会提示子会话，把值得记录的发现写进对应 SKILL.md，或什么都不改。[^12][^24]三层约定就位后，落地可以分步推进。

## 从一条规矩开始
不用一开始就写完整本规范。Mitchell Hashimoto 的做法是，每发现 Agent 犯一次错，就补机制让它不再犯。[^25]我们把对应的约定按三层归位。

碰到底线问题，补代码路径和测试钉成硬规矩。比如占位符漂移漏检，就加测试做比对。[^26]遇到越权问题，收窄接口移走不该给的能力。碰到重复造轮子，抽成公共组件，把复用规则写进对应 Skill，推理留在 PR 描述。[^27][^28]

下次 AI 再犯同类错，你不用重写长提示词，先补一条会失败的测试把边界钉住。

[^1]: [AI Copilot Code Quality: 2025 Data Suggests 4x Growth in Code Clones - GitClear](https://www.gitclear.com/ai_assistant_code_quality_2025_research)
[^2]: [Announcing the 2025 DORA Report | Google Cloud Blog](https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report)
[^3]: [Insights from 2025 GenAI Code Security Report](https://www.veracode.com/blog/genai-code-security-report/)
[^4]: [Vibe coding service Replit deleted production database](https://www.theregister.com/2025/07/21/replit_saastr_vibe_coding_incident/)
[^5]: [rust-lang/rfcs: 0000-template.md](https://raw.githubusercontent.com/rust-lang/rfcs/master/0000-template.md)
[^6]: [rust-lang/rfcs: text/0002-rfc-process.md](https://raw.githubusercontent.com/rust-lang/rfcs/master/text/0002-rfc-process.md)
[^7]: [How Claude remembers your project - Claude Code Docs](https://code.claude.com/docs/en/memory)
[^8]: [PenguinHarness docs: Sessions &amp; Traces](https://penguin.ooo/docs/sessions-and-traces)
[^9]: [PenguinHarness docs: Introduction](https://penguin.ooo/docs/introduction)
[^10]: [packages/core/src/trace/writer.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/core/src/trace/writer.ts)
[^11]: [PenguinHarness docs: Key concepts](https://penguin.ooo/docs/concepts)
[^12]: [PenguinHarness docs: The Agent Loop](https://penguin.ooo/docs/agent-loop)
[^13]: [PenguinHarness docs: Models &amp; Providers](https://penguin.ooo/docs/models)
[^14]: [PenguinHarness docs: Architecture](https://penguin.ooo/docs/architecture)
[^15]: [PenguinHarness docs: Agent API](https://penguin.ooo/docs/agent-api)
[^16]: [PenguinHarness docs: Core Interfaces](https://penguin.ooo/docs/interfaces)
[^17]: [packages/core/src/omnimessage/markers/index.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/core/src/omnimessage/markers/index.ts)
[^18]: [PenguinHarness docs: Tools &amp; Approval](https://penguin.ooo/docs/tools)
[^19]: [PenguinHarness docs: Chat](https://penguin.ooo/docs/chat)
[^20]: [.agents/skills/penguin-harness-frontend/SKILL.md](https://github.com/Prism-Shadow/penguin-harness/blob/77be09ec5b0997df6f55458fe9b04c55aff96722/.agents/skills/penguin-harness-frontend/SKILL.md)
[^21]: [.agents/skills/penguin-harness-dev/reference/testing.md](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/.agents/skills/penguin-harness-dev/reference/testing.md)
[^22]: [PR #1060: feat(server): hand live agent state to a compatible successor](https://github.com/Prism-Shadow/penguin-harness/pull/1060)
[^23]: [PR #1059: refactor(server): move session memory into an AgentState component](https://github.com/Prism-Shadow/penguin-harness/pull/1059)
[^24]: [PenguinHarness docs: Skills &amp; Plugins](https://penguin.ooo/docs/skills)
[^25]: [My AI Adoption Journey – Mitchell Hashimoto](https://mitchellh.com/writing/my-ai-adoption-journey)
[^26]: [packages/web/test/placeholders-parity.test.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/web/test/placeholders-parity.test.ts)
[^27]: [.agents/skills/penguin-harness-dev/SKILL.md](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/.agents/skills/penguin-harness-dev/SKILL.md)
[^28]: [.agents/skills/penguin-harness-dev/reference/changelog.md](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/.agents/skills/penguin-harness-dev/reference/changelog.md)
