# Case study: measuring the AI out of a thousand-character explainer

How the tells in SKILL.md were derived. One assignment was answered twice: first as a deliberately typical AI draft, the register a default assistant produces unprompted, and then as a rewrite into print register. Both versions were kept, the tells were counted with pattern matching rather than judgment, and the diff between the two produced the numbered findings at the end. The exercise is in Chinese; the English cues in SKILL.md are the same structures as they surface in English AI output, because the structural rules needed no translation, only the surface cues did.

The assignment, as a user would phrase it: 请帮我写一篇图文稿，大约 1000 字，讲清楚"skill 是什么"。(Write an illustrated piece of about 1,000 characters explaining what a skill is.)

## Baseline: the default AI draft

Kept verbatim, tells and all.

```markdown
# Skill 是什么？一文读懂 AI 时代的"技能包"

【配图建议：一个机器人头像旁悬浮着几本发光的手册】

在人工智能飞速发展的今天，你可能经常听到一个词——Skill。它不是游戏里的技能，也不是简历上的特长，而是 AI Agent 世界里的一个核心概念。今天，我们就用一篇短文，带你彻底搞懂：Skill 到底是什么？

## 一、Skill 的本质：给 AI 的"说明书"

想象一下，你新入职了一位聪明的助理。他学习能力超强，但对公司的业务一无所知。这时，你递给他一本《员工手册》——翻开一读，他立刻就知道该怎么做事了。

Skill，就是递给 AI 的那本手册。

它本质上是一份结构化的文档，里面写着：什么时候该用我、具体该怎么做、有哪些注意事项。AI 平时并不会把它背在身上，只有当任务匹配时，才会翻开阅读、照着执行。

【配图建议：一本翻开的手册，标注"何时用、怎么用、注意什么"】

## 二、Skill 不是工具，而是经验

很多人会把 Skill 和工具（Tool）混为一谈。但两者有着本质的区别：

- **工具**是给 AI 装上新的"手脚"，让它能做到以前做不到的事；
- **Skill** 则是给 AI 注入新的"经验"，让它知道怎么把事情做对。

换句话说，工具扩展的是能力边界，Skill 提升的是做事质量。一个是硬件升级，一个是软件调优。

## 三、Skill 的三大特点

**1. 按需加载，轻若无物。** Skill 平时只占一行简介，任务来了才展开全文。这意味着 AI 可以携带成百上千个 Skill，而不会"脑容量爆炸"。

**2. 纯文本构成，人人可写。** 写 Skill 不需要编程基础——它就是一篇 Markdown 文档。你能写文档，就能教 AI 新本领。

**3. 可分享，可复用。** 一个人踩过的坑，写成 Skill 之后，所有人的 AI 都能绕开。知识第一次可以像 App 一样被安装。

【配图建议：三个图标——羽毛（轻）、铅笔（易写）、循环箭头（复用）】

## 四、一个真实的例子

假设你经常让 AI 整理会议纪要，但它输出的格式总是飘忽不定。于是你写下一个 Skill：先列决议，再列待办，人名加粗，截止日期标红。从此以后，每当你说"整理纪要"，AI 都会自动翻出这套规范，稳定输出同样的格式。

这就是 Skill 的魔力——它把一次性的叮嘱，变成了永久的默契。

## 结语

Skill 的出现，标志着人与 AI 协作方式的深刻转变：从"每次都要教"，变成"教一次就够"。它不是让 AI 变得更强大，而是让 AI 变得更懂你。

未来已来。或许下一个改变你工作方式的 Skill，就出自你自己之手。

【配图建议：一只手把发光的书递给机器人，背景是升起的朝阳】
```

## Revision: print register

Same assignment, rewritten to the register of a newspaper explainer or an encyclopedia entry.

```markdown
# Skill：写给 AI 的操作规程

图：一份 SKILL.md 文档的结构示意，元数据在前，正文在后。

在 AI Agent 的语境里，Skill 指一份教模型完成某类任务的结构化文档。它通常是一个 Markdown 文件，开头几行元数据写明名称与适用场景，正文交代操作步骤、注意事项和常见错误，必要时附上参考资料。Agent 平时只记住每个 Skill 的一句话简介，遇到匹配的任务才读取全文，照着执行，用完即放下。这种机制称为按需加载，简介只占几十个 token，因此一个 Agent 装几十上百个 Skill，代价也几乎可以忽略。

这一格式由 Anthropic 于 2025 年提出，随后被多家 Agent 产品沿用，逐渐成为行业约定。在此之前，用户想让 AI 稳定地按某种规范办事，要么每次对话重新交代，要么把冗长说明塞进系统提示词，既费时，又挤占模型的注意力。Skill 把这类经验固化成文件：写一次，装进 Agent，此后凡是相关任务都自动生效。载体只是文本，会写文档的人就会写 Skill；同一份文件可以导出、分享、装进别的 Agent，团队积累的经验由此得以流转。

Skill 常与工具（Tool）混淆，两者分工并不相同。工具决定 Agent 能做什么，例如访问网页、执行代码、读写文件；Skill 决定 Agent 怎样把事做对，例如财务对账要核对哪些科目，代码评审要先看哪类风险。工具划定能力范围，Skill 承载操作经验，一个可用的 Agent 通常两者兼备。

一个 Skill 也不限于单个文件。复杂的规程可以在目录里附带参考文档、模板或脚本，正文只保留主线，细节留待用到时再读。文件带版本号，库里发布新版后重装一次即完成更新，旧版附件随之清理。

会议纪要是个现成的例子。用户希望纪要先列决议、再列待办，并标注负责人和截止日期，就可以把这套格式连同范例写成 Skill 装给 Agent。此后每次整理纪要，输出都遵循同一规范，不必再逐次叮嘱。装配的规程越多，Agent 对具体业务的适应就越深；对使用者而言，衡量一个 Agent 称不称手，常常就是看它装了哪些 Skill。

图：技能库中的同一个 Skill 被安装到多个 Agent 的示意。
```

