---
title: "如何在 vibe coding 时候立住规矩，写出来的代码不烧心"
date: 2026-10-19
category: perspectives
excerpt: "vibe coding 不用逐行盯 diff。我们把约束分三层写进仓库作为 AI 的持久记忆，靠代码和测试守住硬边界。"
---

vibe coding 时要先立住规矩，写出来的代码才不烧心。我们的做法是把要 AI 遵守的约束分三层写进仓库，也就是 code as memory。

聊天里随口提的约定，没写进文件就留不下来。我们不用每次会话反复叮嘱规则。把约束写进仓库，AI 用工具读文件、跑测试时自然会碰到。我们把这些约束分成三层，分别是人的规矩、接口抽象、可复用组件。

<figure class="post-figure" data-figure="vibe-rules-three-layers"> <svg class="fig-svg" viewBox="0 0 560 282" role="img" aria-labelledby="rules-for-vibe-coding-vibe-rules-three-layers-zh-title"> <title id="rules-for-vibe-coding-vibe-rules-three-layers-zh-title">三层约束自上而下堆叠，侧边标注代码即记忆，说明三层的核心内容</title> <defs><marker id="rules-for-vibe-coding-vibe-rules-three-layers-zh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs> <rect x="52" y="34" width="277.8" height="62" rx="6" class="fig-box"/> <text x="70" y="60" class="fig-title">人的规矩</text> <text x="70" y="81">原则条款、提案、代码、测试</text> <rect x="52" y="110" width="277.8" height="62" rx="6" class="fig-box"/> <text x="70" y="136" class="fig-title">接口抽象</text> <text x="70" y="157">目录布局、类型、依赖契约</text> <rect x="52" y="186" width="277.8" height="62" rx="6" class="fig-box"/> <text x="70" y="212" class="fig-title">可复用组件</text> <text x="70" y="233">共享包、Skill、插件</text> <path d="M26 36V246" class="fig-edge" marker-start="url(#rules-for-vibe-coding-vibe-rules-three-layers-zh-arrow)" marker-end="url(#rules-for-vibe-coding-vibe-rules-three-layers-zh-arrow)"/> <text x="16" y="22" class="fig-note">越往上越硬</text> <text x="16" y="270" class="fig-note">越往下越常变</text> <path d="M337.8 34H343.8V248H337.8M343.8 141H351.8" class="fig-bracket"/> <text x="359.8" y="145.5" class="fig-label">代码即记忆（code as memory）</text> </svg> <ol class="fig-steps"> <li>人的规矩</li> <li>原则条款、提案、代码、测试</li> <li>接口抽象</li> <li>目录布局、类型、依赖契约</li> <li>可复用组件</li> <li>共享包、Skill、插件</li> <li>代码即记忆（code as memory）</li> <li>越往上越硬</li> <li>越往下越常变</li> </ol> <figcaption>我们把管 AI 的约束分三层写进仓库，硬约束靠代码和测试守住，抽象边界定在中间，组件层允许持续迭代</figcaption> </figure>

## 人的规矩：硬边界靠代码和测试守住
Andrej Karpathy 在 2025 年 2 月提出 vibe coding，描述的是全程点「Accept All」、不读 diff 的状态。他提到这种方式做周末一次性项目问题不大。

我们看到，缺少约束的快写已经在行业数据里露出代价。GitClear 分析了 2020 到 2024 年共 2.11 亿行代码改动。数据显示，改动行中与重构相关的占比从 2021 年的 25% 降到 2024 年的不足 10%。同期复制粘贴的代码占比从 8.3% 升到 12.3%。

Google DORA 2025 报告给出了类似结论。没有完善的自动化测试、成熟版本控制和快速反馈机制，AI 带来的改动量上升会拉低交付稳定性。

Veracode 2025 年测试了百余个大模型在多语言下生成的代码。45% 的样本存在 OWASP Top 10 级别的安全漏洞。漏洞比例和模型大小、训练精细度没有明显关联。

2025 年 7 月，SaaStr 创始人 Jason Lemkin 提到自己使用 Replit AI 编程工具的经历。他明确要求工具不得擅自改代码，工具还是删掉了生产环境数据库。The Register 转述了他的说法。

这一层是我们要求 AI 始终遵守的规矩。私有的设计仓库里，原则条款、名词定义和提案逐条编号。一部分规矩也写在公开的开发 Skill、文档和 PR 说明里。

提案一篇只记一个决定，这套写法参考 Rust RFC 流程的模板，沿用九个英文节名，正文用中文写。决定落地进代码后，对应的设计文档只留一句简短说明，指向这篇提案。

PenguinHarness 团队的本地开发环境会并排克隆私有设计仓库。实现仓库里预留了三个指向它的软链接路径。这些路径都被 .gitignore 排除，不会提交到公开仓库。design/ 指向整个设计仓库，AGENTS.md 指向设计仓库里的开发规则文件，CLAUDE.md 再指向这份 AGENTS.md。

Claude Code 每次会话启动时会读取 CLAUDE.md。Anthropic 明确，CLAUDE.md 和作为替代的 AGENTS.md 只作为上下文输入，不具备强制约束力。没有并排克隆设计仓库时，公开仓库里入库的 .agents/skills/ 下的开发 Skill 就是全部规则契约。

我们要求 AI 遵守的规矩，最终要落到代码和测试上。这些规矩不少来自真实的代码漂移或评审里的决定。

以 Trace 必须 append-only 为例，同一条规则同时写在公开文档、Trace 写入器的 O_APPEND 实现、轮转与单次写入的测试里。就算提示词没提到，写入逻辑也不会允许原地修改历史记录。

Provider 的报错不按文字匹配。[#1018](https://github.com/Prism-Shadow/penguin-harness/pull/1018) 的第一版写了 16 个正则模式匹配图片类拒绝的文案。评审中按负责人意见改成「输入里有图 + 4xx = 图片拒绝」。报错文本原样透传给用户和模型，不做正则归类。理由是供应商对拒绝的措辞五花八门，模式列表不可靠。

prompt cache 测试的基准数字不能随便改到通过。缓存回归本身会增加 Token 成本，不会引发性能下降或界面报错。改基准数字让 CI 变绿，等于替用户做了一个花钱的决定。这类改动会把缓存回归掩盖到上线之后。

默认 Prompt 加了新占位符却没进界面列表的漂移发生过一次。之后补的对等测试，从 core 真实的默认 Prompt 派生一份占位符列表。测试会把这份列表和两份界面词典做对比。

我们的做法是，出现过一次漂移的边界，就补一条测试钉住。从编号原则到测试断言的落地链路如下图所示。

<figure class="post-figure" data-figure="vibe-rules-rule-path"> <svg class="fig-svg" viewBox="0 0 560 242" role="img" aria-labelledby="rules-for-vibe-coding-vibe-rules-rule-path-zh-title"> <title id="rules-for-vibe-coding-vibe-rules-rule-path-zh-title">硬规矩从确立到生效的四个线性环节，旁路标注会话提示为软约束路径</title> <defs><marker id="rules-for-vibe-coding-vibe-rules-rule-path-zh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs> <g transform="translate(16 0)"> <rect x="92" y="10" width="168" height="36" rx="6" class="fig-box"/> <text x="176" y="32.5" class="fig-label" text-anchor="middle">编号原则/单决定提案</text> <path d="M176 46V71" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-rule-path-zh-arrow)"/> <rect x="92" y="72" width="168" height="36" rx="6" class="fig-box"/> <text x="176" y="94.5" class="fig-label" text-anchor="middle">公开文档</text> <path d="M176 108V133" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-rule-path-zh-arrow)"/> <rect x="92" y="134" width="168" height="36" rx="6" class="fig-box"/> <text x="176" y="156.5" class="fig-label" text-anchor="middle">代码实现</text> <path d="M176 170V195" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-rule-path-zh-arrow)"/> <rect x="92" y="196" width="168" height="36" rx="6" class="fig-box"/> <text x="176" y="218.5" class="fig-label" text-anchor="middle">测试断言</text> <path d="M260 28H367.95V71" class="fig-link" marker-end="url(#rules-for-vibe-coding-vibe-rules-rule-path-zh-arrow)"/> <rect x="300" y="72" width="135.9" height="36" rx="6" class="fig-link"/> <text x="368" y="94.5" class="fig-label" text-anchor="middle">会话提示（软约束）</text> </g> </svg> <ol class="fig-steps"> <li>编号原则/单决定提案</li> <li>公开文档</li> <li>代码实现</li> <li>测试断言</li> <li>会话提示（软约束）</li> </ol> <figcaption>硬规矩不能只停留在提示词里，代码在运行时拦住违规动作，测试在 CI 里抓回归，会话提示只做软提醒</figcaption> </figure>

## 接口边界要收窄到最小必要
中间层是核心接口抽象，我们按最小必要的思路设计边界。Agent State 是磁盘上的一个目录，只放能直接改变 Agent 行为的可编辑文件，包括配置、Agent 自己的 AGENTS.md 提示词文件、Skill、钩子、记忆、Vault 和定时任务。

Agent State 的边界由目录布局和配置存放位置共同划定，.project_config.toml 与服务端保存的配置都不进入这个目录。

<figure class="post-figure" data-figure="vibe-rules-agent-state"> <svg class="fig-svg" viewBox="0 0 560 290" role="img" aria-labelledby="rules-for-vibe-coding-vibe-rules-agent-state-zh-title"> <title id="rules-for-vibe-coding-vibe-rules-agent-state-zh-title">项目目录树，区分 Agent 可编辑的状态目录、其他项目目录，树外标注服务端保存的配置</title> <defs><marker id="rules-for-vibe-coding-vibe-rules-agent-state-zh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs> <rect x="68" y="119" width="299" height="22" rx="4" class="fig-s2"/> <path d="M24 28V102M24 46H38M24 74H38M24 102H38" class="fig-axis"/> <path d="M54 112V270M54 130H68M54 158H68M54 186H68M54 214H68M54 242H68M54 270H68" class="fig-axis"/> <text x="16" y="22" class="fig-code">&lt;root&gt;/&lt;project&gt;/</text> <text x="46" y="50" class="fig-code">.project_config.toml（模型表/凭据/命令策略）</text> <text x="46" y="78" class="fig-code">benchmarks/</text> <text x="46" y="106" class="fig-code">agents/&lt;agent&gt;/</text> <text x="76" y="134" class="fig-code">agent_state/（配置/提示词/Skill/钩子/记忆）</text> <text x="76" y="162" class="fig-code">traces/</text> <text x="76" y="190" class="fig-code">scratchpad/</text> <text x="76" y="218" class="fig-code">shared_env/</text> <text x="76" y="246" class="fig-code">workspaces/</text> <text x="76" y="274" class="fig-code">snapshots/</text> <rect x="341.3" y="186" width="206.7" height="40" rx="6" class="fig-box"/> <text x="444.7" y="210.5" class="fig-label" text-anchor="middle">服务端保存：审批模式、API 开关</text> </svg> <ol class="fig-steps"> <li>&lt;root&gt;/&lt;project&gt;/</li> <li>benchmarks/</li> <li>.project_config.toml（模型表/凭据/命令策略）</li> <li>agents/&lt;agent&gt;/</li> <li>agent_state/（配置/提示词/Skill/钩子/记忆）</li> <li>traces/</li> <li>scratchpad/</li> <li>shared_env/</li> <li>workspaces/</li> <li>snapshots/</li> <li>服务端保存：审批模式、API 开关</li> </ol> <figcaption>目录布局统一定义在 paths.ts 里，Agent State 只放能改变 Agent 行为的可编辑文件，其余内容各归其位</figcaption> </figure>

`context_engine` 只处理结构化的 OmniMessage，对外依赖 Human、LLM、Environment 三个边界。Human 边界就是 SDK 入口 `session.run` 的签名，协议转换都在实现内部完成，引擎不解析标记文本做来源判断。

每个完整的 tool_call 都会生成一条审批决定写入 Trace。SDK 不注入审批回调时默认拒绝所有调用。子 Agent 继承父级的审批回调，策略覆盖整棵委托树。钩子可以在审批回调之前给出 allow 或 deny 的判断。但钩子的 allow 压不过项目级的命令策略，被策略否决的调用始终保持 forbidden。Agent 不能通过自身设置放宽审批模式或修改命令策略。

下图画出了 context_engine、三个边界与 Trace 之间的固定流向。

<figure class="post-figure" data-figure="vibe-rules-interfaces"> <svg class="fig-svg" viewBox="0 0 560 272" role="img" aria-labelledby="rules-for-vibe-coding-vibe-rules-interfaces-zh-title"> <title id="rules-for-vibe-coding-vibe-rules-interfaces-zh-title">context_engine 居中，仅通过 OmniMessage 与三个边界交互，所有审批决定与执行结果写入 Trace</title> <defs><marker id="rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs> <rect x="16" y="10" width="204.5" height="36" rx="6" class="fig-box"/> <text x="118.3" y="32.5" class="fig-label" text-anchor="middle">Human（审批回调）</text> <rect x="339.5" y="10" width="204.5" height="36" rx="6" class="fig-box"/> <text x="441.8" y="32.5" class="fig-label" text-anchor="middle">LLM（模型响应）</text> <rect x="132" y="90" width="296" height="92" rx="10" class="fig-bracket"/> <text x="280" y="112" class="fig-code fig-label" text-anchor="middle">OmniMessage</text> <rect x="207.7" y="126" width="144.7" height="40" rx="6" class="fig-box"/> <text x="280" y="150.5" class="fig-code fig-label" text-anchor="middle">context_engine</text> <rect x="16" y="226" width="204.5" height="36" rx="6" class="fig-box"/> <text x="118.3" y="248.5" class="fig-label" text-anchor="middle">Environment（工具执行结果）</text> <rect x="339.5" y="226" width="204.5" height="36" rx="6" class="fig-terminal"/> <text x="441.8" y="248.5" class="fig-label" text-anchor="middle">Trace（全量审计记录）</text> <path d="M172.5 47V89" class="fig-edge" marker-start="url(#rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow)" marker-end="url(#rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow)"/> <path d="M387.5 47V89" class="fig-edge" marker-start="url(#rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow)" marker-end="url(#rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow)"/> <path d="M172.5 183V225" class="fig-edge" marker-start="url(#rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow)" marker-end="url(#rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow)"/> <path d="M387.5 182V225" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-interfaces-zh-arrow)"/> </svg> <ol class="fig-steps"> <li>context_engine</li> <li>OmniMessage</li> <li>Human（审批回调）</li> <li>LLM（模型响应）</li> <li>Environment（工具执行结果）</li> <li>Trace（全量审计记录）</li> </ol> <figcaption>引擎只在 OmniMessage 上做处理，三个边界各管一摊，所有决定都留审计记录</figcaption> </figure>

早期命令策略曾放在 `context_engine` 里做匹配，引擎自己生成了 approval_decision 事件，越权替 Human 做了决定。最后改成由 `Session.run` 包装注入的审批回调，`context_engine` 仍然只处理 OmniMessage。

命令策略是一道防误操作的护栏，不承担安全边界职责。它不覆盖运行时拼出来的命令，真正的隔离靠 bubblewrap、dsh 这类沙盒机制。

## 复用优先，再谈扩展
接口边界定好之后，这一层允许 AI 持续改进抽象，但前提是优先复用已有实现，不要每次从头造轮子。

前端开发 Skill 把复用优先的判断顺序写得很明确。面对新需求，我们遵循先复用、再扩展、最后按需抽取的路径。

<figure class="post-figure" data-figure="vibe-rules-reuse"> <svg class="fig-svg" viewBox="0 0 560 348" role="img" aria-labelledby="rules-for-vibe-coding-vibe-rules-reuse-zh-title"> <title id="rules-for-vibe-coding-vibe-rules-reuse-zh-title">新需求进入后的复用决策分支流程，标注抽象的停留边界</title> <defs><marker id="rules-for-vibe-coding-vibe-rules-reuse-zh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs> <rect x="162.1" y="10" width="80" height="36" rx="6" class="fig-terminal"/> <text x="202.1" y="32.5" class="fig-label" text-anchor="middle">新需求</text> <path d="M202.05 46V69" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-reuse-zh-arrow)"/> <rect x="143.8" y="70" width="116.6" height="36" rx="6" class="fig-box"/> <text x="202.1" y="92.5" class="fig-label" text-anchor="middle">查已有组件/机制</text> <rect x="328" y="124" width="76" height="36" rx="6" class="fig-terminal"/> <text x="366" y="146.5" class="fig-label" text-anchor="middle">直接复用</text> <path d="M202.05 142H327" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-reuse-zh-arrow)"/> <rect x="328" y="174" width="100" height="36" rx="6" class="fig-terminal"/> <text x="378" y="196.5" class="fig-label" text-anchor="middle">扩展现有实现</text> <path d="M202.05 192H327" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-reuse-zh-arrow)"/> <path d="M202.05 106V231" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-reuse-zh-arrow)"/> <polygon points="108.1,254 122.1,232 282,232 296,254 282,276 122.1,276" class="fig-box"/> <text x="202.1" y="258.5" class="fig-label" text-anchor="middle">是否为跨场景通用行为？</text> <rect x="328" y="302" width="123.9" height="36" rx="6" class="fig-terminal"/> <text x="390" y="324.5" class="fig-label" text-anchor="middle">抽新组件入共享层</text> <path d="M296 254H389.95V301" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-reuse-zh-arrow)"/> <rect x="140.1" y="302" width="123.9" height="36" rx="6" class="fig-terminal"/> <text x="202.1" y="324.5" class="fig-label" text-anchor="middle">留在单业务逻辑内</text> <path d="M202.05 276V301" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-reuse-zh-arrow)"/> </svg> <ol class="fig-steps"> <li>新需求</li> <li>查已有组件/机制</li> <li>直接复用</li> <li>扩展现有实现</li> <li>是否为跨场景通用行为？</li> <li>抽新组件入共享层</li> <li>留在单业务逻辑内</li> </ol> <figcaption>复用优先，抽象只落在真正跨场景通用的行为上，既不重复造轮子，也不过度抽象</figcaption> </figure>

