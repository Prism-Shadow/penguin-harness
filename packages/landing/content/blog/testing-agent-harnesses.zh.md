---
title: "用脚本化边界和不变量测试 agent harness"
date: 2026-10-19
category: practice
excerpt: "Agent harness 中的提示词缓存静默回归会在 CI 全绿时上线，不触发功能故障。我们构建了无网确定性 CI 检查，无需调用线上 API 即可捕获这类问题。"
---

> 本文基于 PenguinHarness 0.2.16 撰写，之后的版本在部分细节上可能有所不同。

提示词缓存回归无报错、不改输出，过常规 CI，仅拉高账单。[^1][^2]

文中 Token 计数、比值、成本，由离线模拟器按 Anthropic 公开缓存规则，用录制请求算出。[^3][^4]

套件时长为 2026-10-19 我们测试机实测结果。[^5]

本文讲 PenguinHarness 内置 CI 缓存检查的设计与权衡。

**TL;DR**
- 2026-10-19 跑 33 个缓存测试耗时 1.54 s，无网、无 API 密钥。[^5]
- 回滚 #700（压缩请求改用当前思考等级），2 个测试失败，其成本为原 1.13-10.2 倍。[^5][^6]
- 系统提示加 49 字符句，命中率 88.61% 变 88.62%，不变量仍成立。[^5]

## 没有测试能捕获的静默回归

供应商仅在连续请求从开头逐字节匹配时，才会返回提示词缓存的前缀。[^1][^7][^8]
从最早分歧点开始的内容，会在该次请求中按全价重新计费；后续仍延续前序的请求会继续命中缓存。[^1]

这类回归不会产生任何功能信号。[^1][^2]
不会抛错，UI 输出保持不变，只要修改预期数值，标准 CI 检查就会通过。[^1][^2]
没被抓到的话，这类问题就会上线。[^1]

一次很小的请求组装改动，可能通过所有默认检查，同时拉高单次请求成本。[^1]

<figure class="post-figure" data-figure="harness-ci-silent-regression"> <svg class="fig-svg" viewBox="0 0 560 324" role="img" aria-labelledby="testing-agent-harnesses-harness-ci-silent-regression-zh-title"> <title id="testing-agent-harnesses-harness-ci-silent-regression-zh-title">从请求组装的小代码改动到前缀偏移的流程，展示无用户可见故障，但偏移字节丢失缓存匹配导致成本上升。</title> <rect x="206.1" y="8" width="147.9" height="32" rx="6" class="fig-terminal"/> <text x="280" y="28.2" class="fig-label" text-anchor="middle">请求组装的小代码改动</text> <path d="M280 40V59" class="fig-edge"/> <text x="280" y="64" class="fig-note" text-anchor="middle" dominant-baseline="central" transform="translate(280 64) rotate(90) scale(1.5) translate(-280 -64)">→</text> <rect x="188.1" y="72" width="183.9" height="32" rx="6" class="fig-box"/> <text x="280" y="92.2" class="fig-label" text-anchor="middle">请求前缀与历史请求发生偏移</text> <path d="M280 104V116M152.2 116H392" class="fig-edge"/> <path d="M152.2 116V131" class="fig-edge"/> <text x="152.2" y="136" class="fig-note" text-anchor="middle" dominant-baseline="central" transform="translate(152.2 136) rotate(90) scale(1.5) translate(-152.2 -136)">→</text> <path d="M264.3 116V131" class="fig-edge"/> <text x="264.3" y="136" class="fig-note" text-anchor="middle" dominant-baseline="central" transform="translate(264.3 136) rotate(90) scale(1.5) translate(-264.2 -136)">→</text> <path d="M392 116V131" class="fig-edge"/> <text x="392" y="136" class="fig-note" text-anchor="middle" dominant-baseline="central" transform="translate(392 136) rotate(90) scale(1.5) translate(-392 -136)">→</text> <rect x="108.2" y="144" width="88" height="32" rx="6" class="fig-box"/> <text x="152.2" y="164.2" class="fig-label" text-anchor="middle">无抛出错误</text> <rect x="212.2" y="144" width="104.1" height="32" rx="6" class="fig-box"/> <text x="264.3" y="164.2" class="fig-label" text-anchor="middle">UI 输出无变化</text> <rect x="332.3" y="144" width="119.5" height="32" rx="6" class="fig-box"/> <text x="392" y="164.2" class="fig-label" text-anchor="middle">标准 CI 检查通过</text> <path d="M152.2 176V188M264.3 176V188M392 176V188M152.2 188H392" class="fig-edge"/> <path d="M280 188V207" class="fig-edge"/> <text x="280" y="212" class="fig-note" text-anchor="middle" dominant-baseline="central" transform="translate(280 212) rotate(90) scale(1.5) translate(-280 -212)">→</text> <rect x="161.2" y="220" width="237.6" height="32" rx="6" class="fig-box"/> <text x="280" y="240.2" class="fig-label" text-anchor="middle">偏移的前缀 Token 按缓存写入费率计费</text> <path d="M280 252V271" class="fig-edge"/> <text x="280" y="276" class="fig-note" text-anchor="middle" dominant-baseline="central" transform="translate(280 276) rotate(90) scale(1.5) translate(-280 -276)">→</text> <rect x="212.1" y="284" width="135.9" height="32" rx="6" class="fig-terminal"/> <text x="280" y="304.2" class="fig-label" text-anchor="middle">单请求输入成本上升</text> </svg> <ol class="fig-steps"> <li>请求组装的小代码改动</li> <li>→</li> <li>请求前缀与历史请求发生偏移</li> <li>无抛出错误</li> <li>UI 输出无变化</li> <li>标准 CI 检查通过</li> <li>→</li> <li>偏移的前缀 Token 按缓存写入费率计费</li> <li>→</li> <li>单请求输入成本上升</li> </ol> <figcaption>请求组装的小改动引发的提示词缓存偏移，在默认检查下不会产生界面或测试失败信号，却会让不再匹配缓存前缀的字节带来成本上涨。</figcaption> </figure>

