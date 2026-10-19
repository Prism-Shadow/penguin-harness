# Profile: technical posts

Loaded for `--profile blog-practice` (blog category `practice`): an engineering story about
something the team built, why it was built that way and what was measured. The `prompt` block is
sent to the model as `{{PROFILE}}` after the style guide; the `prompt zh` block replaces it for
Chinese text. `## Notes` is for agents and `## Check settings` is read by `prose.mjs check`;
neither is sent.

<!-- prompt -->
This is a technical post: one engineering story about something the PenguinHarness team built, why it was built that way, and what was measured. It is not a release note, a news item, or a tutorial that walks the reader through clicks. The reader is a developer who builds or runs agent systems and has ten minutes; they came for the mechanism and the measurement. The rules below add to the style guide, and a rule that overrides it says so.

Length: few words, many figures. Keep to the word budget this call gives; without one, 800 to 1,200 English words of body, not counting figure blocks. Explain why the system exists and the principle it works on. Leave out every parameter, option and rule the reader does not need to see the idea, and link the reference docs for them (a URL from FACTS). Wherever a figure can say it, the figure replaces the paragraph: each section is a figure with a few sentences around it.

Shape: choose one of the two shapes below and keep its order. The outline names the shape it uses in the first line under `# Sections`. Either shape has 6 to 9 `## ` sections; the lead and a TL;DR are not sections.

Shape A, a change story (a measurement showed a problem, and the work changed how something behaves):

| Section | Its job | English words |
| --- | --- | --- |
| Lead, no heading | What the team cares about and the stakes in the reader's own work, ending on one sentence that states the post's scope | 50–80 |
| TL;DR, optional | Three or four headline findings, each with its number | 30–60 |
| Background | The existing system the reader must hold in mind, and the property the new work has to keep; one diagram | 80–150 |
| The obvious plan | The constraint, and the natural answer to it; let it look right | 60–120 |
| The turn | The measurement that broke the plan, against a baseline; then one operation taken apart with real units, down to a root cause stated in one sentence | 120–200 |
| The redesign | The idea in one sentence, then the mechanism; what it costs and what it buys | 150–250 |
| Making it real | The hard part of the redesign: the naive implementation and the exact reason it fails | 120–200 |
| Results | The turn's chart again on the same layout: the new system against the naive baseline and the previous system; the headline number in prose with both endpoints | 60–120 |
| Close | Where to get it: the version and the docs link, in one or two sentences | 20–40 |

When nothing shipped and failed, the turn holds the problem measured on the current system, such as the regression that started the work. In every post a measured problem comes before its fix, and the fix's cost is named.

Shape B, a system or tool we built (a test harness, a diagnostic, a pipeline):

1. Why it had to exist, with the stakes measured, carried by one figure (80–150 words).
2. The principle and the framework it works on, in one or two diagrams, without a walk through its parameters or rules (120–200 words, one or two sections).
3. Three or four comparisons, one section per design choice: the design not taken against the one taken, as a mirror pair showing the same metric for both, with a sentence on why not the first and why the second. A real regression the system caught is one of them (100–180 words each).
4. A close with the command that runs it and the docs link, in place of a "how to use" section (20–40 words).

The lead (50–80 words, ending on the scope sentence) and the optional TL;DR are as in shape A.

