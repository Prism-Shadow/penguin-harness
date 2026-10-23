---
title: "如何在 vibe coding 时候立住规矩，写出来的代码不烧心"
date: 2026-10-19
category: perspectives
excerpt: "vibe coding 时别靠反复调整提示词约束 Agent，把硬规矩放进仓库，用代码和测试钉住，跨会话才不会失效。"
---

> 本文基于 PenguinHarness 0.2.16 撰写，之后的版本在部分细节上可能有所不同。

2025 年 DORA 报告显示，AI 普及程度和软件交付稳定性目前呈负相关。缺少自动化测试、成熟版本控制、快速反馈回路的团队，AI 带来的变更量越大，系统越容易失稳[^1]。

vibe coding 时要给 Agent 立的规矩，应当存放在仓库内，供每个 Session 启动时读取。这就是代码即记忆 (code as memory)。**规矩按三层结构组织，硬约束由代码和测试承载，提示词只承担上下文传递的作用**。

**TL;DR**
- 聊天中的约定不跨会话保留，规则文件仅作上下文，无法拦截违规操作
- 仓库内的规矩分三层，层级越高约束越强、改动越少
- 下次 Agent 重复犯错，在对应层加规则配测试，不用拉长提示词

## 代码即记忆
拉长提示词留不住规矩，跨会话约束 Agent 的有效载体是仓库本身。每个新的 Agent 会话从空白上下文窗口启动。聊天里说过的规矩不会带到下一次。项目规则文件每次会话启动时自动加载，作用是提供上下文。规则文件本身不具备拦截违规动作的能力，拦截要靠代码钩子[^2]。

Replit 有用户公开记录，自己明确要求 AI 不要未经许可改代码，AI 仍删除了生产数据库。当事人提到这类 vibe coding 工具里无法靠聊天约定强制代码冻结[^3]。

常见的应对思路是写更长、更严格的提示词或规则文件。文件越长占用的上下文越多，遵守率反而越低。**必须拦住的动作要靠代码实现**。

我们把仓库里的规矩分成三层。