## 我们守住的不变量
我们的检查只守一条不变量。同一个会话上下文里，每个后续请求都必须完整读回上一个请求的全部前缀。[^9]

模拟器按固定顺序的层级块列表计算缓存命中。[^3]靠前的块一旦出现字节分歧，直到 harness 发送的唯一自动断点为止，后续块都无法计入缓存读取量。[^3][^7]

这些块从模型 ID 开始，按固定顺序逐层排列，依次经过工具定义、快速模式参数、系统提示、请求参数、对话消息，直到断点位置，顺序见下图。

<figure class="post-figure" data-figure="harness-ci-request-tiers"> <svg class="fig-svg" viewBox="0 0 560 132" role="img" aria-labelledby="testing-agent-harnesses-harness-ci-request-tiers-zh-title"> <title id="testing-agent-harnesses-harness-ci-request-tiers-zh-title">从左到右排列的供应商请求块，从模型 ID 开始经对话消息到供应商缓存断点，方括号标记用于缓存匹配的字节范围。</title> <path d="M16 40V34H526V40M271 34V28" class="fig-bracket"/> <text x="271" y="20" class="fig-label" text-anchor="middle">缓存匹配的字节范围</text> <rect x="16" y="46" width="81.7" height="30" rx="4" class="fig-terminal"/> <rect x="101.7" y="46" width="81.7" height="30" rx="4" class="fig-terminal"/> <rect x="187.3" y="46" width="81.7" height="30" rx="4" class="fig-terminal"/> <rect x="273" y="46" width="81.7" height="30" rx="4" class="fig-terminal"/> <rect x="358.7" y="46" width="81.7" height="30" rx="4" class="fig-terminal"/> <rect x="444.3" y="46" width="81.7" height="30" rx="4" class="fig-terminal"/> <rect x="528" y="22" width="2" height="58" rx="0" class="fig-marker"/> <path d="M524 16H534L529 23Z" class="fig-marker"/> <path d="M56.8 76V87" class="fig-axis"/> <text x="56.8" y="100" class="fig-label" text-anchor="middle">模型 ID</text> <path d="M142.5 76V109" class="fig-axis"/> <text x="142.5" y="122" class="fig-label" text-anchor="middle">工具定义</text> <path d="M228.2 76V87" class="fig-axis"/> <text x="228.2" y="100" class="fig-label" text-anchor="middle">快速模式参数</text> <path d="M313.8 76V109" class="fig-axis"/> <text x="313.8" y="122" class="fig-label" text-anchor="middle">系统提示</text> <path d="M399.5 76V87" class="fig-axis"/> <text x="399.5" y="100" class="fig-label" text-anchor="middle">请求参数</text> <path d="M485.2 76V109" class="fig-axis"/> <text x="485.2" y="122" class="fig-label" text-anchor="middle">对话消息</text> <text x="522" y="20" class="fig-label" text-anchor="end">供应商缓存断点</text> </svg> <ol class="fig-steps"> <li>模型 ID</li> <li>工具定义</li> <li>快速模式参数</li> <li>系统提示</li> <li>请求参数</li> <li>对话消息</li> <li>供应商缓存断点</li> <li>缓存匹配的字节范围</li> </ol> <figcaption>模拟器的有序缓存键栈中，靠前块的分歧会让从分歧点到 harness 发送的唯一自动断点之间的内容全部无法命中缓存。</figcaption> </figure>