共享 UI 包 `packages/ui` 承载设计令牌、主题、通用组件，包内测试守住令牌契约，保证每个主题和模式都定义了所有设计令牌名。Web App 里的状态色只在 tone.ts 一处拼写，折叠交互统一用 packages/ui 提供的 Fold 组件。

每个包的测试替身集中放在一处，新写测试优先复用已有 fake。提简化建议要有证据，生产环境代码无调用方是强证据之一，不能凭个人口味删代码或收窄接口。

插件和核心服务使用同一套 Interface/Component/Module 组装规则，不用另写一套接入逻辑。模型接入统一走 MMSP 边界，核心不直接引入厂商 SDK。

热更新不打断运行中 Task。这项功能直接复用了终端移交场景已经验证过的注册表、资源校验门、挂起上下文。这次落地只新增了一个存运行时状态的纯数据组件，加了一个切换指针。之前两次尝试没有合并，原因是涉及的改动范围太广。

可选插件 `continual-learning` 不预装。它会在长 Task 结束后提示子会话。子会话可以把有用的发现写进当前 Agent 自己的 `agent_state/skills/` 下对应的 SKILL.md，也可以什么都不改。

界面去 AI 味的扫描器，我们直接复用开源实现 yetone/kill-ai-slop，没有自己重写。推理过程写在 PR 描述里，PR 描述会和对应的 diff 绑定留存，仓库文件里不保留这类内容。