<figure class="post-figure" data-figure="vibe-rules-three-layers"> <svg class="fig-svg" viewBox="0 0 560 340" role="img" aria-labelledby="rules-for-vibe-coding-vibe-rules-three-layers-zh-title"> <title id="rules-for-vibe-coding-vibe-rules-three-layers-zh-title">代码即记忆框架下的三层规矩堆叠结构，侧边标注约束强度和改动频率的变化方向</title> <defs><marker id="rules-for-vibe-coding-vibe-rules-three-layers-zh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs> <rect x="52" y="30" width="500" height="280" rx="8" class="fig-bracket"/> <text x="66" y="50" class="fig-label">代码即记忆 (code as memory)</text> <rect x="66" y="60" width="472" height="72" rx="6" class="fig-box"/> <text x="82" y="83" class="fig-title">人的规矩</text> <text x="82" y="103">AI 始终遵循，参考 RFC 按条书写</text> <circle cx="85" cy="118.5" r="2.25" class="fig-marker"/> <text x="95" y="122.5" class="fig-label">Trace 只追加 (append-only)</text> <rect x="66" y="142" width="472" height="72" rx="6" class="fig-box"/> <text x="82" y="165" class="fig-title">接口抽象</text> <text x="82" y="185">核心接口保持最小必要</text> <circle cx="85" cy="200.5" r="2.25" class="fig-marker"/> <text x="95" y="204.5" class="fig-label">Agent State 目录边界、审批依赖 Human 接口</text> <rect x="66" y="224" width="472" height="72" rx="6" class="fig-box"/> <text x="82" y="247" class="fig-title">可复用组件</text> <text x="82" y="267">持续改进现有抽象，能复用则复用</text> <circle cx="85" cy="282.5" r="2.25" class="fig-marker"/> <text x="95" y="286.5" class="fig-label">热更新交接复用终端交接逻辑</text> <path d="M26 32V308" class="fig-edge" marker-start="url(#rules-for-vibe-coding-vibe-rules-three-layers-zh-arrow)" marker-end="url(#rules-for-vibe-coding-vibe-rules-three-layers-zh-arrow)"/> <text x="16" y="18" class="fig-note">约束越强 改动越少</text> <text x="16" y="332" class="fig-note">约束越弱 改动越频繁</text> </svg> <ol class="fig-steps"><li>代码即记忆 (code as memory)</li> <li>约束越强 改动越少</li> <li>约束越弱 改动越频繁</li> <li>人的规矩</li> <li>AI 始终遵循，参考 RFC 按条书写</li> <li>Trace 只追加 (append-only)</li> <li>接口抽象</li> <li>核心接口保持最小必要</li> <li>Agent State 目录边界、审批依赖 Human 接口</li> <li>可复用组件</li> <li>持续改进现有抽象，能复用则复用</li> <li>热更新交接复用终端交接逻辑</li></ol> <figcaption>不同强度的规矩要放在对应层级，硬约束不要只放在提示词上下文里</figcaption> </figure>

## 人的规矩要落地到代码
三层里最上层是 AI 必须遵守的少数规矩，每条都配套代码路径和测试。**规矩多了 Agent 记不住，只有少而硬、每条都有机制卡住的规则才会被稳定遵守**。

我们参考 RFC 单条决策单份文档的惯例记录这类规矩，每条对应一个编号项，落地后不轻易修改。

以 Trace 规则为例，Trace 是 append-only 的 JSON Lines 文件，历史记录只追加、不原地修改[^4]。写入逻辑每次打开文件都用 O_APPEND，单次 `write(2)` 提交完整记录。核心测试会检查 Trace 轮转后的旧文件仍保持只追加，数 MB 的记录通过单次底层写入完成。

也有声音说，像 RFC 一样写规矩是官僚主义，会拖慢 vibe coding。只有绝对不能破的少数规矩放在这一层，每条短到可以配一个测试守住。规矩从单条提案出发，经文档、代码、测试落地，提示只做软提醒。

<figure class="post-figure" data-figure="vibe-rules-rule-path"> <svg class="fig-svg" viewBox="0 0 560 242" role="img" aria-labelledby="rules-for-vibe-coding-vibe-rules-rule-path-zh-title"> <title id="rules-for-vibe-coding-vibe-rules-rule-path-zh-title">硬规矩从确立到生效的四个线性环节，旁路标注会话提示为软约束路径</title> <defs><marker id="rules-for-vibe-coding-vibe-rules-rule-path-zh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs> <g transform="translate(16 0)"> <rect x="92" y="10" width="168" height="36" rx="6" class="fig-box"/> <text x="176" y="32.5" class="fig-label" text-anchor="middle">编号原则/单决定提案</text> <path d="M176 46V71" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-rule-path-zh-arrow)"/> <rect x="92" y="72" width="168" height="36" rx="6" class="fig-box"/> <text x="176" y="94.5" class="fig-label" text-anchor="middle">公开文档</text> <path d="M176 108V133" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-rule-path-zh-arrow)"/> <rect x="92" y="134" width="168" height="36" rx="6" class="fig-box"/> <text x="176" y="156.5" class="fig-label" text-anchor="middle">代码实现</text> <path d="M176 170V195" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-rule-path-zh-arrow)"/> <rect x="92" y="196" width="168" height="36" rx="6" class="fig-box"/> <text x="176" y="218.5" class="fig-label" text-anchor="middle">测试断言</text> <path d="M260 28H367.95V71" class="fig-link" marker-end="url(#rules-for-vibe-coding-vibe-rules-rule-path-zh-arrow)"/> <rect x="300" y="72" width="135.9" height="36" rx="6" class="fig-link"/> <text x="368" y="94.5" class="fig-label" text-anchor="middle">会话提示（软约束）</text> </g> </svg> <ol class="fig-steps"> <li>编号原则/单决定提案</li> <li>公开文档</li> <li>代码实现</li> <li>测试断言</li> <li>会话提示（软约束）</li> </ol> <figcaption>硬规矩不能只停留在提示词里，代码在运行时拦住违规动作，测试在 CI 里抓回归，会话提示只做软提醒</figcaption> </figure>