## 端到端测试流水线
我们运行未修改的 Session、ContextEngine 与 GenerativeModel 生产代码。[^10]

我们只替换最外层供应商流，录制客户端待发字节。[^11]

脚本化供应商流统一返回 0 缓存读取 Token，不预设缓存命中，实际命中量交由离线模拟器计算。[^11]

录制字节分两路，一路定位最早分歧点，一路按 Anthropic 公开缓存规则计算预期读取量。[^3][^12]

下图展示流水线。

<figure class="post-figure" data-figure="harness-ci-pipeline"> <svg class="fig-svg" viewBox="0 0 560 388" role="img" aria-labelledby="testing-agent-harnesses-harness-ci-pipeline-zh-title"> <title id="testing-agent-harnesses-harness-ci-pipeline-zh-title">从上到下的流程，从未修改的生产 Session 代码出发，经脚本化供应商流得到录制的线形态请求字节，分流到字节诊断模块与缓存规则模拟器，汇合后执行带命名豁免清单的不变量检查，最终输出失败报告。</title> <rect x="104.3" y="8" width="351.4" height="32" rx="6" class="fig-terminal"/> <text x="280" y="28.2" class="fig-label" text-anchor="middle">未修改的 Session + ContextEngine + GenerativeModel</text> <path d="M280 40V59" class="fig-edge"/> <text x="280" y="64" class="fig-note" text-anchor="middle" dominant-baseline="central" transform="translate(280 64) rotate(90) scale(1.5) translate(-280 -64)">→</text> <rect x="128.4" y="72" width="303.3" height="32" rx="6" class="fig-box"/> <text x="280" y="92.2" class="fig-label" text-anchor="middle">脚本化供应商流（无网络，脚本返回缓存读取为 0）</text> <path d="M280 104V123" class="fig-edge"/> <text x="280" y="128" class="fig-note" text-anchor="middle" dominant-baseline="central" transform="translate(280 128) rotate(90) scale(1.5) translate(-280 -128)">→</text> <rect x="140.1" y="136" width="279.8" height="32" rx="6" class="fig-box"/> <text x="280" y="156.2" class="fig-label" text-anchor="middle">录制的线形态字节（客户端实际会发出的请求）</text> <path d="M280 168V180M166.1 180H382" class="fig-edge"/> <path d="M166.1 180V195" class="fig-edge"/> <text x="166.1" y="200" class="fig-note" text-anchor="middle" dominant-baseline="central" transform="translate(166.1 200) rotate(90) scale(1.5) translate(-166 -200)">→</text> <path d="M382 180V195" class="fig-edge"/> <text x="382" y="200" class="fig-note" text-anchor="middle" dominant-baseline="central" transform="translate(382 200) rotate(90) scale(1.5) translate(-381.9 -200)">→</text> <rect x="74.1" y="208" width="183.9" height="32" rx="6" class="fig-box"/> <text x="166.1" y="228.2" class="fig-label" text-anchor="middle">字节诊断（定位最早分歧点）</text> <rect x="278" y="208" width="207.9" height="32" rx="6" class="fig-box"/> <text x="382" y="228.2" class="fig-label" text-anchor="middle">缓存规则模拟器（计算用量指标）</text> <path d="M166.1 240V252M382 240V252M166.1 252H382" class="fig-edge"/> <path d="M280 252V271" class="fig-edge"/> <text x="280" y="276" class="fig-note" text-anchor="middle" dominant-baseline="central" transform="translate(280 276) rotate(90) scale(1.5) translate(-280 -276)">→</text> <rect x="122.1" y="284" width="315.8" height="32" rx="6" class="fig-box"/> <text x="280" y="304.2" class="fig-label" text-anchor="middle">不变量检查：完整前缀读回，仅允许命名豁免清单条目</text> <path d="M280 316V335" class="fig-edge"/> <text x="280" y="340" class="fig-note" text-anchor="middle" dominant-baseline="central" transform="translate(280 340) rotate(90) scale(1.5) translate(-280 -340)">→</text> <rect x="145.1" y="348" width="269.9" height="32" rx="6" class="fig-terminal"/> <text x="280" y="368.2" class="fig-label" text-anchor="middle">失败报告：请求序号、分歧层级、Token 缺口</text> </svg> <ol class="fig-steps"> <li>未修改的 Session + ContextEngine + GenerativeModel</li> <li>→</li> <li>脚本化供应商流（无网络，脚本返回缓存读取为 0）</li> <li>→</li> <li>录制的线形态字节（客户端实际会发出的请求）</li> <li>字节诊断（定位最早分歧点）</li> <li>缓存规则模拟器（计算用量指标）</li> <li>→</li> <li>不变量检查：完整前缀读回，仅允许命名豁免清单条目</li> <li>→</li> <li>失败报告：请求序号、分歧层级、Token 缺口</li> </ol> <figcaption>测试运行未修改的生产请求组装代码，仅替换供应商网络流，检查覆盖客户端实际发出的完整请求载荷。</figcaption> </figure>

