---
title: "如何在 vibe coding 时候立住规矩，写出来的代码不烧心"
date: 2026-10-19
category: perspectives
excerpt: "vibe coding 时别靠拉长提示词约束 Agent，把硬规矩放进仓库按金字塔排布，用代码和测试钉住才跨会话有效。"
---

> 本文基于 PenguinHarness 0.2.16 撰写，之后的版本在部分细节上可能有所不同。

2025 年 DORA 报告显示，AI 普及与软件交付稳定性呈负相关。缺少自动化测试、成熟版本控制和快速反馈回路的团队，AI 带来的变更量越大，系统越容易失稳[^1]。

vibe coding 时要给 Agent 立的规矩，应当存放在仓库内供每个 Session 启动时读取，组成上窄下宽的金字塔。塔尖是少数类 RFC 的硬规则，中层是最小核心接口，塔基是大量可复用组件。**层级越高内容越少、越需要人投入注意力，层级越低内容越多、越不需要人逐行审读**。

**TL;DR**
- 聊天约定不跨会话保留，规则文件仅作上下文，无法拦截违规操作
- 仓库内的规矩排成上窄下宽的金字塔，人的注意力集中在塔尖的少数规则上
- 下次 Agent 重复犯错，在对应层加规则配测试，不用拉长提示词

## 代码即记忆
长提示词带不走跨会话规矩，仓库里的规矩跨会话生效，每个新 Agent 会话从空白上下文窗口启动，聊天里说过的规矩不会带到下一次。规则文件在会话启动时作为上下文加载，无法拦截动作，拦截要靠代码钩子[^2]。

Replit 有用户记录，自己明确要求 AI 不要未经许可改代码，AI 仍删除了生产数据库。当事人提到这类 vibe coding 工具里无法靠聊天约定强制代码冻结[^3]。

有人觉得写更长、更严格的提示词就能解决问题。更长的规则文件占用更多上下文，遵守率更低。

**我们把仓库里的规矩排成上窄下宽的金字塔，人的注意力集中在最上层**。

<figure class="post-figure" data-figure="vibe-rules-three-layers"> <svg class="fig-svg" viewBox="0 0 560 346" role="img" aria-labelledby="rules-for-vibe-coding-vibe-rules-three-layers-zh-title"> <title id="rules-for-vibe-coding-vibe-rules-three-layers-zh-title">上窄下宽的三层规矩金字塔，左侧标注人注意力向上递增，右侧标注内容量向下递增</title> <defs><marker id="rules-for-vibe-coding-vibe-rules-three-layers-zh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs> <text x="280" y="20" text-anchor="middle" class="fig-title">代码即记忆 (code as memory)</text> <path d="M185.0 44H375.0L421.2 128H138.8Z" class="fig-box"/> <text x="280" y="71" text-anchor="middle" class="fig-title">人的规矩</text> <text x="280" y="93" text-anchor="middle">25 条 人逐条审定</text> <text x="280" y="114" text-anchor="middle" class="fig-label">例：Trace 只追加</text> <path d="M134.4 136H425.6L471.8 220H88.2Z" class="fig-box"/> <text x="280" y="163" text-anchor="middle" class="fig-title">接口抽象</text> <text x="280" y="185" text-anchor="middle">3 个核心接口 人只看边界</text> <text x="280" y="206" text-anchor="middle" class="fig-label">例：Agent State 边界、审批走 Human 接口</text> <path d="M83.8 228H476.2L522.4 312H37.6Z" class="fig-box"/> <text x="280" y="255" text-anchor="middle" class="fig-title">可复用组件</text> <text x="280" y="277" text-anchor="middle">1489 个源文件 人不逐行读</text> <text x="280" y="298" text-anchor="middle" class="fig-label">例：热更新复用交接逻辑</text> <path d="M22 312V44" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-three-layers-zh-arrow)"/> <text x="10" y="34" class="fig-note">人注意力↑</text> <path d="M538 44V312" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-three-layers-zh-arrow)"/> <text x="550" y="334" text-anchor="end" class="fig-note">内容量↓</text> </svg> <ol class="fig-steps"><li>人注意力↑</li> <li>内容量↓</li> <li>人的规矩</li> <li>25 条 人逐条审定</li> <li>例：Trace 只追加</li> <li>接口抽象</li> <li>3 个核心接口 人只看边界</li> <li>例：Agent State 边界、审批走 Human 接口</li> <li>可复用组件</li> <li>1489 个源文件 人不逐行读</li> <li>例：热更新复用交接逻辑</li></ol> <figcaption>金字塔结构把人的注意力集中在塔尖的少数硬规则上，塔基的大量代码不需要逐行审读，只要在规则约束下通过测试即可</figcaption> </figure>

## 塔尖放少数硬规矩
**金字塔最上层放 25 条必须遵守的硬规矩**。

