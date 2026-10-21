---
title: "好的 Agent Harness 会控制上下文斜率"
date: 2026-10-19
category: perspectives
excerpt: "上下文斜率衡量 Agent 每次请求的上下文增长，是 Harness 设计的核心指标，应在压缩前优先管控。"
---

> 本文基于 PenguinHarness 0.2.16 撰写，之后的版本在部分细节上可能有所不同。

上下文斜率指每次请求的上下文增量。Anthropic 称 LLM 上下文是收益递减的有限资源。[^1]

标称窗口内的过长输入触发 context rot（上下文腐化），降低准确率。压缩会带来延迟、成本上涨、缓存失效和细节丢失。[^1][^2][^3]

Self-Manager、LangWatch、TraceLab 以其他名称测过该增长。[^4][^5][^6]我们未发现“上下文斜率”的公开用法，以此为设计视角。[^7]

管控该斜率是 Harness 核心工作，对应 Skill、工具输出、CLI、MCP 设计规则。

## 截距和斜率，两个数字
我们把单次请求的上下文成本拆成两部分。固定截距是每轮请求必带的系统提示词、工具定义等内容。每轮斜率是每步新增的工具输出、加载指令、模型回复。

OpenAI 指出，未启用提示词缓存时，Codex 代理循环的推理成本随发送的 JSON 大小呈二次方增长；开启缓存后增长接近线性。[^8][^9]

压低截距可降低所有请求的基线成本。压平斜率能推迟甚至避免触发上下文压缩，压缩是我们的最后兜底手段。压缩在上下文到达阈值后触发，会用存在信息损失的摘要替换原有上下文。模拟显示，压缩后新上下文的第一次请求完全无法命中提示词缓存。[^1][^10][^11]

我们用重复读取 64k 构建日志的合成测试集，分别测量开启、关闭现有输出上限时的上下文增长。数值按字符规则估算，不是厂商返回的 Token 计数，测试全程未调用真实模型接口。无输出上限的测试在 12 次请求后到达压缩阈值。[^10][^12][^13]

下图画出了两组测试的结果。