检查失败时，输出给出请求序号、分歧层级与 Token 缺口。[^3]

## 只伪造边界，不替换系统
最直观的缓存测试方案是直接调用线上供应商 API。

无缓存诊断时，只能看到 `cache_read_input_tokens` 掉到 0，找不到根因。[^2]CI 测试任务无 API 密钥，这类调用无法执行。[^13]

我们用 core 里的脚本化 MMSP 客户端。harness 生产代码一行不改，只替换最外层网络流。[^11][^14]录制内容直接保存线上传输的精确字节，不做内存对象转换。[^11]

CI 选中 core 时，套件在 Linux、macOS、Windows 运行。[^13][^15][^16]开发技能将请求组装改动路由到该检查。[^1]2026-10-19 测试机跑用例耗时 1.54 s，无网络。[^5]代价是模拟器只复现公开规则，无法确认线上实际行为。[^4]

下图对比两种方案约束。

<figure class="post-figure" data-figure="harness-ci-obvious-designs"> <svg class="fig-svg" viewBox="0 0 560 272" role="img" aria-labelledby="testing-agent-harnesses-harness-ci-obvious-designs-zh-title"> <title id="testing-agent-harnesses-harness-ci-obvious-designs-zh-title">上下排列的两个面板，对比线上 API 测试调用与我们选用的脚本化的供应商流方案，分别列出两种方式的测试特性。</title> <rect x="16" y="8" width="528" height="110" rx="8" class="fig-link"/> <text x="32" y="32" class="fig-title">未采用：线上 API 调用</text> <text x="32" y="58">需要 API 密钥 + 网络访问</text> <text x="32" y="80">缓存未命中时无法定位改动点</text> <text x="32" y="102">无法在无凭证的 CI 测试任务中运行</text> <rect x="16" y="130" width="528" height="110" rx="8" class="fig-box"/> <text x="32" y="154" class="fig-title">采用：脚本化的供应商流</text> <text x="32" y="180">无需密钥，无网络调用</text> <text x="32" y="202">进程内重复运行生成字节完全一致的请求</text> <text x="32" y="224">记录精确的线上传输字节，用于根因诊断</text> <text x="280" y="262" class="fig-note" text-anchor="middle">离线建模已公开的缓存规则；不验证线上部署行为</text> </svg> <ol class="fig-steps"> <li>未采用：线上 API 调用</li> <li>需要 API 密钥 + 网络访问</li> <li>缓存未命中时无法定位改动点</li> <li>无法在无凭证的 CI 测试任务中运行</li> <li>采用：脚本化的供应商流</li> <li>无需密钥，无网络调用</li> <li>进程内重复运行生成字节完全一致的请求</li> <li>记录精确的线上传输字节，用于根因诊断</li> <li>离线建模已公开的缓存规则；不验证线上部署行为</li> </ol> <figcaption>线上 API 调用需要密钥和网络，出现缓存未命中时无法定位根因；脚本化的供应商流方案无需密钥，进程内重复运行可得到字节完全一致的请求，还能记录精确传输字节用于根因诊断，代价是离线模拟供应商规则，无法验证线上部署的实际行为。</figcaption> </figure>