## 从一条测试开始
下次 AI 写代码出了问题，你不用先写一整本规范。先把这次越界的行为写成一条会失败的测试。

---

**Sources**: [Simon Willison: vibe coding (Karpathy original quote)](https://simonwillison.net/2025/Mar/19/vibe-coding/) · [GitClear: AI Copilot Code Quality 2025 Research](https://www.gitclear.com/ai_assistant_code_quality_2025_research) · [Google Cloud: Announcing the 2025 DORA Report](https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report) · [Veracode: GenAI Code Security Report 2025](https://www.veracode.com/blog/genai-code-security-report/) · [The Register: Replit vibe coding incident](https://www.theregister.com/2025/07/21/replit_saastr_vibe_coding_incident/) · [Rust RFC Process (RFC 0002)](https://raw.githubusercontent.com/rust-lang/rfcs/master/text/0002-rfc-process.md) · [Rust RFC Template (0000-template.md)](https://raw.githubusercontent.com/rust-lang/rfcs/master/0000-template.md) · [Anthropic: Claude Code Memory](https://code.claude.com/docs/en/memory) · [PenguinHarness GitHub Repository](https://github.com/Prism-Shadow/penguin-harness) · [PenguinHarness PR #1018](https://github.com/Prism-Shadow/penguin-harness/pull/1018) · [PenguinHarness: Sessions and Traces](https://penguin.ooo/docs/sessions-and-traces) · [PenguinHarness: Core Interfaces](https://penguin.ooo/docs/interfaces) · [PenguinHarness: Agent Loop](https://penguin.ooo/docs/agent-loop) · [PenguinHarness: Configuration](https://penguin.ooo/docs/configuration) · [PenguinHarness: Agent API](https://penguin.ooo/docs/agent-api)