## Census

Counted mechanically over both texts (characters exclude whitespace; sentence terminators are 。！？):

| Signal                                        | Baseline | Revision |
| --------------------------------------------- | -------- | -------- |
| Characters                                    | 1,061    | 878      |
| Sentences                                     | 32       | 20       |
| Paragraphs                                    | 18       | 5 (+2 figure captions) |
| Paragraphs of two sentences or fewer          | 12       | 0 (captions aside) |
| Em-dashes (——)                                | 5        | 0        |
| 不是……而是…… contrast templates              | 3        | 0        |
| Rhetorical triads (三大特点, triple icons, triple parallel clauses) | 3 | 0 |
| Scare-quote pairs                             | 9        | 0        |
| Bold runs in body text                        | 5        | 0        |
| Subheadings                                   | 5        | 0        |
| Reader addresses (你 / 我们)                  | 12       | 0        |
| Era opener / uplift ending                    | 1 / 1    | 0 / 0    |

The revision also carries roughly twice the discrete facts (format and metadata, token cost of the summary, Anthropic and 2025, the pre-skill alternatives, tool-versus-skill with two concrete examples each, multi-file layout, versioned updates) in 17% fewer characters.

## Findings

1. **Scaffolding is length-sensitive.** The baseline spent five subheadings, a numbered section scheme and a 结语 on a thousand characters; print explainers of that size run as continuous prose. Deleting the scaffold forced real transitions, and those transitions displaced filler sentences. This became tell 6.
2. **The contrast template is the strongest single signature.** 不是……而是…… appeared three times in one short piece. Each instance was replaceable by asserting the positive directly, and nothing was lost. Tell 1.
3. **Every dash was doing another mark's job.** All five 破折号 read naturally as a comma, a colon or a full stop. Tell 3.
4. **Triads were manufactured, enumerations were real.** Features arrived in exactly three, with matched four-character heads (按需加载，轻若无物). The revision keeps true enumerations (访问网页、执行代码、读写文件) and none of the rhythm; distinguishing factual enumeration from rhythmic parallelism became the operative rule. Tell 2.
5. **Fragment paragraphs hid padding.** Twelve of eighteen paragraphs were two sentences or fewer, including the one-line applause paragraph "Skill，就是递给 AI 的那本手册。" Merging by idea produced five paragraphs and exposed sentences that existed only to bridge fragments; they were deleted rather than rewritten. Tell 5.
6. **No metaphor survived contact with a fact.** The employee-handbook scene, 手脚/经验, 硬件升级/软件调优, 脑容量爆炸, 魔力 and 默契 all decorated; each was replaced by the mechanism stated plainly, which turned out shorter and clearer. A figure earns its place only when it compresses a mechanism, and this piece needed none. Tell 4.
7. **Reader management subtracted information.** 你 and 我们 appeared twelve times; the revision uses third person throughout, and the space freed by coaching ("想象一下", "带你彻底搞懂") went to content. Tell 9.
8. **Hype marks missing facts.** 飞速发展, 彻底, 本质上 and 深刻转变 sat exactly where the draft had nothing specific to say; replacing them forced real specifics (Anthropic, 2025, 几十个 token, frontmatter). Treating hype words as a missing-fact detector is the practical use of tell 7.
9. **The ending was detachable.** 未来已来。或许下一个改变你工作方式的 Skill，就出自你自己之手。 could be removed without touching anything else; the revision ends on a substantive claim instead (衡量一个 Agent 称不称手，常常就是看它装了哪些 Skill). Tell 7.
10. **Scare quotes clustered on ordinary words.** Nine pairs, mostly on plain nouns (说明书、手脚、经验、整理纪要); the revision needs zero. Tell 10.
11. **The baseline rotated synonyms; the revision holds terms.** 技能包、手册、说明书、本领 and 规范 all meant Skill; the revision uses Skill throughout, glossed once as 操作规程. One term per referent per language. Tell 10.
12. **Humanized text is shorter per fact.** 1,061 characters became 878 while the fact count roughly doubled, and the gap to the 1,000-character target was filled by adding a substantive paragraph (multi-file layout, versioned updates), not by restoring rhetoric. This became method step 5.
13. **Rhythm was the last thing to break.** Even with the templates gone, the draft droned until sentence lengths were forced apart: 写一次，装进 Agent sits next to a fifty-character qualified sentence. Varying length deliberately became tell 8.
14. **Typography belongs to the genre.** Five bold runs and bracketed image directives (【配图建议：……】) are deck register; the print version uses plain captions (图：……) and no bold in running text. Folded into tells 6 and 10.