仅靠字节相等，无法预判供应商缓存行为。

## 单靠字节无法判定缓存行为
仅字节校验无法判定缓存行为。

两次请求空闲超过默认 5 分钟缓存 TTL 时，就算和前序请求逐字节匹配，模拟器仍判定为缓存未命中，返回 0 个缓存读取 Token，预计产生 2041 个缓存写入 Token。[^3][^5][^7]

调整思考等级时，工具定义和系统提示字节不变。harness 发送唯一自动断点时，模拟器算出 0 个读回 Token，预计写入 1719 个 Token。若在工具和系统提示后加断点（模拟器测算的假设场景），可读回 1656 个 Token 前缀。[^3][^5][^7]

离线模拟器套用供应商公开缓存规则区分场景，输出标准用量字段。[^3]

<figure class="post-figure" data-figure="harness-ci-bytes-vs-simulator"> <svg class="fig-svg" viewBox="0 0 560 272" role="img" aria-labelledby="testing-agent-harnesses-harness-ci-bytes-vs-simulator-zh-title"> <title id="testing-agent-harnesses-harness-ci-bytes-vs-simulator-zh-title">上下两栏展示同一个参数变化分别由仅字节校验、字节加规则模拟器组合校验得到的结果，附带每个结果的估算 Token 数。</title> <rect x="16" y="8" width="528" height="110" rx="8" class="fig-link"/> <text x="32" y="32" class="fig-title">未采用：仅字节校验</text> <text x="32" y="58">标记偏移：parameters_changed [output_config]</text> <text x="32" y="80">无 Token 或缓存行为信号</text> <rect x="16" y="130" width="528" height="110" rx="8" class="fig-box"/> <text x="32" y="154" class="fig-title">采用：字节 + 规则模拟器</text> <text x="32" y="180">标记偏移：parameters_changed [output_config]</text> <text x="32" y="202">harness 发送的唯一自动断点：0 个读取 Token（估算），1719 个写入 Token（估算）</text> <text x="32" y="224">工具与系统后加断点（模拟器测算的假设场景）：1656 个读取 Token（估算）</text> <text x="280" y="262" class="fig-note" text-anchor="middle">同一个字节变化，对应不同的估算 Token 数</text> </svg> <ol class="fig-steps"> <li>未采用：仅字节校验</li> <li>标记偏移：parameters_changed [output_config]</li> <li>无 Token 或缓存行为信号</li> <li>采用：字节 + 规则模拟器</li> <li>标记偏移：parameters_changed [output_config]</li> <li>harness 发送的唯一自动断点：0 个读取 Token（估算），1719 个写入 Token（估算）</li> <li>工具与系统后加断点（模拟器测算的假设场景）：1656 个读取 Token（估算）</li> <li>同一个字节变化，对应不同的估算 Token 数</li> </ol> <figcaption>仅字节校验和组合校验一样能标记出 parameters_changed 偏移，但无法算出 harness 当前发送的唯一自动断点会带来 0 个估算缓存读取 Token、1719 个估算缓存写入 Token，而在工具与系统提示后显式加断点（模拟器测算的假设场景）可以保留 1656 个估算缓存读取 Token。</figcaption> </figure>