## 核心接口划清最小边界
这些规矩落到代码里，要先划清最小必要的接口边界，先定依赖再写逻辑。**接口越小，Agent 误改范围越小，依赖关系写死就不会绕开审批流程**。

Agent 可以修改 Agent State 内的配置、提示词和 Skill。命令策略、凭据、API 开关、审批模式放在 Agent State 目录外或服务端，Agent 编辑自身配置时碰不到这些内容[^5]。

<figure class="post-figure" data-figure="vibe-rules-agent-state"> <svg class="fig-svg" viewBox="0 0 560 290" role="img" aria-labelledby="rules-for-vibe-coding-vibe-rules-agent-state-zh-title"> <title id="rules-for-vibe-coding-vibe-rules-agent-state-zh-title">项目目录树，区分 Agent 可编辑的状态目录、其他项目目录，树外标注服务端保存的配置</title> <defs><marker id="rules-for-vibe-coding-vibe-rules-agent-state-zh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs> <rect x="68" y="119" width="299" height="22" rx="4" class="fig-s2"/> <path d="M24 28V102M24 46H38M24 74H38M24 102H38" class="fig-axis"/> <path d="M54 112V270M54 130H68M54 158H68M54 186H68M54 214H68M54 242H68M54 270H68" class="fig-axis"/> <text x="16" y="22" class="fig-code">&lt;root&gt;/&lt;project&gt;/</text> <text x="46" y="50" class="fig-code">.project_config.toml（模型表/凭据/命令策略）</text> <text x="46" y="78" class="fig-code">benchmarks/</text> <text x="46" y="106" class="fig-code">agents/&lt;agent&gt;/</text> <text x="76" y="134" class="fig-code">agent_state/（配置/提示词/Skill/钩子/记忆）</text> <text x="76" y="162" class="fig-code">traces/</text> <text x="76" y="190" class="fig-code">scratchpad/</text> <text x="76" y="218" class="fig-code">shared_env/</text> <text x="76" y="246" class="fig-code">workspaces/</text> <text x="76" y="274" class="fig-code">snapshots/</text> <rect x="341.3" y="186" width="206.7" height="40" rx="6" class="fig-box"/> <text x="444.7" y="210.5" class="fig-label" text-anchor="middle">服务端保存：审批模式、API 开关</text> </svg> <ol class="fig-steps"> <li>&lt;root&gt;/&lt;project&gt;/</li> <li>benchmarks/</li> <li>.project_config.toml（模型表/凭据/命令策略）</li> <li>agents/&lt;agent&gt;/</li> <li>agent_state/（配置/提示词/Skill/钩子/记忆）</li> <li>traces/</li> <li>scratchpad/</li> <li>shared_env/</li> <li>workspaces/</li> <li>snapshots/</li> <li>服务端保存：审批模式、API 开关</li> </ol> <figcaption>目录布局统一定义在 paths.ts 里，Agent State 只放能改变 Agent 行为的可编辑文件，其余内容各归其位</figcaption> </figure>

目录之外，核心引擎的边界同样保持最小。每一次完整的工具调用，都需要 Human 接口传入的 `approve` 回调给出审批决定。没有回调时，引擎默认拒绝所有工具调用[^6]。`Session.run` 会先用 Project 的命令策略包装审批回调，被策略否决的命令不会再送到宿主侧询问。

