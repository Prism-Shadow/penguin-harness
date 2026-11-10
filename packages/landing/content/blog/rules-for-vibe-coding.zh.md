---
title: "Vibe Coding 项目写大以后，怎么避免越改越乱"
date: 2026-10-19
category: perspectives
excerpt: "项目模块变多后，改一处常担心牵连旧功能。本文结合 PenguinHarness 的图标复用、命令审批和 Trace 测试，聊聊怎么配合 AI 长期维护代码。"
---

> 本文基于 PenguinHarness 0.2.18 撰写，之后的版本在部分细节上可能有所不同。

做 vibe coding 项目时，加第一个新功能通常很顺畅。等模块多起来，改一个弹窗按钮或调一行日志格式，心里的顾虑就会变多，总担心顺手牵连别处，把原本正常的旧功能改坏。

开发者汉堡在博客里记录过类似经历[^1]。他早期的 AI 博客项目因为功能互相影响、维护困难而放弃，后来转向先明确需求、记录约束并缩小阶段范围。

在聊天窗口里提醒 AI 能解决不少眼前的问题，长期维护则要靠清晰的改动范围、代码里的权限边界和能抓出具体错误的测试。我们结合 PenguinHarness 0.2.18 的几处代码，聊聊这些做法怎么配合起来用。

## 动手前先划清改动范围

光在聊天窗口里临时叮嘱容易漏掉上下文，动手改代码前，可以先用几行字划清这次改什么。记录只需要写清四件事：本次目标、不做的范围、验收方式，以及可能复用的现有实现。加个图标或调整日志行为，对齐这几句就够了，没必要每次都写长篇规格文档。

写任务说明时，先让 Agent 去仓库里搜一遍有没有现成的组件或工具函数。很多时候仓库里已经有写好的模块，Agent 没去查，就会在当前目录下顺手再写一套。

比如你发现界面上有两个长得很像的图标，想让 Agent 排查并收拢，可以直接把下面这段话发给它：

> 任务：排查并统一界面里的重复图标。
> 1. 先在仓库中搜索现有的图标组件和 SVG 定义，列出路径，先不要改代码。
> 2. 说明打算保留哪一处共享实现、修改哪些引用文件，本次不改动图标样式和其他无关组件。
> 3. 给出改完后需要运行的测试命令，确认通过后再提交。

## 规则按模块存放

单次任务的范围划清了，跨任务的长期约定如果全堆进同一个文件，很快也会变得又长又乱。更稳妥的做法是在仓库根部的 `AGENTS.md` 或 `CLAUDE.md` 里只放少量经常要用的约定和详细文档入口。具体模块的业务细节跟着模块目录走，阶段进度则写进当次的任务记录里。

PenguinHarness 的日常开发约定放在 `.agents/skills/penguin-harness-dev/SKILL.md` 里。文件要求使用隔离的 worktree、针对改动跑验证并通过 PR 合并。颜力刚在他的 vibe coding 指南中也提到，全局指令只存放跨任务约束，细节按需读取，能确定检查的规则就转成 lint 或测试[^2]。

规则文件放在仓库里，并不代表每种 Agent 启动时都会自动加载它。开工前可以让 Agent 先报一下本次读取了哪些约定文件，确认它真看到了。对于那些能用程序直接判定的规矩，写进文档之余，还可以放进共享代码和自动测试里。

## 共享图标与源码扫描测试

PenguinHarness 的 `icon-scale.test.ts` 注释里记过一个具体问题[^3]。代表记忆的 `memory brain` 图标曾被手写在三处，重画一处后，另外两处还是旧图。

如果只在文档里写一句「请复用图标」，赶进度时还是很容易再次复制粘贴 SVG 代码。现在 `memory brain` 图标放在共享的 `icons.ts` 里，其他几个已知图标也各自留在指定的共享文件中。`icon-scale.test.ts` 会扫描 `web` 和 `ui` 的源文件。一旦这些已知的 SVG 路径片段出现在指定共享文件之外，测试就会报错。

<figure class="post-figure" data-figure="vibe-rules-icon-check"> <svg class="fig-svg" style="min-width:0" viewBox="0 0 560 332" role="img" aria-labelledby="rules-for-vibe-coding-vibe-rules-icon-check-zh-title"> <title id="rules-for-vibe-coding-vibe-rules-icon-check-zh-title">垂直三步流程图，依次是任务先查现有图标、图标收进共享文件、测试排查外部文件。</title> <defs><marker id="rules-for-vibe-coding-vibe-rules-icon-check-zh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs> <rect x="40" y="12" width="480" height="76" rx="6" class="fig-box"/> <text x="280" y="42" text-anchor="middle" class="fig-label" style="font-size:22px">任务先查现有图标</text> <text x="280" y="67" text-anchor="middle" class="fig-note" style="font-size:18px">改动前搜索仓库已有图标实现</text> <path d="M280 89V124" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-icon-check-zh-arrow)"/> <rect x="40" y="128" width="480" height="76" rx="6" class="fig-box"/> <text x="280" y="158" text-anchor="middle" class="fig-label" style="font-size:22px">图标收进共享文件</text> <text x="280" y="183" text-anchor="middle" class="fig-note" style="font-size:18px">已知 SVG 路径只留在指定文件</text> <path d="M280 205V240" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-icon-check-zh-arrow)"/> <rect x="40" y="244" width="480" height="76" rx="6" class="fig-box"/> <text x="280" y="274" text-anchor="middle" class="fig-label" style="font-size:22px">测试排查外部文件</text> <text x="280" y="299" text-anchor="middle" class="fig-note" style="font-size:18px">出现在指定共享文件外就报错</text> </svg> <ol class="fig-steps"> <li>任务先查现有图标</li> <li>改动前搜索仓库已有图标实现</li> <li>图标收进共享文件</li> <li>已知 SVG 路径只留在指定文件</li> <li>测试排查外部文件</li> <li>出现在指定共享文件外就报错</li> </ol> <figcaption>先引导 Agent 查找共享实现，再用源码扫描测试检查已知图标路径是否出现在指定共享文件之外。</figcaption> </figure>