这些计数结果需要明确的断言规则。

## 断言不变量，不钉死数字

钉死单次请求的精确 Token 计数，是最直观的断言方式，也最脆弱。

一处无害的 49 字符系统提示改动，会让 20 个单请求 Token 计数中的 10 个偏移，前缀仍完整，缓存命中率几乎无变化。[^5]

<figure class="post-figure" data-figure="harness-ci-pinned-vs-invariant"> <svg class="fig-svg" viewBox="0 0 560 272" role="img" aria-labelledby="testing-agent-harnesses-harness-ci-pinned-vs-invariant-zh-title"> <title id="testing-agent-harnesses-harness-ci-pinned-vs-invariant-zh-title">上下两栏展示对系统提示做 49 字符的无害编辑后的测试结果，对比固定精确 Token 计数和结构不变量检查的表现。</title> <rect x="16" y="8" width="528" height="110" rx="8" class="fig-link"/> <text x="32" y="32" class="fig-title">未采用：固定精确 Token 计数</text> <text x="32" y="58">编辑改变了 20 个单请求 Token 计数中的 10 个</text> <text x="32" y="80">测试结果：失败</text> <text x="32" y="102">模拟命中率变化：88.61% → 88.62%</text> <rect x="16" y="130" width="528" height="110" rx="8" class="fig-box"/> <text x="32" y="154" class="fig-title">采用：结构不变量 + 豁免清单</text> <text x="32" y="180">编辑保留了完整前缀回读性质</text> <text x="32" y="202">测试结果：通过</text> <text x="32" y="224">模拟命中率变化：88.61% → 88.62%</text> <text x="280" y="262" class="fig-note" text-anchor="middle">同一个编辑，无实际估算成本变化</text> </svg> <ol class="fig-steps"> <li>未采用：固定精确 Token 计数</li> <li>编辑改变了 20 个单请求 Token 计数中的 10 个</li> <li>测试结果：失败</li> <li>模拟命中率变化：88.61% → 88.62%</li> <li>采用：结构不变量 + 豁免清单</li> <li>编辑保留了完整前缀回读性质</li> <li>测试结果：通过</li> <li>模拟命中率变化：88.61% → 88.62%</li> <li>同一个编辑，无实际估算成本变化</li> </ol> <figcaption>固定精确 Token 计数会在 49 字符的无害系统提示编辑上失败，这类编辑对模拟缓存行为几乎没有影响；结构不变量检查会通过，因为前缀匹配规则仍然成立。</figcaption> </figure>

我们只断言完整前缀回读这条不变量。思考等级调整、重开上下文、切换模型等预期内的缓存未命中，归入豁免清单。[^4][^9][^17]

豁免条目对应场景若后续恢复缓存命中，检查直接判失败，避免过期条目削弱效力。[^9]

失败报告会标明请求序号、分歧层级和 Token 缺口，改出问题的 Agent 可直接读懂原因。[^1][^3][^12]

这套断言只标出问题，不替人做决策。

## 绝不改基线到变绿
测试失败时，改基线凑通过很容易。我们从不这么做。[^1]

2026-09-14 合并的 #700 让压缩请求改用 Session 当前思考等级。此前压缩请求为保护提示词缓存，刻意沿用上下文初始等级，用户调等级后，它是唯一前缀对不上的请求。缓存测试套件次日合入，由这次修复触发。[^6][^18][^19]