每条规矩都由人逐条审定，配套代码路径和测试守住。规矩多了 Agent 记不住，只有少而硬、每条都有机制卡住的规则才会被稳定遵守。

我们参考 RFC 单决策单条、落地后不轻易修改的写法，每条规则只讲一件事[^4]。以 Trace 规则为例，Trace 是 append-only 的 JSON Lines 文件，历史记录只追加、不原地修改。写入逻辑每次打开文件都用 O_APPEND，单次 `write(2)` 提交完整记录。核心测试会检查 Trace 文件轮转后的旧文件仍保持只追加，数 MB 的记录通过单次底层写入完成。

有人觉得像 RFC 一样写规矩是官僚主义，会拖慢 vibe coding。只有绝对不能破的少数规矩放在这一层，每条短到可以配一个测试守住。

<figure class="post-figure" data-figure="vibe-rules-rule-path"> <svg class="fig-svg" viewBox="0 0 560 242" role="img" aria-labelledby="rules-for-vibe-coding-vibe-rules-rule-path-zh-title"> <title id="rules-for-vibe-coding-vibe-rules-rule-path-zh-title">硬规矩从确立到生效的四个线性环节，旁路标注会话提示为软约束路径</title> <defs><marker id="rules-for-vibe-coding-vibe-rules-rule-path-zh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs> <g transform="translate(16 0)"> <rect x="92" y="10" width="168" height="36" rx="6" class="fig-box"/> <text x="176" y="32.5" class="fig-label" text-anchor="middle">编号原则/单决定提案</text> <path d="M176 46V71" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-rule-path-zh-arrow)"/> <rect x="92" y="72" width="168" height="36" rx="6" class="fig-box"/> <text x="176" y="94.5" class="fig-label" text-anchor="middle">公开文档</text> <path d="M176 108V133" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-rule-path-zh-arrow)"/> <rect x="92" y="134" width="168" height="36" rx="6" class="fig-box"/> <text x="176" y="156.5" class="fig-label" text-anchor="middle">代码实现</text> <path d="M176 170V195" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-rule-path-zh-arrow)"/> <rect x="92" y="196" width="168" height="36" rx="6" class="fig-box"/> <text x="176" y="218.5" class="fig-label" text-anchor="middle">测试断言</text> <path d="M260 28H367.95V71" class="fig-link" marker-end="url(#rules-for-vibe-coding-vibe-rules-rule-path-zh-arrow)"/> <rect x="300" y="72" width="135.9" height="36" rx="6" class="fig-link"/> <text x="368" y="94.5" class="fig-label" text-anchor="middle">会话提示（软约束）</text> </g> </svg> <ol class="fig-steps"> <li>编号原则/单决定提案</li> <li>公开文档</li> <li>代码实现</li> <li>测试断言</li> <li>会话提示（软约束）</li> </ol> <figcaption>硬规矩不能只停留在提示词里，代码在运行时拦住违规动作，测试在 CI 里抓回归，会话提示只做软提醒</figcaption> </figure>

## 中层划清核心接口边界
**金字塔的中间层是核心接口抽象，一共三个**。人只需要审接口的边界和依赖关系，不用读边界后面的具体实现。

接口越小，Agent 误改范围越小，固定依赖就不会绕开必要审批。

Agent 可以修改 Agent State 目录内的所有配置、提示词和 Skill。命令策略、凭据、API 访问开关、审批模式放在 Agent State 目录外或服务端存储，Agent 编辑自身设置时碰不到这些内容[^5]。

<figure class="post-figure" data-figure="vibe-rules-agent-state"> <svg class="fig-svg" viewBox="0 0 560 290" role="img" aria-labelledby="rules-for-vibe-coding-vibe-rules-agent-state-zh-title"> <title id="rules-for-vibe-coding-vibe-rules-agent-state-zh-title">项目目录树，区分 Agent 可编辑的状态目录、其他项目目录，树外标注服务端保存的配置</title> <defs><marker id="rules-for-vibe-coding-vibe-rules-agent-state-zh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs> <rect x="68" y="119" width="299" height="22" rx="4" class="fig-s2"/> <path d="M24 28V102M24 46H38M24 74H38M24 102H38" class="fig-axis"/> <path d="M54 112V270M54 130H68M54 158H68M54 186H68M54 214H68M54 242H68M54 270H68" class="fig-axis"/> <text x="16" y="22" class="fig-code">&lt;root&gt;/&lt;project&gt;/</text> <text x="46" y="50" class="fig-code">.project_config.toml（模型表/凭据/命令策略）</text> <text x="46" y="78" class="fig-code">benchmarks/</text> <text x="46" y="106" class="fig-code">agents/&lt;agent&gt;/</text> <text x="76" y="134" class="fig-code">agent_state/（配置/提示词/Skill/钩子/记忆）</text> <text x="76" y="162" class="fig-code">traces/</text> <text x="76" y="190" class="fig-code">scratchpad/</text> <text x="76" y="218" class="fig-code">shared_env/</text> <text x="76" y="246" class="fig-code">workspaces/</text> <text x="76" y="274" class="fig-code">snapshots/</text> <rect x="341.3" y="186" width="206.7" height="40" rx="6" class="fig-box"/> <text x="444.7" y="210.5" class="fig-label" text-anchor="middle">服务端保存：审批模式、API 开关</text> </svg> <ol class="fig-steps"> <li>&lt;root&gt;/&lt;project&gt;/</li> <li>benchmarks/</li> <li>.project_config.toml（模型表/凭据/命令策略）</li> <li>agents/&lt;agent&gt;/</li> <li>agent_state/（配置/提示词/Skill/钩子/记忆）</li> <li>traces/</li> <li>scratchpad/</li> <li>shared_env/</li> <li>workspaces/</li> <li>snapshots/</li> <li>服务端保存：审批模式、API 开关</li> </ol> <figcaption>目录布局统一定义在 paths.ts 里，Agent State 只放能改变 Agent 行为的可编辑文件，其余内容各归其位</figcaption> </figure>