<figure class="post-figure" data-figure="slope-curve"> <svg class="fig-svg" viewBox="0 0 560 344" role="img" aria-labelledby="context-slope-slope-curve-zh-title"> <title id="context-slope-slope-curve-zh-title">折线图展示两种不同输出上限配置的合成测试运行中，各次请求对应的估算上下文体积</title> <polygon points="22,17 44,17 44,15 22,15" class="fig-s1"/> <circle cx="33" cy="16" r="4" class="fig-s1"/> <text x="52" y="20" class="fig-label">16,000 字符上限（64k 日志）</text> <path d="M245.7 16L267.7 16L245.7 16" class="fig-s2"/> <circle cx="256.7" cy="16" r="4" class="fig-s2"/> <text x="275.7" y="20" class="fig-label">无上限（64k 日志）</text> <path d="M22 52V292H548" class="fig-axis"/> <text x="22" y="44" class="fig-tick">估算 Token</text> <text x="548" y="310" class="fig-tick" text-anchor="end">请求序号</text> <path d="M22 85.7H548" class="fig-link"/> <text x="30" y="79.7" class="fig-note">夹具压缩阈值：197,952 估算 Token</text> <path d="M452.7 48V292" class="fig-link"/> <text x="448.7" y="44" class="fig-note" text-anchor="end">压缩后模拟缓存重置</text> <path d="M36 288.9L65.8 271.9L95.5 254.9L125.3 238L155.1 221L184.8 204L214.6 187L244.4 170L274.1 153L303.9 136L333.6 119.1L363.4 102.1L393.2 85.1L422.9 68L393.2 85.1L363.4 102.1L333.6 119.1L303.9 136L274.1 153L244.4 170L214.6 187L184.8 204L155.1 221L125.3 238L95.5 254.9L65.8 271.9L36 288.9" class="fig-s2"/> <path d="M452.7 288.9L482.5 271.9L512.2 254.9L542 238L512.2 254.9L482.5 271.9L452.7 288.9" class="fig-s2"/> <circle cx="36" cy="288.9" r="4" class="fig-s2"/> <circle cx="65.8" cy="271.9" r="4" class="fig-s2"/> <circle cx="95.5" cy="254.9" r="4" class="fig-s2"/> <circle cx="125.3" cy="238" r="4" class="fig-s2"/> <circle cx="155.1" cy="221" r="4" class="fig-s2"/> <circle cx="184.8" cy="204" r="4" class="fig-s2"/> <circle cx="214.6" cy="187" r="4" class="fig-s2"/> <circle cx="244.4" cy="170" r="4" class="fig-s2"/> <circle cx="274.1" cy="153" r="4" class="fig-s2"/> <circle cx="303.9" cy="136" r="4" class="fig-s2"/> <circle cx="333.6" cy="119.1" r="4" class="fig-s2"/> <circle cx="363.4" cy="102.1" r="4" class="fig-s2"/> <circle cx="393.2" cy="85.1" r="4" class="fig-s2"/> <circle cx="422.9" cy="68" r="4" class="fig-s2"/> <circle cx="452.7" cy="288.9" r="4" class="fig-s2"/> <circle cx="482.5" cy="271.9" r="4" class="fig-s2"/> <circle cx="512.2" cy="254.9" r="4" class="fig-s2"/> <circle cx="542" cy="238" r="4" class="fig-s2"/> <polygon points="36.1,289.9 65.9,285.6 65.6,283.6 35.9,287.9" class="fig-s1"/> <polygon points="65.9,285.6 95.7,281.2 95.4,279.2 65.6,283.6" class="fig-s1"/> <polygon points="95.7,281.2 125.4,276.9 125.1,274.9 95.4,279.2" class="fig-s1"/> <polygon points="125.4,276.9 155.2,272.5 154.9,270.6 125.1,274.9" class="fig-s1"/> <polygon points="155.2,272.5 185,268.2 184.7,266.2 154.9,270.6" class="fig-s1"/> <polygon points="185,268.2 214.7,263.9 214.4,261.9 184.7,266.2" class="fig-s1"/> <polygon points="214.7,263.9 244.5,259.5 244.2,257.6 214.4,261.9" class="fig-s1"/> <polygon points="244.5,259.5 274.3,255.2 274,253.2 244.2,257.6" class="fig-s1"/> <polygon points="274.3,255.2 304,250.9 303.7,248.9 274,253.2" class="fig-s1"/> <polygon points="304,250.9 333.8,246.5 333.5,244.5 303.7,248.9" class="fig-s1"/> <polygon points="333.8,246.5 363.6,242.2 363.3,240.2 333.5,244.5" class="fig-s1"/> <polygon points="363.6,242.2 393.3,237.8 393,235.9 363.3,240.2" class="fig-s1"/> <polygon points="393.3,237.8 423.1,233.5 422.8,231.5 393,235.9" class="fig-s1"/> <polygon points="423.1,233.5 452.9,229.2 452.6,227.2 422.8,231.5" class="fig-s1"/> <polygon points="452.9,229.2 482.6,224.8 482.3,222.8 452.6,227.2" class="fig-s1"/> <polygon points="482.6,224.8 512.4,220.5 512.1,218.5 482.3,222.8" class="fig-s1"/> <circle cx="36" cy="288.9" r="4" class="fig-s1"/> <circle cx="65.8" cy="284.6" r="4" class="fig-s1"/> <circle cx="95.5" cy="280.2" r="4" class="fig-s1"/> <circle cx="125.3" cy="275.9" r="4" class="fig-s1"/> <circle cx="155.1" cy="271.6" r="4" class="fig-s1"/> <circle cx="184.8" cy="267.2" r="4" class="fig-s1"/> <circle cx="214.6" cy="262.9" r="4" class="fig-s1"/> <circle cx="244.4" cy="258.5" r="4" class="fig-s1"/> <circle cx="274.1" cy="254.2" r="4" class="fig-s1"/> <circle cx="303.9" cy="249.9" r="4" class="fig-s1"/> <circle cx="333.6" cy="245.5" r="4" class="fig-s1"/> <circle cx="363.4" cy="241.2" r="4" class="fig-s1"/> <circle cx="393.2" cy="236.8" r="4" class="fig-s1"/> <circle cx="422.9" cy="232.5" r="4" class="fig-s1"/> <circle cx="452.7" cy="228.2" r="4" class="fig-s1"/> <circle cx="482.5" cy="223.8" r="4" class="fig-s1"/> <circle cx="512.2" cy="219.5" r="4" class="fig-s1"/> <path d="M36 293.9V299" class="fig-link"/> <text x="32" y="310" class="fig-note">夹具截距（第 0 次请求）：2,963 估算 Token</text> <text x="22" y="334" class="fig-note">体积为基于字符的估算值，非服务商官方 Token 计数</text> </svg> <ol class="fig-steps"> <li>请求序号</li> <li>估算 Token</li> <li>16,000 字符上限（64k 日志）</li> <li>无上限（64k 日志）</li> <li>夹具截距（第 0 次请求）：2,963 估算 Token</li> <li>夹具压缩阈值：197,952 估算 Token</li> <li>压缩后模拟缓存重置</li> <li>体积为基于字符的估算值，非服务商官方 Token 计数</li> </ol> <figcaption>在测量的各次请求中，设置输出上限的斜率始终低于压缩阈值；无输出上限的配置很快触达阈值，触发压缩步骤，导致新上下文的第一次请求出现完整的模拟缓存未命中。体积为基于字符启发式规则计算的估算 Token。</figcaption> </figure>