这套扫描测试只认几个已知的 SVG 路径片段，识别不了所有视觉上相似的新图标。而且只有当一个元素确实在多处复用时，才值得像这样抽成共享代码；只在单个地方用到的逻辑，不必为了未来提前搭一套复杂结构。崔鹏飞在讨论 Harness Engineering 的文章中区分了结果确定的程序检查与依赖判断的模型审查，建议优先用程序检查可确定判定的事项[^4]。像工具执行权限这类高风险边界，更得靠模型外面的代码直接把关。

## 把工具权限写进代码

提示词管不住运行时的实际工具调用，权限边界要写在代码里。在 PenguinHarness 0.2.18 中，每次调用 `Session.run` 时都可以传入 `approve` 审批回调[^5]。如果前置的 `preToolUse` 钩子没有给出明确决定，调用方又没传 `approve` 回调，引擎就会走默认的 `deny` 回调拒绝执行。

同时，`Session.run` 会用 `withCommandPolicy` 把传入的 `approve` 回调包一层[^6]。当 Agent 请求执行命令并命中策略里的否决规则时，`command-policy.ts` 会直接返回 `forbidden`，不再调用宿主的 `approve`。就算 `preToolUse` 钩子给出了放行决定，只要命令命中否决规则，同样会被拦下。

这套命令策略只按已启用的模式匹配 `exec_command` 和 `input_command` 的 shell 文本参数[^7]。它不会先把变量或编码内容展开再判断，也不覆盖 MCP 等其他工具。遇到涉及权限策略、持久化格式和公共接口的改动，不能因为测试绿了就跳过人工检查，人还是得亲自去读 diff，判断边界合不合理。

## 看清测试到底验证了什么

人工读完 diff，还得确认配套的自动测试真能抓出问题。颜力刚在文章里提醒过，让 AI 顺手写的测试，很容易把实现代码里的错误假设原样照抄进断言里。要让测试真正起作用，断言的期望值需要依据明确的需求说明、协议规范或核对过的样本，不能直接照搬实现逻辑。

PenguinHarness 的 Trace（会话记录）模块负责把运行记录存进文件[^8]。`writer.ts` 采用只追加的 JSONL 格式，通过队列把写入与文件轮转排成串行，避免并发追加把单条记录拆碎。

对应的 `trace.test.ts` 会直接读取落盘后的文件内容，检查大小记录并发追加以及文件轮转时会不会拆碎单条记录[^9]。它还会验证短写、零进展失败和残缺尾行恢复等边界情况。

另一个 `trace-bytes.test.ts` 用固定时间构造各类已存储记录，跟仓库里的 `fixtures/trace-bytes.jsonl` 逐字节比对[^10]。它同时检查记录读回后再写出的字节保持一致。这个样本文件由架构迁移前的旧实现生成，用来发现历史字节格式的意外变化，本身并不能当作独立于实现的正确性证明。一旦这类比对测试报错，得先对照格式要求人工核对 diff，千万别盲目更新快照让测试混过去。平时让 Agent 补完测试后，也可以故意改坏一行实现代码，亲眼看到测试变红再恢复回来。

## 老问题复发时怎么排查

验证过单次实现和测试后如果看到 AI 又犯了同一个错，先别急着往全局的 `AGENTS.md` 里再塞一条新规矩。

可以先看当次会话有没有加载对应的规则文件，或者规则写得太含糊、旧的共享实现藏得太深不好找。要是规则本身没问题，再看是不是缺了自动测试，或者某条老规矩已经过期了。找准原因后，只补上最小适用的约定、共享代码和自动检查，同时顺手删掉那些过期或重复的条文。

你现在就可以在自己的项目里找一处散落在几个页面里的重复图标，复制开头那段任务说明发给 Agent。让它先搜出现有实现并收拢到一个共享文件，再补一条能拦住重复手写的测试。

[^1]: [如何从0到1 Vibe Coding 一个项目，并长期维护](https://blog.hejiajun.com/archives/wei-ming-ming-wen-zhang-jKzuXGz7)
[^2]: [Vibe Coding 指南：踩过的坑和给 AI 的自查清单](https://ligangyan.com/zh/blog/vibe-coding-guide/)
[^3]: [packages/web/test/icon-scale.test.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.18/packages/web/test/icon-scale.test.ts)
[^4]: [Harness Engineering：把纪律搬到模型外面](https://cuipengfei.is-a.dev/blog/2026/05/05/harness-engineering-craftsmanship/)
[^5]: [packages/core/src/engine/context-engine.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.18/packages/core/src/engine/context-engine.ts)
[^6]: [packages/core/src/session.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.18/packages/core/src/session.ts)
[^7]: [packages/core/src/internal/command-policy.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.18/packages/core/src/internal/command-policy.ts)
[^8]: [packages/core/src/trace/writer.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.18/packages/core/src/trace/writer.ts)
[^9]: [packages/core/test/trace.test.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.18/packages/core/test/trace.test.ts)
[^10]: [refactor(amsp): protocol types move into @prismshadow/amsp (#1300)](https://github.com/Prism-Shadow/penguin-harness/commit/b576cd8618922633ba7fc6b56cdf85ae1ddf6b20)