<figure class="post-figure" data-figure="vibe-rules-interfaces"> <svg class="fig-svg" viewBox="0 0 560 272" role="img" aria-labelledby="rules-for-vibe-coding-vibe-rules-interfaces-zh-title"> <title id="rules-for-vibe-coding-vibe-rules-interfaces-zh-title">context_engine 居中，仅通过 OmniMessage 与三个边界交互，所有审批决定与执行结果写入 Trace</title> <defs><marker id="rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs> <rect x="16" y="10" width="204.5" height="36" rx="6" class="fig-box"/> <text x="118.3" y="32.5" class="fig-label" text-anchor="middle">Human（审批回调）</text> <rect x="339.5" y="10" width="204.5" height="36" rx="6" class="fig-box"/> <text x="441.8" y="32.5" class="fig-label" text-anchor="middle">LLM（模型响应）</text> <rect x="132" y="90" width="296" height="92" rx="10" class="fig-bracket"/> <text x="280" y="112" class="fig-code fig-label" text-anchor="middle">OmniMessage</text> <rect x="207.7" y="126" width="144.7" height="40" rx="6" class="fig-box"/> <text x="280" y="150.5" class="fig-code fig-label" text-anchor="middle">context_engine</text> <rect x="16" y="226" width="204.5" height="36" rx="6" class="fig-box"/> <text x="118.3" y="248.5" class="fig-label" text-anchor="middle">Environment（工具执行结果）</text> <rect x="339.5" y="226" width="204.5" height="36" rx="6" class="fig-terminal"/> <text x="441.8" y="248.5" class="fig-label" text-anchor="middle">Trace（全量审计记录）</text> <path d="M172.5 47V89" class="fig-edge" marker-start="url(#rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow)" marker-end="url(#rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow)"/> <path d="M387.5 47V89" class="fig-edge" marker-start="url(#rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow)" marker-end="url(#rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow)"/> <path d="M172.5 183V225" class="fig-edge" marker-start="url(#rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow)" marker-end="url(#rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow)"/> <path d="M387.5 182V225" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow)"/> </svg> <ol class="fig-steps"> <li>context_engine</li> <li>OmniMessage</li> <li>Human（审批回调）</li> <li>LLM（模型响应）</li> <li>Environment（工具执行结果）</li> <li>Trace（全量审计记录）</li> </ol> <figcaption>引擎只在 OmniMessage 上做处理，三个边界各管一摊，所有决定都留审计记录</figcaption> </figure>

最小接口的设计常被质疑限制了 Agent 的能力。放在边界外的只是 Agent 不该自行授权的内容，边界内的日常迭代交给它自由调整。

## 优先复用现有抽象
日常迭代用到的可复用组件在最下层，**要求 Agent 优先改进现有抽象，能复用就不新写，避免无意义膨胀**。

GitClear 分析了 2020 到 2024 年间的 2.11 亿行变更代码[^7]。其中重构移动的代码占比从 2021 年的 25% 降到 2024 年的 10% 以下，复制粘贴的代码占比从 8.3% 升到 12.3%。

我们在前端用测试守住复用边界，`test/icon-scale.test.ts` 会在出现第二份 caret、关闭叉号或折叠箭头时直接失败。最近上线的热更新功能，会把运行中的 Tasks 交接给新构建的版本而不是直接中断，复用了终端交接已有的机制[^8]。

<figure class="post-figure" data-figure="vibe-rules-reuse"> <svg class="fig-svg" viewBox="0 0 560 348" role="img" aria-labelledby="rules-for-vibe-coding-vibe-rules-reuse-zh-title"> <title id="rules-for-vibe-coding-vibe-rules-reuse-zh-title">新需求进入后的复用决策分支流程，标注抽象的停留边界</title> <defs><marker id="rules-for-vibe-coding-vibe-rules-reuse-zh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs> <rect x="162.1" y="10" width="80" height="36" rx="6" class="fig-terminal"/> <text x="202.1" y="32.5" class="fig-label" text-anchor="middle">新需求</text> <path d="M202.05 46V69" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-reuse-zh-arrow)"/> <rect x="143.8" y="70" width="116.6" height="36" rx="6" class="fig-box"/> <text x="202.1" y="92.5" class="fig-label" text-anchor="middle">查已有组件/机制</text> <rect x="328" y="124" width="76" height="36" rx="6" class="fig-terminal"/> <text x="366" y="146.5" class="fig-label" text-anchor="middle">直接复用</text> <path d="M202.05 142H327" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-reuse-zh-arrow)"/> <rect x="328" y="174" width="100" height="36" rx="6" class="fig-terminal"/> <text x="378" y="196.5" class="fig-label" text-anchor="middle">扩展现有实现</text> <path d="M202.05 192H327" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-reuse-zh-arrow)"/> <path d="M202.05 106V231" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-reuse-zh-arrow)"/> <polygon points="108.1,254 122.1,232 282,232 296,254 282,276 122.1,276" class="fig-box"/> <text x="202.1" y="258.5" class="fig-label" text-anchor="middle">是否为跨场景通用行为？</text> <rect x="328" y="302" width="123.9" height="36" rx="6" class="fig-terminal"/> <text x="390" y="324.5" class="fig-label" text-anchor="middle">抽新组件入共享层</text> <path d="M296 254H389.95V301" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-reuse-zh-arrow)"/> <rect x="140.1" y="302" width="123.9" height="36" rx="6" class="fig-terminal"/> <text x="202.1" y="324.5" class="fig-label" text-anchor="middle">留在单业务逻辑内</text> <path d="M202.05 276V301" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-reuse-zh-arrow)"/> </svg> <ol class="fig-steps"> <li>新需求</li> <li>查已有组件/机制</li> <li>直接复用</li> <li>扩展现有实现</li> <li>是否为跨场景通用行为？</li> <li>抽新组件入共享层</li> <li>留在单业务逻辑内</li> </ol> <figcaption>复用优先，抽象只落在真正跨场景通用的行为上，既不重复造轮子，也不过度抽象</figcaption> </figure>