第一个可落地的杠杆，是压低这个固定截距。

## 渐进加载压低固定截距
Skill 设计是最清晰的截距控制案例。

行业内 Skill 的标准设计遵循渐进式披露原则。会话初始阶段只发送每个 Skill 的名称和短描述，完整使用指令按需加载。[^14][^15][^16]

下图对比了 PenguinHarness 0.2.16 自带 35 个 Skill 各内容层级的估算 Token 大小。

<figure class="post-figure" data-figure="slope-skill-tiers"> <svg class="fig-svg" viewBox="0 0 560 206" role="img" aria-labelledby="context-slope-slope-skill-tiers-zh-title"> <title id="context-slope-slope-skill-tiers-zh-title">柱状图对比 0.2.16 版本发布的 35 个 Skill 各内容层级的估算体积</title> <text x="16" y="21" class="fig-label">全量库索引（花名册行）：2,843 估算 Token</text> <path d="M16 28H24A4 4 0 0 1 28 32V42A4 4 0 0 1 24 46H16Z" class="fig-s3"/> <text x="16" y="73" class="fig-label">全部 SKILL.md 正文：124,826 估算 Token（索引的 43.9 倍）</text> <path d="M16 80H540A4 4 0 0 1 544 84V94A4 4 0 0 1 540 98H16Z" class="fig-s3"/> <text x="16" y="125" class="fig-label">参考文档：58,577 估算 Token</text> <path d="M16 132H259.8A4 4 0 0 1 263.8 136V146A4 4 0 0 1 259.8 150H16Z" class="fig-s3"/> <text x="16" y="178" class="fig-note">随版发布的脚本总计 35,248 估算 Token，但会直接执行，不会读入上下文</text> <text x="16" y="196" class="fig-note">体积为全量 35 个 Skill 库的基于字符估算值</text> </svg> <ol class="fig-steps"> <li>全量库索引（花名册行）：2,843 估算 Token</li> <li>全部 SKILL.md 正文：124,826 估算 Token（索引的 43.9 倍）</li> <li>参考文档：58,577 估算 Token</li> <li>随版发布的脚本总计 35,248 估算 Token，但会直接执行，不会读入上下文</li> <li>体积为全量 35 个 Skill 库的基于字符估算值</li> </ol> <figcaption>全量 35 个 Skill 的索引体积很小；一开始就加载所有 SKILL.md 会带来索引体积 43.9 倍的估算 Token 开销，加载参考文档还会进一步增加重量。体积为基于字符的估算值，非服务商官方 Token 计数。</figcaption> </figure>

在 PenguinHarness 0.2.16 中，系统提示词为每个已安装 Skill 列一行说明。模型按需通过 `read_file` 或 shell 调用读取 Skill 正文。[^17][^18][^19]

这个索引优先规则有两个例外。`AGENTS.md` 会完整注入且不设上限，所有 MCP 工具定义会随每次请求发送。[^17][^18][^20]

加载后的 Skill 正文会留在当前上下文，直到压缩步骤用摘要替换历史记录。渐进加载可以压低固定截距，无法完全消除斜率。[^21]

只削减截距不够，每轮斜率的主要来源是工具输出。

## 落盘式输出上限压平每轮增长
我们的合成夹具测试显示，不受限的工具输出会带来陡峭的每轮增长，无上限的日志很快就会逼近压缩阈值。[^12]