每个工具调用的审批必须走 Human 接口的回调，没有回调就默认拒绝。`Session.run` 会先用 Project 的命令策略包装审批回调，策略否决的命令不会再送到宿主侧询问[^6]。

<figure class="post-figure" data-figure="vibe-rules-interfaces"> <svg class="fig-svg" viewBox="0 0 560 272" role="img" aria-labelledby="rules-for-vibe-coding-vibe-rules-interfaces-zh-title"> <title id="rules-for-vibe-coding-vibe-rules-interfaces-zh-title">context_engine 居中，仅通过 OmniMessage 与三个边界交互，所有审批决定与执行结果写入 Trace</title> <defs><marker id="rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs> <rect x="16" y="10" width="204.5" height="36" rx="6" class="fig-box"/> <text x="118.3" y="32.5" class="fig-label" text-anchor="middle">Human（审批回调）</text> <rect x="339.5" y="10" width="204.5" height="36" rx="6" class="fig-box"/> <text x="441.8" y="32.5" class="fig-label" text-anchor="middle">LLM（模型响应）</text> <rect x="132" y="90" width="296" height="92" rx="10" class="fig-bracket"/> <text x="280" y="112" class="fig-code fig-label" text-anchor="middle">OmniMessage</text> <rect x="207.7" y="126" width="144.7" height="40" rx="6" class="fig-box"/> <text x="280" y="150.5" class="fig-code fig-label" text-anchor="middle">context_engine</text> <rect x="16" y="226" width="204.5" height="36" rx="6" class="fig-box"/> <text x="118.3" y="248.5" class="fig-label" text-anchor="middle">Environment（工具执行结果）</text> <rect x="339.5" y="226" width="204.5" height="36" rx="6" class="fig-terminal"/> <text x="441.8" y="248.5" class="fig-label" text-anchor="middle">Trace（全量审计记录）</text> <path d="M172.5 47V89" class="fig-edge" marker-start="url(#rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow)" marker-end="url(#rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow)"/> <path d="M387.5 47V89" class="fig-edge" marker-start="url(#rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow)" marker-end="url(#rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow)"/> <path d="M172.5 183V225" class="fig-edge" marker-start="url(#rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow)" marker-end="url(#rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow)"/> <path d="M387.5 182V225" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow)"/> </svg> <ol class="fig-steps"> <li>context_engine</li> <li>OmniMessage</li> <li>Human（审批回调）</li> <li>LLM（模型响应）</li> <li>Environment（工具执行结果）</li> <li>Trace（全量审计记录）</li> </ol> <figcaption>引擎只在 OmniMessage 上做处理，三个边界各管一摊，所有决定都留审计记录</figcaption> </figure>

有人觉得最小接口会限制 Agent 的能力。放在外面的只是它永远不该给自己授权的部分，剩下的权限才能放心交给它。

## 塔基堆起可复用组件
这份权限覆盖的可复用组件，构成了金字塔的塔基。**0.2.16 的 12 个包里共 1489 个 TypeScript 源文件**[^7]。几乎全部属于这一层。

这些代码大部分由 Agent 在规则和接口的约束下迭代，人不需要逐行审读，只要测试通过、不违反上层规则即可。我们明确告诉 Agent 优先改进现有抽象、能复用就复用。

GitClear 分析 2020 到 2024 年共 2.11 亿行变更代码，其中重构占比从 2021 年的 25% 降到 2024 年的 10% 以下，复制粘贴行占比从 8.3% 升到 12.3%[^8]。`test/icon-scale.test.ts` 会在出现第二份 caret 图标、关闭叉或折叠箭头时失败。支持热更新交接运行中任务的改动，直接复用了终端交接已有的机制。

<figure class="post-figure" data-figure="vibe-rules-reuse"> <svg class="fig-svg" viewBox="0 0 560 348" role="img" aria-labelledby="rules-for-vibe-coding-vibe-rules-reuse-zh-title"> <title id="rules-for-vibe-coding-vibe-rules-reuse-zh-title">新需求进入后的复用决策分支流程，标注抽象的停留边界</title> <defs><marker id="rules-for-vibe-coding-vibe-rules-reuse-zh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs> <rect x="162.1" y="10" width="80" height="36" rx="6" class="fig-terminal"/> <text x="202.1" y="32.5" class="fig-label" text-anchor="middle">新需求</text> <path d="M202.05 46V69" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-reuse-zh-arrow)"/> <rect x="143.8" y="70" width="116.6" height="36" rx="6" class="fig-box"/> <text x="202.1" y="92.5" class="fig-label" text-anchor="middle">查已有组件/机制</text> <rect x="328" y="124" width="76" height="36" rx="6" class="fig-terminal"/> <text x="366" y="146.5" class="fig-label" text-anchor="middle">直接复用</text> <path d="M202.05 142H327" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-reuse-zh-arrow)"/> <rect x="328" y="174" width="100" height="36" rx="6" class="fig-terminal"/> <text x="378" y="196.5" class="fig-label" text-anchor="middle">扩展现有实现</text> <path d="M202.05 192H327" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-reuse-zh-arrow)"/> <path d="M202.05 106V231" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-reuse-zh-arrow)"/> <polygon points="108.1,254 122.1,232 282,232 296,254 282,276 122.1,276" class="fig-box"/> <text x="202.1" y="258.5" class="fig-label" text-anchor="middle">是否为跨场景通用行为？</text> <rect x="328" y="302" width="123.9" height="36" rx="6" class="fig-terminal"/> <text x="390" y="324.5" class="fig-label" text-anchor="middle">抽新组件入共享层</text> <path d="M296 254H389.95V301" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-reuse-zh-arrow)"/> <rect x="140.1" y="302" width="123.9" height="36" rx="6" class="fig-terminal"/> <text x="202.1" y="324.5" class="fig-label" text-anchor="middle">留在单业务逻辑内</text> <path d="M202.05 276V301" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-reuse-zh-arrow)"/> </svg> <ol class="fig-steps"> <li>新需求</li> <li>查已有组件/机制</li> <li>直接复用</li> <li>扩展现有实现</li> <li>是否为跨场景通用行为？</li> <li>抽新组件入共享层</li> <li>留在单业务逻辑内</li> </ol> <figcaption>复用优先，抽象只落在真正跨场景通用的行为上，既不重复造轮子，也不过度抽象</figcaption> </figure>

