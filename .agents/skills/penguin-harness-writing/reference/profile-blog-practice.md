# Profile: technical posts

Loaded for `--profile blog-practice` (blog category `practice`): an engineering story about
something the team built, argued as an essay: why it was built that way, with the mechanism and
what was measured as the evidence. The `prompt` block is sent to the model as `{{PROFILE}}` after
the style guide; the `prompt zh` block replaces it for Chinese text. `## Notes` is for agents and
`## Check settings` is read by `prose.mjs`; neither is sent. The settings' ranges are `floor-cap`,
English in words and Chinese in characters of body text (figure blocks, headings, frontmatter and
the references list do not count). The outline's plan is held to the caps, and `check` makes a
section above its cap (or above 1.1 × its planned size) an error and one below its floor a
warning. `sources` counts the entries of the reference list (`[^n]:`) a published post ends with,
or the sources strip would cite from a draft read with `--facts`: above the cap is an error, below
the floor a warning. `body-lists: none` makes a list outside the TL;DR an error, and
`body-tables: none` a table in the body.

<!-- prompt -->
This is a technical post: one engineering story about something the PenguinHarness team built, written as an argumentative essay. The post defends one design claim about that system, why it was built that way, with the mechanism and what was measured as its evidence. It is not a release note, a news item, a tutorial that walks the reader through clicks, or a gallery of figures with captions. The reader is a developer who builds or runs agent systems and has ten minutes; they came for the argument, the mechanism and the measurement. The rules below add to the style guide, and a rule that overrides it says so.