PenguinHarness 默认给每个工具结果设 16,000 字符的输出上限，保留内容头部和尾部，避免丢失退出码、报错信息。[^22][^23]超出上限的内容会存入会话暂存区的恢复文件（单次调用最多存 8 MiB），文件路径直接追加到内联内容末尾。[^22][^24][^25]模型可以通过已有的文件工具按需读取片段。[^24][^25]

当输出超过上限后，每轮的上下文增长不再随原始输出大小变化。[^12]Claude Code 和 Cursor 也会把超量输出持久化到磁盘。[^26][^27][^28]我们判断，像 Claude Code 那样用路径加预览的方式降低内联开销，能进一步压平斜率，但 PenguinHarness 当前版本还没实现这个设计。

下图展示了原始工具输出经过 16,000 字符上限处理后，拆分为内联条目和磁盘恢复文件的完整流程。

<figure class="post-figure" data-figure="slope-output-cap"> <svg class="fig-svg" viewBox="0 0 560 348" role="img" aria-labelledby="context-slope-slope-output-cap-zh-title"> <title id="context-slope-slope-output-cap-zh-title">流程图展示 PenguinHarness 中超上限工具输出拆分到行内上下文和磁盘存储的流程</title> <defs><marker id="context-slope-slope-output-cap-zh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs> <rect x="16" y="10" width="100" height="36" rx="6" class="fig-terminal"/> <text x="66" y="32.5" class="fig-label" text-anchor="middle">原始工具输出</text> <rect x="162" y="10" width="203.7" height="36" rx="6" class="fig-box"/> <text x="263.9" y="32.5" class="fig-label" text-anchor="middle">16,000 字符上限（头部+尾部）</text> <path d="M116 28H161" class="fig-edge" marker-end="url(#context-slope-slope-output-cap-zh-arrow)"/> <rect x="16" y="80" width="400" height="78" rx="6" class="fig-box"/> <text x="30" y="102" class="fig-label">行内上下文条目：4,163 估算 Token/超上限轮次</text> <text x="30" y="126" class="fig-code fig-note">[output truncated: kept first … and last … of … chars]</text> <text x="30" y="146" class="fig-code fig-note">[output archived: &lt;path&gt;]</text> <path d="M263.9 46V79" class="fig-edge" marker-end="url(#context-slope-slope-output-cap-zh-arrow)"/> <rect x="287" y="182" width="257" height="36" rx="6" class="fig-terminal"/> <text x="415.5" y="204.5" class="fig-label" text-anchor="middle">磁盘上的恢复文件（单次调用最多 8 MiB）</text> <path d="M365.7 28H526V181" class="fig-edge" marker-end="url(#context-slope-slope-output-cap-zh-arrow)"/> <rect x="16" y="238" width="245.9" height="36" rx="6" class="fig-box"/> <text x="139" y="260.5" class="fig-label" text-anchor="middle">模型通过 read_file/rg/tail 读取目标切片</text> <path d="M415.5 218V256H262.9" class="fig-edge" marker-end="url(#context-slope-slope-output-cap-zh-arrow)"/> <text x="16" y="302" class="fig-note">无上限 64k 日志每轮增加 16,297 估算 Token</text> <text x="16" y="320" class="fig-note">无上限 256k 日志每轮增加 65,004 估算 Token</text> <text x="16" y="338" class="fig-note">体积为基于字符的估算值</text> </svg> <ol class="fig-steps"> <li>原始工具输出</li> <li>16,000 字符上限（头部+尾部）</li> <li>行内上下文条目：4,163 估算 Token/超上限轮次</li> <li>磁盘上的恢复文件（单次调用最多 8 MiB）</li> <li>模型通过 read_file/rg/tail 读取目标切片</li> <li>[output truncated: kept first … and last … of … chars]</li> <li>[output archived: &lt;path&gt;]</li> <li>无上限 64k 日志每轮增加 16,297 估算 Token</li> <li>无上限 256k 日志每轮增加 65,004 估算 Token</li> <li>体积为基于字符的估算值</li> </ol> <figcaption>输出上限阻止每轮上下文增长随原始输出体积线性放大，恢复文件降低截断带来的数据丢失风险，同时不用在后续每一轮携带完整输出。每轮计数为基于字符启发式计算的估算 Token。</figcaption> </figure>

这种“小片段内联 + 全量落盘”的规则，同样适用于 CLI（命令行）和 MCP 接口。

## CLI 和 MCP 遵循同一斜率规则
0.2.16 自带的浏览器自动化插件，不向固定截距添加工具 schema。[^29][^30]它通过 `exec_command` 提供 `penguin browser`：`scan` 输出上限 35,000 字符，`exec` 最多返回 8,000 字符结果，`--save` 可将完整结果落盘。[^31][^32][^33]

`penguin run --json` 仅返回子运行助手文本，CLI 委派产生的工具流量不进入调用方上下文。[^34]

Simon Willison 指出，模型会自行调用 `--help`，CLI 无需前置塞入大量用法说明。[^35]Zechner 的 120 次基准测试显示，设计良好的 MCP 与 CLI 效率无显著差异。[^36]

0.2.16 中，PenguinHarness 每次请求加载全部已发现 MCP schema，无延迟加载机制。[^20][^22][^25]下图对比三种 MCP 设计的固定截距成本与缓存影响。

<figure class="post-figure" data-figure="slope-mcp-designs"> <svg class="fig-svg" viewBox="0 0 560 524" role="img" aria-labelledby="context-slope-slope-mcp-designs-zh-title"> <title id="context-slope-slope-mcp-designs-zh-title">三种 MCP 设计模式的固定截距成本与缓存影响对比图</title> <rect x="8" y="4" width="544" height="164" rx="6" class="fig-box"/> <text x="22" y="28" class="fig-title">PenguinHarness 0.2.16（加载全部定义）</text> <text x="22" y="52" class="fig-note">截距中的工具定义</text> <text x="22" y="70">配置服务器后，所有被发现的 MCP schema 随每次请求发送</text> <text x="22" y="94" class="fig-note">缓存影响</text> <text x="22" y="112">前缀稳定，整个 Trace 过程缓存持续有效</text> <text x="22" y="136" class="fig-note">现有实现</text> <text x="22" y="154">0.2.16 版本已发布</text> <rect x="8" y="180" width="544" height="164" rx="6" class="fig-box"/> <text x="22" y="204" class="fig-title">延迟工具搜索（固定集）</text> <text x="22" y="228" class="fig-note">截距中的工具定义</text> <text x="22" y="246">前置仅加载固定的搜索端点</text> <text x="22" y="270" class="fig-note">缓存影响</text> <text x="22" y="288">前缀稳定，只要活跃工具集保持固定，缓存就不会失效</text> <text x="22" y="312" class="fig-note">现有实现</text> <text x="22" y="330">Claude Code 已发布（截至 2026 年 10 月）</text> <rect x="8" y="356" width="544" height="164" rx="6" class="fig-box"/> <text x="22" y="380" class="fig-title">Code Mode 双工具端点</text> <text x="22" y="404" class="fig-note">截距中的工具定义</text> <text x="22" y="422">两个固定工具：search() 和 execute()</text> <text x="22" y="446" class="fig-note">缓存影响</text> <text x="22" y="464">前缀完全稳定，新增工具不会破坏缓存</text> <text x="22" y="488" class="fig-note">现有实现</text> <text x="22" y="506">Cloudflare 已发布</text> </svg> <ol class="fig-steps"> <li>PenguinHarness 0.2.16（加载全部定义）</li> <li>延迟工具搜索（固定集）</li> <li>Code Mode 双工具端点</li> <li>截距中的工具定义</li> <li>缓存影响</li> <li>现有实现</li> <li>配置服务器后，所有被发现的 MCP schema 随每次请求发送</li> <li>前置仅加载固定的搜索端点</li> <li>两个固定工具：search() 和 execute()</li> <li>前缀稳定，整个 Trace 过程缓存持续有效</li> <li>前缀稳定，只要活跃工具集保持固定，缓存就不会失效</li> <li>前缀完全稳定，新增工具不会破坏缓存</li> <li>0.2.16 版本已发布</li> <li>Claude Code 已发布（截至 2026 年 10 月）</li> <li>Cloudflare 已发布</li> </ol> <figcaption>MCP 的设计选择对固定截距成本影响很大，只要单个上下文内的活跃工具集保持固定，延迟加载或代码执行模式就能在不让提示词缓存失效的前提下压低截距</figcaption> </figure>

按上下文斜率原则，MCP 应在单个上下文内保持固定活跃工具集，用延迟加载或代码执行压低截距，不破坏提示词缓存。[^21][^37][^38]

[^1]: [Effective context engineering for AI agents \ Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
[^2]: [Context windows - Claude Platform Docs](https://platform.claude.com/docs/en/build-with-claude/context-windows)
[^3]: [Context Length Alone Hurts LLM Performance Despite Perfect Retrieval](https://arxiv.org/abs/2510.05381)
[^4]: [Self-Manager: Parallel Agent Loop for Long-form Deep Research](https://arxiv.org/abs/2601.17879)
[^5]: [When Should a Coding Agent Compact? 287k API Calls Measured](https://langwatch.ai/blog/context-tax-when-to-compact)
[^6]: [TraceLab: Characterizing Coding Agent Workloads for LLM Serving](https://arxiv.org/abs/2606.30560)
[^7]: our search of English and Chinese sources for the term, 2026-10-19
[^8]: [Unrolling the Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/)
[^9]: [OpenAI Begins Article Series on Codex CLI Internals - InfoQ](https://www.infoq.com/news/2026/02/codex-agent-loop/)
[^10]: [packages/core/src/llm/context-limits.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/core/src/llm/context-limits.ts)
[^11]: [packages/core/test/prompt-cache-lifecycle.test.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/core/test/prompt-cache-lifecycle.test.ts)
[^12]: our measurement on PenguinHarness 0.2.16 (method in the post)
[^13]: [packages/core/test/helpers/prompt-cache/simulator.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/core/test/helpers/prompt-cache/simulator.ts)
[^14]: [Equipping agents for the real world with Agent Skills \ Anthropic](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
[^15]: [Agent Skills - Claude Platform Docs](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
[^16]: [Build skills | ChatGPT Learn](https://developers.openai.com/codex/skills)
[^17]: [packages/core/src/state/agent-state.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/core/src/state/agent-state.ts)
[^18]: [packages/core/src/state/default-config.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/core/src/state/default-config.ts)
[^19]: [PenguinHarness docs: Skills &amp; Plugins](https://penguin.ooo/docs/skills)
[^20]: [packages/core/src/environment/mcp/](https://github.com/Prism-Shadow/penguin-harness/tree/v0.2.16/packages/core/src/environment/mcp)
[^21]: [PenguinHarness docs: The Agent Loop](https://penguin.ooo/docs/agent-loop)
[^22]: [packages/core/src/environment/environment.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/core/src/environment/environment.ts)
[^23]: [changelog/0.2.6/2026-08-23-tool-output-tail-window.md](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/changelog/0.2.6/2026-08-23-tool-output-tail-window.md)
[^24]: [changelog/0.2.0/2026-07-31-recover-truncated-tool-output.md](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/changelog/0.2.0/2026-07-31-recover-truncated-tool-output.md)
[^25]: [PenguinHarness docs: Tools &amp; Approval](https://penguin.ooo/docs/tools)
[^26]: [anthropics/claude-code: CHANGELOG.md](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md)
[^27]: [Tools reference - Claude Code Docs](https://code.claude.com/docs/en/tools-reference)
[^28]: [Connect Claude Code to tools via MCP - Claude Code Docs](https://code.claude.com/docs/en/mcp)
[^29]: [plugins/browser-automation/package.json](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/plugins/browser-automation/package.json)
[^30]: [packages/core/src/plugins/index.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/core/src/plugins/index.ts)
[^31]: [packages/server/src/builtin-browser/actions.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/server/src/builtin-browser/actions.ts)
[^32]: [packages/cli/src/i18n.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/cli/src/i18n.ts)
[^33]: [packages/cli/src/browser-output.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/cli/src/browser-output.ts)
[^34]: [PenguinHarness docs: CLI Reference](https://penguin.ooo/docs/cli)
[^35]: [Claude Skills are awesome, maybe a bigger deal than MCP](https://simonwillison.net/2025/Oct/16/claude-skills/)
[^36]: [MCP vs CLI: Benchmarking Tools for Coding Agents](https://mariozechner.at/posts/2025-08-15-mcp-vs-cli/)
[^37]: [Introducing advanced tool use on the Claude Developer Platform \ Anthropic](https://www.anthropic.com/engineering/advanced-tool-use)
[^38]: [Context Engineering for AI Agents: Lessons from Building Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