有人觉得现在代码写得快，复制更快，过早抽象反而麻烦。复制写的时候省时间，维护时每个副本都要过一遍规则；我们只把跨场景通用的行为抽到共享层，一次性逻辑留在对应功能里。

## 从一条规矩开始
这些分层规则靠逐次补错完善，我们参考 Mitchell Hashimoto 的实践思路：每次发现 Agent 犯错，就做一个机制让它再也不犯同样的错[^9]。

**这个金字塔的核心作用是分配注意力**。人把精力放在塔尖的少数规则上，塔基的大量代码交给 Agent 在测试约束下迭代，不用逐行读。规矩放在仓库里、用测试钉住，一次修好，所有后续会话都不会再犯。

下次 Agent 重复犯同一个错，先判断这个规矩属于哪一层，把它写进去，再配一个会失败的测试钉住，不用把提示词写得更长。

[^1]: [Announcing the 2025 DORA Report | Google Cloud Blog](https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report)
[^2]: [How Claude remembers your project - Claude Code Docs](https://code.claude.com/docs/en/memory)
[^3]: [Vibe coding service Replit deleted production database](https://www.theregister.com/2025/07/21/replit_saastr_vibe_coding_incident/)
[^4]: [rust-lang/rfcs: 0000-template.md](https://raw.githubusercontent.com/rust-lang/rfcs/master/0000-template.md)
[^5]: [PenguinHarness docs: Configuration Reference](https://penguin.ooo/docs/configuration)
[^6]: [PenguinHarness docs: Core Interfaces](https://penguin.ooo/docs/interfaces)
[^7]: Our count of the PenguinHarness 0.2.16 source tree
[^8]: [AI Copilot Code Quality: 2025 Data Suggests 4x Growth in Code Clones - GitClear](https://www.gitclear.com/ai_assistant_code_quality_2025_research)
[^9]: [My AI Adoption Journey – Mitchell Hashimoto](https://mitchellh.com/writing/my-ai-adoption-journey)