刻意回滚 #700 会触发两个核心测试失败：不变量套件的思考等级调整用例、#700 改断言的引擎测试，其余测试全过。[^5][^6]

按 claude-sonnet-4-6 目录价计算，回滚 #700 后，调等级后间隔 1 个任务触发压缩的估算成本为合入版本的 1.13 倍，间隔 5 个任务时为 10.2 倍。[^5]

<figure class="post-figure" data-figure="harness-ci-revert-cost"> <svg class="fig-svg" viewBox="0 0 560 416" role="img" aria-labelledby="testing-agent-harnesses-harness-ci-revert-cost-zh-title"> <title id="testing-agent-harnesses-harness-ci-revert-cost-zh-title">上下两栏对比接受 #700 思考等级偏移（改基线到变绿）与被不变量检查捕获两种场景的测试结果，以及调整等级到压缩间隔不同任务数时的压缩请求估算成本。</title> <rect x="16" y="9" width="12" height="10" rx="2" class="fig-s3"/> <text x="34" y="18" class="fig-label">改基线后的偏移版本</text> <rect x="165.9" y="9" width="12" height="10" rx="2" class="fig-s1"/> <text x="183.9" y="18" class="fig-label">合入版本行为</text> <rect x="16" y="30" width="528" height="158" rx="8" class="fig-link"/> <text x="32" y="54" class="fig-title">未采用：改基线到变绿</text> <text x="32" y="76">测试结果：通过</text> <text x="32" y="98">间隔 1 个任务：压缩成本 $0.000753（估算，1.13× 合入版本）</text> <path d="M32 106H65.7A3 3 0 0 1 68.7 109V113A3 3 0 0 1 65.7 116H32Z" class="fig-s3"/> <text x="32" y="136">间隔 5 个任务：压缩成本 $0.008715（估算，10.2× 合入版本）</text> <path d="M32 144H454.3A3 3 0 0 1 457.3 147V151A3 3 0 0 1 454.3 154H32Z" class="fig-s3"/> <text x="32" y="176">成本变化被隐藏</text> <rect x="16" y="200" width="528" height="158" rx="8" class="fig-box"/> <text x="32" y="224" class="fig-title">采用：明确失败，升级处理</text> <text x="32" y="246">测试结果：失败</text> <text x="32" y="268">间隔 1 个任务：压缩成本 $0.0006657（估算）</text> <path d="M32 276H61.5A3 3 0 0 1 64.5 279V283A3 3 0 0 1 61.5 286H32Z" class="fig-s1"/> <text x="32" y="306">间隔 5 个任务：压缩成本 $0.000858（估算）</text> <path d="M32 314H70.9A3 3 0 0 1 73.9 317V321A3 3 0 0 1 70.9 324H32Z" class="fig-s1"/> <text x="32" y="346">展示分歧层级与成本估算，供人工决策</text> <path d="M32 370H520M32 370V375M129.6 370V375M227.2 370V375M324.8 370V375M422.4 370V375M520 370V375" class="fig-axis"/> <text x="32" y="388" class="fig-tick" text-anchor="middle">$0</text> <text x="129.6" y="388" class="fig-tick" text-anchor="middle">$0.002</text> <text x="227.2" y="388" class="fig-tick" text-anchor="middle">$0.004</text> <text x="324.8" y="388" class="fig-tick" text-anchor="middle">$0.006</text> <text x="422.4" y="388" class="fig-tick" text-anchor="middle">$0.008</text> <text x="520" y="388" class="fig-tick" text-anchor="middle">$0.010</text> <text x="276" y="408" class="fig-label" text-anchor="middle">压缩请求成本（USD，估算值）</text> </svg> <ol class="fig-steps"> <li>未采用：改基线到变绿</li> <li>测试结果：通过</li> <li>间隔 1 个任务：压缩成本 $0.000753（估算，1.13× 合入版本）</li> <li>间隔 5 个任务：压缩成本 $0.008715（估算，10.2× 合入版本）</li> <li>成本变化被隐藏</li> <li>采用：明确失败，升级处理</li> <li>测试结果：失败</li> <li>间隔 1 个任务：压缩成本 $0.0006657（估算）</li> <li>间隔 5 个任务：压缩成本 $0.000858（估算）</li> <li>展示分歧层级与成本估算，供人工决策</li> <li>压缩请求成本（USD，估算值）</li> <li>改基线后的偏移版本</li> <li>合入版本行为</li> </ol> <figcaption>改基线接受 #700 偏移会掩盖压缩成本上涨（以下成本均为模拟器按 claude-sonnet-4-6 目录价估算）：间隔 1 个任务时为合入版本的 1.13 倍（合入版本 $0.0006657，回滚版本 $0.000753），间隔 5 个任务时为 10.2 倍（合入版本 $0.000858，回滚版本 $0.008715）；我们的方案会直接判失败，标出分歧层级供人工决策。</figcaption> </figure>