TL;DR: only when the outline asks for one and FACTS holds at least three headline numbers. Right after the lead, a line `**TL;DR**` (the one bold this profile allows beyond the style guide's own cases), then three or four bullets, one finding and its number each.

How a section moves:
- Every section ends by moving the story on: with a result, a question the next section answers, or a new constraint. No section ends on a recap.
- The prose introduces a claim, and a figure confirms it right after.
- The idea comes in one sentence before its mechanism.
- A before and an after share one layout, so the difference is the only thing that changes.

Not in the shape: a dek or subtitle line; an "In this post we will…" agenda (the lead's last sentence is the scope); "Introduction", "Overview" or "Conclusion" headings; a closing recap; a walk through every parameter, option or rule; acknowledgements; TODOs, a roadmap, "what's next" or open recommendations. The post reports what exists.

Numbers:
- Every number carries its unit.
- Use a measured number only when FACTS gives its unit, what it is compared against and how it was measured. A number FACTS holds without these is left out: the outline lists it under "Missing facts", the post gets an `<!-- omitted: … -->` line.
- Every ratio or "N times" appears with both endpoints at least once, in the same sentence or in the figure that sentence introduces. Use a ratio only when FACTS states it; never compute one.
- The baseline is the naive design or the previous system, as FACTS gives it, never a design nobody would ship.
- One method sentence says how the numbers were produced: the count, the machine and version, and whether they come from a simulator or a recording or from a live provider. It sits in the first paragraph of the first section that argues from a measured number (Results in shape A, the first comparison in shape B), or in the lead if the lead already quotes one. When the numbers are not live, that sentence says so there, not in a later aside.
- A relative word ("faster", "most", "over 6×") agrees with the numbers it summarizes and with the figure it points to.

Figures:
- A technical post is drawn. Plan at least one diagram of the mechanism, and a chart for each measurement the post argues from. A table alone is not a figure.
- One figure per idea the reader must hold, right after the paragraph that introduces it.
- Bolder than boxes and arrows is welcome when it explains more: a request drawn as a strip coloured by state, a timeline with real units, an annotated chart, a before/after split. Every mark encodes a state, a quantity or a step. The legend names each state, and a state keeps the same name in every figure of the post.
- A chart plots FACTS numbers only, and the outline names the FACTS id of every value it plots. A comparison without measured numbers is drawn as states or a flow, never as a chart.
- Mirror pairs: the before and the after (or the design not taken and the one taken) share one layout, one scale and the same labels. Their `text:` strings are the same, in the same order, except the values and the one label that names the variant. A pair may be one figure with two panels, and then it counts as one figure.
- A caption states the finding with its numbers and both endpoints. A caption that only names the picture ("Benchmark results", "Architecture overview") is wrong.
- Exact numbers a reader will look up go in a Markdown table; a comparison the reader should see at a glance goes in a chart. Never both for the same numbers. The headline number also goes in prose.

Voice:
- "We" is the team. "You" appears only in the close, or where the reader's own setup is meant.
- Past tense for what happened, present tense for how it works.
- Gloss a term at its first use, in parentheses or in the sentence before.
- At most one analogy per hard idea, and it must be technically true.
- Long explanatory sentences, with a short one where a result lands.
- Humour only about the work, never about readers or other projects.
- Headings in sentence case, each saying what happens in its section; a play on words is fine.
- One rhetorical question at most in the whole post, as the turn: it ends the section before the turn, and the next section answers it. Apart from it, no section opens or ends on a question, and the post never does.
<!-- /prompt -->

<!-- prompt zh -->
这是一篇技术文章：讲 PenguinHarness 团队做出的一样东西，为什么这样做，测到了什么。它不是发布说明，不是新闻，也不是带读者一步步点界面的教程。读者是搭建或运行 Agent 系统的开发者，有十分钟，想看的是机制和测量结果。下面的规则是对文风指南的补充，凡是覆盖指南的条目都会写明。

篇幅：字少图多。遵守本次调用给出的字数预算；没有给出时，正文控制在英文 800 到 1,200 词的篇幅，图块不计。讲清这套系统为什么存在、按什么原理工作。读者理解思路用不到的参数、选项和规则一概不讲，改为链接参考文档（链接取自 FACTS）。图能说清的地方就用图代替段落，每一节就是一张图加几句话。

结构：从下面两种结构中选一种，并保持它的顺序。大纲在 `# Sections` 下的第一行写明所用的结构。两种结构都是 6 到 9 节，每节用 `## ` 标题；导语和 TL;DR 不算节。

结构 A，改动的故事（一次测量暴露了问题，这项工作改变了某样东西的行为）：

| 节 | 任务 | 英文词数 |
| --- | --- | --- |
| 导语，无标题 | 团队在意什么，这件事在读者自己的工作里关系到什么，最后一句交代本文范围 | 50–80 |
| TL;DR，可选 | 三到四条核心发现，每条带数字 | 30–60 |
| 背景 | 读者必须先记住的现有系统，以及新工作必须保住的性质；一张框图 | 80–150 |
| 顺理成章的方案 | 约束条件和自然而然的应对，让它看起来是对的 | 60–120 |
| 转折 | 推翻方案的那次测量，带基线；再把一次操作拆开，用真实单位一路追到根因，根因用一句话说出 | 120–200 |
| 重新设计 | 先用一句话说出思路，再讲机制；写明它的代价和换来的东西 | 150–250 |
| 落地 | 重新设计里最难的部分：朴素实现是什么，它到底为什么行不通 | 120–200 |
| 结果 | 再放一次转折里的图，版式不变：新系统对比朴素基线和旧系统；核心数字在正文里写出两端的值 | 60–120 |
| 结尾 | 去哪里用上它：版本和文档链接，一两句话 | 20–40 |

如果没有哪个方案上线后失败，转折一节就写在现有系统上测到的问题，例如引发这项工作的那次回归。无论哪种情况，测到的问题都写在修复之前，修复的代价都要点明。

结构 B，我们做出的一套系统或工具（测试框架、诊断工具、流水线）：

1. 它为什么非有不可，用测量写出利害，由一张图承载（80–150 词）。
2. 它依据的原理和框架，用一到两张框图讲，不逐个讲参数或规则（120–200 词，一到两节）。
3. 三到四组对比，每个设计选择一节：没采用的设计对比采用的设计，画成镜像对照，两边展示同一个指标，再用一句话说明为什么不选前者、为什么选后者。其中一组是这套系统抓到的一次真实回归（每组 100–180 词）。
4. 结尾给出运行它的命令和文档链接，代替「如何使用」一节（20–40 词）。

导语（50–80 词，以交代范围的一句话收尾）和可选的 TL;DR 与结构 A 相同。

TL;DR：只在大纲要求、而且 FACTS 里至少有三个核心数字时才写。紧跟导语，单独一行 `**TL;DR**`（在文风指南允许的情形之外，本规则只允许这一处加粗），下面列三到四条，每条一个发现和它的数字。

每一节怎么往前走：
- 每一节的结尾都把故事往前推：一个结果，一个下一节会回答的问题，或者一个新的约束。没有一节以复述收尾。
- 正文先提出论断，紧接着用图证实。
- 先用一句话说出思路，再讲机制。
- 改造前与改造后共用一个版式，变化的只有差别本身。

不写这些：副标题式的引语；「本文将介绍……」式的目录（导语最后一句就是范围）；「引言」「概述」「总结」这类标题；结尾的复述；逐个讲参数、选项或规则；致谢；TODO、路线图、「下一步计划」或悬而未决的建议。文章只报告已经存在的东西。

数字：
- 每个数字都带单位。
- FACTS 给出了单位、比较对象和测量方法，才能用这个测量数字。缺一项就不用：大纲把它列进「Missing facts」，正文末尾加一行 `<!-- omitted: … -->`。
- 每个比值或「N 倍」至少有一次写出两端的值，写在同一句里，或者写在这句话引出的图里。只用 FACTS 明确给出的比值，自己不算。
- 基线是 FACTS 给出的朴素设计或旧系统，不能是一个没人会上线的设计。
- 用一句话交代数字从哪里来：次数、机器与版本，以及数字来自模拟器或录制，还是来自线上服务商。这句话放在第一个拿测量数字论证的节的第一段（结构 A 是「结果」，结构 B 是第一组对比）；导语已经引用测量数字时，放在导语里。数字不是线上实测的，就在这句话里说明，不要留到后面补一句。
- 「更快」「最多」「6 倍以上」这类相对说法，要和它概括的数字、和它所指的图对得上。

图：
- 技术文章要画图。至少规划一张讲机制的框图，文章据以论证的每一项测量各配一张图表。只有表格不算图。
- 读者需要记住的每个要点配一张图，紧跟在引出它的那段之后。
- 能讲得更清楚时，欢迎画得比方框加箭头更有表现力：按状态着色的请求条带、带真实单位的时间线、带标注的图表、前后对照的分栏。每个图形元素都表示一种状态、一个量或一个步骤。图例写明每种状态，同一种状态在全文所有图里用同一个名字。
- 图表只画 FACTS 里的数字，大纲写明它画的每个值对应的 FACTS 编号。没有测量数字的对比画成状态或流程，不画成图表。
- 镜像对照：改造前与改造后（或没采用的设计与采用的设计）共用一个版式、一个刻度和相同的标签。两边的 `text:` 字符串相同、顺序相同，只有数值和标明是哪一边的那个标签不同。一组对照可以画成一张两栏的图，这时算一张图。
- 图注写出结论，带上数字和两端的值。只给图起个名字的图注（「基准测试结果」「架构概览」）不合格。
- 读者要查的精确数字放进 Markdown 表格，读者应当一眼看出的对比画成图表。同一组数字不要既列表又画图。核心数字同时写进正文。

语气：
- 「我们」指团队。「你」只出现在结尾，或者指读者自己的环境时。
- 术语第一次出现时加注解，放在括号里或前一句里。
- 每个难点最多用一个类比，而且这个类比在技术上必须成立。
- 解释用长句，结果落地的地方用一个短句。
- 幽默只拿工作本身开玩笑，不拿读者或其他项目开玩笑。
- 每个标题都按这一节的作用来选词，说出这一节发生了什么。英文标题里的双关不硬译，换一个起同样作用的中文标题。
- 全文最多一个设问，用在转折处：它放在转折前一节的末尾，由下一节回答。除此之外，任何一节都不以问句开头或结尾，全文也不以问句结尾。
<!-- /prompt -->

## Notes

**Source.** Shape A and the section moves are distilled from Modal's
[Building fast filesystems for VMs](https://modal.com/blog/vm-sandbox-filesystem) (2026-10-16),
which pairs its figures 1↔6, 4↔5 and 3↔7. Shape B, the length rule, "a technical post is drawn"
and the no-TODO rule are the owner's (2026-10-17, shortened 2026-10-18). The post is named here
and not in the prompt, so the model learns its moves without quoting it or citing a URL that is
not in FACTS.

**What FACTS must hold for a practice post.** Every measured number enters with its unit, its
baseline and its method (count, machine and version, simulator or recording or live provider),
because the prompt drops a number that lacks any of them. A ratio the post needs enters
precomputed, with both endpoints in the same entry, because the writer may not compute one. The
numbers come from a run made for the post; its command, and the location of a throwaway script,
go in the PR description. Live measurements against paid model APIs need the user's go-ahead and
a key they authorize for that purpose.

**What `check` must agree with.** The settings below allow 6 to 9 sections, a lead and a
`**TL;DR**` line with three or four bullets after the lead. The turn's question needs no setting:
`check` only warns about a question that opens a section. Exclamation marks keep the script's
default of none. Change this file and the script together.

**What this profile leaves to others.** Drawing a figure (inline SVG, classes, the hidden text
list, ids, both themes at 390 px) is the skill's figures section and `check --svg`. Polishing is
the pipeline's `polish` and `review` steps. What is checked before the PR is `check`, `review` and
the visual check. The file pair, frontmatter and screenshot hosting are in `penguin-harness-dev`'s
`reference/authoring.md`.

## Check settings

- sections: 6-9
- lead: yes
- tldr: yes