也有观点认为现在代码生成成本低，复制更快，过早做抽象反而麻烦。复制写起来便宜，每多一份副本，每条规矩就要多守一处，长期维护成本很高。我们只把跨场景通用的行为抽到共享组件层，一次性逻辑留在对应功能模块即可。

## 从一条规矩开始
三层边界划清后，落地不需要一次性写满所有规矩。Mitchell Hashimoto 在他关于 AI 落地的文章里提到，每次发现 Agent 犯了错，就花时间做一个机制，让 Agent 再也不会犯同样的错[^9]。

规矩放在仓库里、用测试钉住，一次修好，所有后续会话都不会再犯，不用每次聊天重复强调。

下次 Agent 重复犯同一个错，先判断这个规矩属于哪一层，**把它写进去，再配一个会失败的测试钉住，不用把提示词写得更长**。

[^1]: [Announcing the 2025 DORA Report | Google Cloud Blog](https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report)
[^2]: [How Claude remembers your project - Claude Code Docs](https://code.claude.com/docs/en/memory)
[^3]: [Vibe coding service Replit deleted production database](https://www.theregister.com/2025/07/21/replit_saastr_vibe_coding_incident/)
[^4]: [PenguinHarness docs: Sessions &amp; Traces](https://penguin.ooo/docs/sessions-and-traces)
[^5]: [PenguinHarness docs: Configuration Reference](https://penguin.ooo/docs/configuration)
[^6]: [PenguinHarness docs: Core Interfaces](https://penguin.ooo/docs/interfaces)
[^7]: [AI Copilot Code Quality: 2025 Data Suggests 4x Growth in Code Clones - GitClear](https://www.gitclear.com/ai_assistant_code_quality_2025_research)
[^8]: [PR #1060: feat(server): hand live agent state to a compatible successor](https://github.com/Prism-Shadow/penguin-harness/pull/1060)
[^9]: [My AI Adoption Journey – Mitchell Hashimoto](https://mitchellh.com/writing/my-ai-adoption-journey)