数字一旦变了，就连同分歧层级和成本估算交人决策，不改基线。[^1]

## 运行测试套件
你可以在仓库根目录执行 `pnpm --filter @prismshadow/penguin-core exec vitest run prompt-cache`，运行这套提示词缓存相关测试。[^5]
这套测试对应的设计约定，可查阅公开的 Agent 循环文档 <https://penguin.ooo/docs/agent-loop>。[^20][^21]

[^1]: [.agents/skills/penguin-harness-dev/SKILL.md](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/.agents/skills/penguin-harness-dev/SKILL.md)
[^2]: [Cache diagnostics - Claude Platform Docs](https://platform.claude.com/docs/en/build-with-claude/cache-diagnostics)
[^3]: [packages/core/test/helpers/prompt-cache/simulator.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/core/test/helpers/prompt-cache/simulator.ts)
[^4]: [.agents/skills/penguin-harness-dev/reference/verification.md](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/.agents/skills/penguin-harness-dev/reference/verification.md)
[^5]: our measurement on PenguinHarness 0.2.16 (method in the post)
[^6]: [PR #700: A compaction request runs at the Session's thinking level](https://github.com/Prism-Shadow/penguin-harness/pull/700)
[^7]: [Prompt caching - Claude Platform Docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
[^8]: [Prompt caching | OpenAI API](https://developers.openai.com/api/docs/guides/prompt-caching)
[^9]: [packages/core/test/helpers/prompt-cache/fixtures.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/core/test/helpers/prompt-cache/fixtures.ts)
[^10]: [packages/core/test/helpers/prompt-cache/index.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/core/test/helpers/prompt-cache/index.ts)
[^11]: [packages/core/test/helpers/prompt-cache/recording.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/core/test/helpers/prompt-cache/recording.ts)
[^12]: [packages/core/test/helpers/prompt-cache/diagnostics.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/core/test/helpers/prompt-cache/diagnostics.ts)
[^13]: [.github/workflows/ci.yml](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/.github/workflows/ci.yml)
[^14]: [.agents/skills/penguin-harness-dev/reference/testing.md](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/.agents/skills/penguin-harness-dev/reference/testing.md)
[^15]: [scripts/ci-plan.mjs](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/scripts/ci-plan.mjs)
[^16]: [packages/core/package.json](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/core/package.json)
[^17]: [packages/core/test/prompt-cache-lifecycle.test.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/core/test/prompt-cache-lifecycle.test.ts)
[^18]: [changelog/0.2.13/2026-09-11-compaction-thinking-level.md](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/changelog/0.2.13/2026-09-11-compaction-thinking-level.md)
[^19]: [PR #722: test(core): the prompt cache — assembly invariants, an Anthropic-rule simulator, and the Session lifecycle](https://github.com/Prism-Shadow/penguin-harness/pull/722)
[^20]: [packages/core/test/helpers/prompt-cache/](https://github.com/Prism-Shadow/penguin-harness/tree/v0.2.16/packages/core/test/helpers/prompt-cache)
[^21]: [PenguinHarness docs: The Agent Loop](https://penguin.ooo/docs/agent-loop)