Form: one complete essay in connected paragraphs. The lead states the thesis, each `## ` section argues one point for it, and the close returns to it. Every paragraph follows from the one before, and the first sentence after a heading continues the last sentence before it. The body is prose: no bullet or numbered list (the TL;DR is the post's only list) and no Markdown table (numbers go in sentences, with a figure confirming them). This overrides the style guide's allowance for lists and tables and any instruction to turn a paragraph into a list.

Length: the body runs 550 to 750 English words and never more than 750; figure blocks, headings and the references do not count. The lead takes 50 to 90 words, a TL;DR 30 to 50, each argument section 100 to 170 and the close 60 to 100. The plan gives every section its number, the numbers add up to at most 750, and a section's budget is binding. Explain why the system exists and the principle it works on. Leave out every parameter, option and rule the reader does not need to follow the argument, and link the reference docs for them (a URL from FACTS).

The lead: one or two paragraphs with no heading. It states the thesis, the design claim the post defends, in plain words, says why it matters in the reader's own work, and ends on one sentence that states the post's scope.

How a section argues:
- It opens with its claim, the one point it adds to the thesis, in a sentence that continues the section before.
- Then the reasoning, and then the evidence: the mechanism, our measurement against a baseline, or a regression the system caught.
- Then the objection: the alternative a reader would propose, the design not taken, stated fairly and answered with the same kind of evidence.
- It ends on the point it has proved, which the next section builds on, never on a recap.
- A figure comes right after the paragraph whose argument it supports, and that paragraph makes the argument in words first.

Shape: choose one of the two orders below and keep it. The outline names the order in the last line of `# Reader and takeaway` ("Shape A" or "Shape B"), so every call sees it. Either order has 4 or 5 `## ` sections, the close being the last; the lead and a TL;DR are not sections.

Shape A, a change story (a measurement showed a problem, and the work changed how something behaves). The thesis is the redesign's claim.
1. The problem, measured: the existing system the reader must hold in mind, the property the new work has to keep, and the measurement that showed it failing, against a baseline; one diagram.
2. The obvious design, and why it fails: the natural answer to the constraint, argued fairly as the objection, then the measurement that broke it and one operation taken apart with real units, down to a root cause stated in one sentence. When nothing shipped and failed, this section measures the problem on the current system, such as the regression that started the work.
3. The redesign: the idea in one sentence, then the mechanism; its hardest part, the naive implementation and the exact reason it fails; what the redesign costs and what it buys.
4. The results as the proof: the problem's chart again on the same layout, the new system against the naive baseline and the previous system, and the headline number in prose with both endpoints. A post with four sections folds this into the redesign.
5. The close.

Shape B, a system or tool we built (a test harness, a diagnostic, a pipeline). The thesis is the design claim the system embodies.
- The first section: why it must exist, and the principle it works on. The stakes come measured and carried by one figure, then the principle in one or two diagrams, without a walk through its parameters or rules.
- Then two or three sections, one argument and one design choice each: the choice we made is the claim, the design not taken is the objection, and the same metric for both is the evidence, drawn as a mirror pair. A real regression the system caught is the evidence of one of them.
- The last section: the close.

The close: it returns to the thesis and says what follows from it for the reader's work, then ends on where to get it: the version and the docs link (shape A), or the command that runs it and the docs link (shape B), in place of a "how to use" section. It is not a section-by-section recap. In every post a measured problem comes before its fix, and the fix's cost is named.

TL;DR: only when the outline asks for one and FACTS holds at least three headline numbers. Right after the lead, a line `**TL;DR**` (the one bold this profile allows beyond the style guide's own cases), then three or four bullets, one finding and its number each.

Not in the post: a dek or subtitle line; an "In this post we will…" agenda (the lead's last sentence is the scope); "Introduction", "Overview" or "Conclusion" headings; a closing recap; a list or a table in the body; a section that is a figure with a caption around it; a walk through every parameter, option or rule; acknowledgements; TODOs, a roadmap, "what's next" or open recommendations. The post reports what exists.

Numbers:
- Every number carries its unit.
- Use a measured number only when FACTS gives its unit, what it is compared against and how it was measured. A number FACTS holds without these is left out: the outline lists it under "Missing facts", and the section gets an `<!-- omitted: … -->` line.
- Every ratio or "N times" appears with both endpoints at least once, in the same sentence or in the figure that sentence introduces. Use a ratio only when FACTS states it; never compute one.
- The baseline is the naive design or the previous system, as FACTS gives it, never a design nobody would ship.
- One method sentence says how the numbers were produced: the count, the machine and version, and whether they come from a simulator or a recording or from a live provider. It sits in the first paragraph of the first section that argues from a measured number (the problem in shape A, the first argument in shape B), or in the lead if the lead already quotes one. When the numbers are not live, that sentence says so there, not in a later aside.
- A relative word ("faster", "most", "over 6×") agrees with the numbers it summarizes and with the figure it points to.
- Most sentences carry no citation; the facts that need one are third-party numbers, quotes and our own measurement. Keep writing every fact id the marker rule asks for: the citations are chosen from those markers later.

Figures:
- A technical post is drawn, and its figures serve the argument. Plan at least one diagram of the mechanism, and a chart for each measurement the post argues from.
- A figure comes right after the paragraph whose argument it supports and confirms what that paragraph has said in words. It never replaces a paragraph.
- Bolder than boxes and arrows is welcome when it explains more: a request drawn as a strip coloured by state, a timeline with real units, an annotated chart, a before/after split. Every mark encodes a state, a quantity or a step. The legend names each state, and a state keeps the same name in every figure of the post.
- A chart plots FACTS numbers only, and the outline names the FACTS id of every value it plots. A comparison without measured numbers is drawn as states or a flow, never as a chart.
- Mirror pairs: the design not taken and the one taken (or the before and the after) share one layout, one scale and the same labels. Their `text:` strings are the same, in the same order, except the values and the one label that names the variant. A pair may be one figure with two panels, and then it counts as one figure.
- A caption states the finding with its numbers and both endpoints. A caption that only names the picture ("Benchmark results", "Architecture overview") is wrong.
- The headline number goes in a sentence; the figure confirms it.

Voice:
- "We" is the team. "You" appears only in the close, or where the reader's own setup is meant.
- Past tense for what happened, present tense for how it works.
- Gloss a term at its first use, in parentheses or in the sentence before.
- At most one analogy per hard idea, and it must be technically true.
- Long explanatory sentences, with a short one where a result lands.
- Humour only about the work, never about readers or other projects.
- Headings in sentence case, each stating the point its section argues; a play on words is fine.
- One rhetorical question at most in the whole post, as the turn in shape A: it ends the problem section, and the next section answers it. Apart from it, no section opens or ends on a question, and the post never does.
<!-- /prompt -->

<!-- prompt zh -->
这是一篇技术文章：讲 PenguinHarness 团队做出的一样东西，写成一篇议论文。全文为这套系统的一个设计主张辩护：它为什么这样设计，以机制和测到的结果作论据。它不是发布说明，不是新闻，不是带读者一步步点界面的教程，也不是配上图注的图集。读者是搭建或运行 Agent 系统的开发者，有十分钟，想看的是论证、机制和测量结果。下面的规则是对文风指南的补充，凡是覆盖指南的条目都会写明。

形式：一篇完整的文章，段落前后相连。导语提出论点，每个 `## ` 小节为它论证一个分论点，结尾回到论点。每一段都接着上一段往下说，小标题后的第一句接着标题前的最后一句。正文全是段落：不用项目列表或编号列表（TL;DR 是全文唯一的列表），不用 Markdown 表格（数字写进句子，由图来印证）。这一条覆盖文风指南里允许用列表和表格的说法，也覆盖任何要求把段落改成列表的指令。

篇幅：正文 1300 到 1800 字，最多 1800 字；图块、标题和参考文献不计。导语 120 到 220 字，TL;DR 70 到 120 字，每个论证小节 240 到 400 字，结尾 150 到 240 字。大纲为每一节定好字数，合计不超过 1800 字，每一节的预算都必须遵守。讲清这套系统为什么存在、按什么原理工作。读者跟上论证用不到的参数、选项和规则一概不讲，改为链接参考文档（链接取自 FACTS）。

导语：一到两段，不带标题。用平实的话提出论点，也就是全文要辩护的设计主张，说明它和读者自己的工作有什么关系，最后一句交代本文范围。

每一节怎么论证：
- 开头一句提出这一节的分论点，也就是它为论点补上的一步，并接住上一节。
- 接着是推理，然后是论据：机制、我们对照基线测到的结果，或者这套系统抓到的一次回归。
- 然后是反方：读者会提出的另一种做法，也就是没采用的设计，公允地摆出来，再用同类论据回应。
- 结尾落在这一节已经证明的那一点上，下一节在它之上继续，不以复述收尾。
- 图紧跟在它所支撑的那一段之后，那一段先用文字把论证讲完。

结构：从下面两种顺序中选一种，并保持它。大纲在 `# Reader and takeaway` 的最后一行写明所用的顺序（「Shape A」或「Shape B」），这样每次调用都能看到。两种顺序都是 4 到 5 节，每节用 `## ` 标题，最后一节是结尾；导语和 TL;DR 不算节。

结构 A，改动的故事（一次测量暴露了问题，这项工作改变了某样东西的行为）。论点是重新设计的主张。
1. 测出来的问题：读者必须先记住的现有系统、新工作必须保住的性质，以及对照基线、证明它出了问题的那次测量；一张框图。
2. 顺理成章的方案，以及它为什么不行：把应对约束的自然做法作为反方公允地摆出来，再给出推翻它的测量，把一次操作拆开，用真实单位一路追到根因，根因用一句话说出。如果没有哪个方案上线后失败，这一节就测出现有系统上的问题，例如引发这项工作的那次回归。
3. 重新设计：先用一句话说出思路，再讲机制；讲它最难的部分，朴素实现是什么、到底为什么行不通；讲重新设计的代价和换来的东西。
4. 结果就是证明：再放一次问题那一节的图，版式不变，新系统对比朴素基线和旧系统，核心数字在正文里写出两端的值。只有四节的文章把这一节并进重新设计。
5. 结尾。

结构 B，我们做出的一套系统或工具（测试框架、诊断工具、流水线）。论点是这套系统体现的设计主张。
- 第一节：它为什么非有不可，以及它依据的原理。先用测量写出利害，由一张图承载；再用一到两张框图讲原理，不逐个讲参数或规则。
- 接下来两到三节，每节一个论证、一个设计选择：我们采用的做法是分论点，没采用的设计是反方，两边的同一个指标是论据，画成镜像对照。其中一个论证的论据是这套系统抓到的一次真实回归。
- 最后一节：结尾。

结尾：回到论点，说明它对读者的工作意味着什么，最后给出去哪里用上它：版本和文档链接（结构 A），或者运行它的命令和文档链接（结构 B），代替「如何使用」一节。结尾不逐节复述。无论哪种结构，测到的问题都写在修复之前，修复的代价都要点明。

TL;DR：只在大纲要求、而且 FACTS 里至少有三个核心数字时才写。紧跟导语，单独一行 `**TL;DR**`（在文风指南允许的情形之外，本规则只允许这一处加粗），下面列三到四条，每条一个发现和它的数字。

不写这些：副标题式的引语；「本文将介绍……」式的目录（导语最后一句就是范围）；「引言」「概述」「总结」这类标题；结尾的复述；正文里的列表或表格；只有一张图加图注的小节；逐个讲参数、选项或规则；致谢；TODO、路线图、「下一步计划」或悬而未决的建议。文章只报告已经存在的东西。

数字：
- 每个数字都带单位。
- FACTS 给出了单位、比较对象和测量方法，才能用这个测量数字。缺一项就不用：大纲把它列进「Missing facts」，这一节末尾加一行 `<!-- omitted: … -->`。
- 每个比值或「N 倍」至少有一次写出两端的值，写在同一句里，或者写在这句话引出的图里。只用 FACTS 明确给出的比值，自己不算。
- 基线是 FACTS 给出的朴素设计或旧系统，不能是一个没人会上线的设计。
- 用一句话交代数字从哪里来：次数、机器与版本，以及数字来自模拟器或录制，还是来自线上服务商。这句话放在第一个拿测量数字论证的节的第一段（结构 A 是「测出来的问题」，结构 B 是第一个论证）；导语已经引用测量数字时，放在导语里。数字不是线上实测的，就在这句话里说明，不要留到后面补一句。
- 「更快」「最多」「6 倍以上」这类相对说法，要和它概括的数字、和它所指的图对得上。
- 多数句子不带引用；需要引用的是第三方的数字、原话引述和我们自己的测量。事实编号仍按标记规则逐句写上，引用之后再从这些标记里挑选。

图：
- 技术文章要画图，图为论证服务。至少规划一张讲机制的框图，文章据以论证的每一项测量各配一张图表。
- 图紧跟在它所支撑的那一段之后，印证那一段已经用文字说出的论证。图不能代替段落。
- 能讲得更清楚时，欢迎画得比方框加箭头更有表现力：按状态着色的请求条带、带真实单位的时间线、带标注的图表、前后对照的分栏。每个图形元素都表示一种状态、一个量或一个步骤。图例写明每种状态，同一种状态在全文所有图里用同一个名字。
- 图表只画 FACTS 里的数字，大纲写明它画的每个值对应的 FACTS 编号。没有测量数字的对比画成状态或流程，不画成图表。
- 镜像对照：没采用的设计与采用的设计（或改造前与改造后）共用一个版式、一个刻度和相同的标签。两边的 `text:` 字符串相同、顺序相同，只有数值和标明是哪一边的那个标签不同。一组对照可以画成一张两栏的图，这时算一张图。
- 图注写出结论，带上数字和两端的值。只给图起个名字的图注（「基准测试结果」「架构概览」）不合格。
- 核心数字写进句子，由图来印证。

语气：
- 「我们」指团队。「你」只出现在结尾，或者指读者自己的环境时。
- 术语第一次出现时加注解，放在括号里或前一句里。
- 每个难点最多用一个类比，而且这个类比在技术上必须成立。
- 解释用长句，结果落地的地方用一个短句。
- 幽默只拿工作本身开玩笑，不拿读者或其他项目开玩笑。
- 每个标题说出这一节论证的分论点。英文标题里的双关不硬译，换一个起同样作用的中文标题。
- 全文最多一个设问，用在结构 A 的转折处：它放在「测出来的问题」一节的末尾，由下一节回答。除此之外，任何一节都不以问句开头或结尾，全文也不以问句结尾。
<!-- /prompt -->

## Notes

**Source.** The change story's moves (the obvious plan, the turn, the redesign with its cost,
results against the naive baseline) are distilled from Modal's
[Building fast filesystems for VMs](https://modal.com/blog/vm-sandbox-filesystem) (2026-10-16),
which pairs its figures 1↔6, 4↔5 and 3↔7. Shape B, "a technical post is drawn" and the no-TODO
rule are the owner's (2026-10-17, shortened 2026-10-18). The essay form is the owner's rule of
2026-10-23, 「写技术文章时候一定要用完整的文章来写,类似议论文的风格」: a thesis in the lead,
one argued point per section in connected paragraphs, the design not taken answered as the
objection, a close that returns to the thesis, no list or table in the body, and figures that
support a paragraph instead of replacing it. Both shapes keep their content in argument order. The
post is named here and not in the prompt, so the model learns its moves without quoting it or
citing a URL that is not in FACTS.

**What FACTS must hold for a practice post.** Every measured number enters with its unit, its
baseline and its method (count, machine and version, simulator or recording or live provider),
because the prompt drops a number that lacks any of them. A ratio the post needs enters
precomputed, with both endpoints in the same entry, because the writer may not compute one. The
numbers come from a run made for the post; its command, and the location of a throwaway script,
go in the PR description. Live measurements against paid model APIs need the user's go-ahead and
a key they authorize for that purpose.

**Length.** 750 English words and 1,800 Chinese characters at most: the owner's v2 budget for
every post (2026-10-23), which replaced this profile's earlier 850 / 2,050. The essay form takes
fewer, fuller sections, so an argument has room: 4 or 5, each argument 100 to 170 words (240 to
400 characters) and the close 60 to 100 (150 to 240), with a lead of 50 to 90 words (120 to 220).
At five sections the rows cannot all reach their cap; the plan keeps the sum under 750 (1,800).

**What `check` must agree with.** The settings below are the budgets the prompt states: 4 to 5
sections, a lead, a `**TL;DR**` line with three or four bullets after the lead, and the word and
character ranges. `section-words` starts at 60 and `zh-section-chars` at 150 so the close passes
the floor; the argument sections aim higher in the prompt. The Chinese ranges are about 2.4 times
the English ones. `body-lists: none` and `body-tables: none` hold the body to paragraphs, with the
TL;DR as the one list. The turn's question needs no setting: `check` only warns about a question
that opens a section. Exclamation marks keep the script's default of none. `emphasis` turns on the
one marked key sentence per section that `emphasize` adds, at most 25 words or 40 characters.
`sources` bounds the reference list at 8 to 13. Change this file and the script together.

**What this profile leaves to others.** Drawing a figure (inline SVG, classes, the hidden text
list, ids, both themes at 390 px) is the skill's figures section and `check --svg`. Polishing is
the pipeline's `polish` and `review` steps. What is checked before the PR is `check`, `review` and
the visual check. The file pair, frontmatter and screenshot hosting are in `penguin-harness-dev`'s
`reference/authoring.md`.

## Check settings

- sections: 4-5
- lead: yes
- tldr: yes
- words: 550-750
- lead-words: 50-90
- section-words: 60-170
- tldr-words: 30-50
- zh-tldr-chars: 70-120
- zh-chars: 1300-1800
- zh-lead-chars: 120-220
- zh-section-chars: 150-400
- ui-labels: quoted
- emphasis: yes
- emphasis-words: 25
- zh-emphasis-chars: 40
- sources: 8-13
- body-lists: none
- body-tables: none
