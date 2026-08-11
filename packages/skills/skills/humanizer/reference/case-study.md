# Case study: measuring the AI out of prose

How the tells in SKILL.md were derived, in three rounds. Round one is a controlled exercise: one assignment answered twice, first as a deliberately typical AI draft, the register a default assistant produces unprompted, then as a rewrite into print register; both versions were kept, the tells were counted with pattern matching rather than judgment, and the diff produced the sentence-layer tells (1–10). Round two is a set of field tests, added after human readers flagged text that already followed round one; it produced the discourse-layer tells (11–17). Round three scaled the method: ten fresh pieces across five languages and ten genres, written honestly to the first two layers, were reviewed blind by independent editors; what they still caught produced the scrub-layer tells (18–24) and the per-language lists in `language-cues.md`. Rounds one and two are in Chinese; round three covers Chinese, English, Japanese, French, German and Spanish.

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

## Findings, round one

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

## Round two: field tests

Two pieces written to the round-one rules were then reviewed by human readers. Both passed the round-one census (no dashes, no contrast templates, no manufactured triads, merged paragraphs, concrete facts, third person) and both were still flagged. Every flag sat above the sentence: in the opening, in the shape of adjacent sentences, or in the argument. Those flags became the discourse-layer tells.

### Field test A: an MCP explainer (zh, four paragraphs)

Three reader flags:

- **The opening.** 大模型本身只会生成文本：查不了数据库，调不动软件。 as the first line: a categorical, colon-hinged verdict with no ground under it. Readers expect a beat of orientation before a verdict; the era-opener ban from round one had been overshot into a cold open. The fix is reordering, not rewording: open on the M×N integration situation the protocol answers, and let the verdict land after it (tell 11; the overcorrection lesson is finding 16 below).
- **Staccato.** 假设有 M 个应用、N 个工具，就要维护 M×N 套接口；接口一旦变动，各端的代码都要跟着改。 Clipped clauses strung together read as their own uniformity; round one had only named the medium-length drone (tell 8, extended).
- **A skeleton run.** 工具方写一个 MCP 服务器，所有兼容应用都能调用；应用方支持 MCP，就能接上生态里现成的服务器。 followed by 数据访问、权限、连接方式都在协议里有统一约定，不再为每个组合单独开发。 Three sentences on one template (topic, then 都能／就能／不再 verdict); each is fine alone, and the reader's word for the run was 审美疲劳 (tell 12).

### Field test B: a tech commentary (zh, five paragraphs, ~1,200 characters)

An essay arguing that the stronger the model, the more its surrounding harness matters. The reviewing read put its AI-feel at 30–40%, "not because the language is unnatural but because it is too complete" (过于完整): every paragraph correct, every loop closed, every line serving the thesis. Specific flags:

- **One paragraph template, aphorism density.** Paragraphs ran claim, explanation, widened conclusion, each peaking in a quotable: 模型的能力抬高的是上限，上限能在多大程度上被兑现，取决于 harness。 / 真正决定一个系统能完成什么任务的，是它周围那层看不见的结构。 / 单点生成能力普遍够用之后，系统之间的差异就由 harness 决定。 Reviewed singly each passed; in sequence they read as a metronome (tell 13).
- **Thesis restatement.** The reviewer counted the central claim expressed five or six ways across the piece and recommended cutting 20–30%; none of the echoes carried new material (tell 14).
- **Abstraction chains.** 每一次能力扩张都会把原先不属于 harness 的部分吸纳进来。 and 边界一直在外移 : concept subjects acting on concept objects through stock commentary phrases. The requested fix was mechanism-level concreteness: when context is compacted, how a failed tool call is retried, where long-task progress is saved, how work is handed between agents (tell 15).
- **Overclaims.** 这说明 harness 是一个独立的设计空间……无法……当作顺手附赠的配件 and 现成的参照并不存在, both hung on one recalled case. The calibrated rewrites (这至少说明……、至少在当时……) were accepted as more human (tell 16).
- **Unanchored attribution.** 作者认为、据他回忆、作者称之为 throughout, with no name, date or link, plus a bare project name dropped without a gloss: the reviewer's phrase was that it reads like an automatic digest of social media posts (folded into tell 7).
- **A calque.** 模型本身所占的比重不断缩小，系统其余部分所占的比重不断增大。 tracks the English "the model becomes a smaller part of the system" word for word; recast in native idiom (随着任务变复杂，决定成败的因素越来越多，模型本身只是其中一环) the AI feel disappeared (tell 17).

### Findings, round two

15. **The sentence-layer counters are necessary, not sufficient.** Both pieces scored clean on every round-one counter and were still flagged. The second layer lives in shapes: of the opening, of adjacent sentences, of paragraphs, of the argument. This added the shape pass to the method.
16. **Overcorrection creates new tells.** Banning era openers produced the cold-open verdict; a rule needs its counterweight stated. One grounding sentence is orientation, not throat-clearing.
17. **Repetition hides at the argument level.** No sentence restated its neighbor, yet the thesis was restated across paragraphs half a dozen times. The census must count claim-level repetition, not just adjacent echo.
18. **"Too complete" is itself a tell.** Every loop closed, every paragraph landing, no unresolved edge. Edited human prose keeps some unevenness: hedged claims, paragraphs that end on a fact, a question left open.
19. **The effective fixes were material, not verbal.** Add the mechanism, name the source, gloss the term, calibrate the claim to the evidence; where the concrete detail does not exist, that is missing research, and the round-one rule stands: never invent it.

## Round three: ten pieces, five languages, blind cross-review

Protocol: ten pieces (about 400–700 words each) were written honestly to the layer-1/2 rules across ten genres, then handed to four independent editor-reviewers with native-level command of the relevant languages. The reviewers were not shown the rules; the brief asked them to quote verbatim anything machine-flavored, flag over-correction, check anchoring, judge genre fit, and score AI-likelihood 0–100. Two pieces were assigned to two reviewers each to measure agreement. The pieces were then revised against every accepted flag, and the four worst-scoring revisions were re-scored blind by a fifth reviewer who was not told they were revisions.

| # | Language | Genre | Verdict(s) | Re-score | Heaviest flags |
| --- | --- | --- | --- | --- | --- |
| 1 | zh | popular history | 55 / 70 | 30 | phantom crowd, 身份终结 calque, metronomic kickers, anti-AI-blacklist profile |
| 2 | zh | product launch | 60 | — | 意味着 gloss pivots, calqued slogan couplet, mirrored anonymous social proof, cadenced buttons |
| 3 | zh | how-to | 20 | — | (near clean; genericness the only residue) |
| 4 | en | encyclopedia entry | 35 | — | aphoristic research-history pivot, uniform closing cadence, smoothed-away discoverer |
| 5 | en | news explainer | 80 | 20 | five triads, three negation pivots, anadiplosis lede, identical opener slot, bookend kicker, BrE/AmE mix |
| 6 | en | opinion essay | 85 / 80 | 40 | eight turned phrases in 450 words, maxim anaphora, canonical-two citations, no first person, dash blackout |
| 7 | ja | popular science | 60 | 30 | capsule outline, ASCII spacing, compass illustration contradicting its own claim, fused 1966/1972 attribution |
| 8 | fr | cultural feature | 60 | — | four-for-four antithesis engine, décret conflation, unnamed collective kicker, reportage without reporting |
| 9 | de | business explainer | 22 | — | "begleichen" synonym rotation, aphoristic coda; otherwise native |
| 10 | es | biographical sketch | 35 | — | device-stacked closer, zero rayas, outsourced aesthetic judgment |

Re-score: the four worst-scoring pieces, revised against every accepted flag, were re-scored blind by a fifth reviewer who was not told they were revisions. Average dropped from roughly 71 to 30, the corrected mechanism, dates and legal clauses all passed the fresh anchoring check, and the deliberately human touches (a deflationary vernacular kicker, "argued about" rather than "argued for", a ちなみに aside) were quoted as evidence of a human hand.

Agreement on the double-reviewed pieces was high: 55/70 and 85/80, with the same passages quoted independently. One reviewer also compared their three assigned texts and named the portfolio fingerprint unprompted: same four-paragraph architecture, same lede type, same cadenced buttons, "one generating process behind different masks."

### Findings, round three

20. **Writing to the rules does not neutralize the author's tics.** Five triads and three negation pivots appeared in one 430-word piece drafted under a no-triads, one-contrast rule; an essay believed to hold two aphorisms held eight. The census exists because the drafting mind cannot see its own output; it must be run, not remembered.
21. **Turned phrases of every shape are the aphorism.** Chiasmus, mirrored re-description, paired-verb balance and "X dressed up as Y" all landed as quotables with reviewers; counting only verdict-punchlines undercounts fourfold, and "zero duds" was itself quoted as evidence of machine polish. Tell 13 widened accordingly.
22. **The scrub is visible.** Reviewers independently described dash blackouts with semicolon inflation, comma splices doing dash work, colloquialism rationed one-per-paragraph, endings that "perform plainness", and one summarized a piece as "prose written under an anti-AI blacklist". The zero-target gate of rounds one and two was wrong; the target is the genre's natural distribution. This became the scrub layer and rewrote method step 9.
23. **Genre needs material, and its absence is legible.** The reportage with no scene and the journalism with no quote were both flagged; one reviewer noted that models under a factual-accuracy instruction produce quoteless journalism precisely because they will not invent a voice. Tell 21.
24. **Retrieval regresses to the canon.** Single-source greatest hits, exactly the two most-probable citations with no oddball third, default arcs, default title shapes, and the adjacent famous fact swapped in where the precise one belongs — flagged across three languages. Tell 22.
25. **Fluent wrongness is the deepest tell.** The Japanese piece "demonstrated" an inclination compass with a polarity flip the mechanism should ignore, and fused the 1966 Merkel–Wiltschko result with the couple's later inclination experiments into one date; the French piece welded a neighboring legal definition into the 1993 décret. All three read perfectly. Verification joined the method as its own pass (step 7), because a reader who catches one such error re-reads everything else as synthetic.
26. **Typography betrays the pipeline.** ASCII–CJK half-width spacing in Japanese print register and a BrE date beside AmE spelling were flagged as machine conventions independent of prose quality. Tell 24.
27. **Positive human markers exist.** Reviewers read deliberately broken symmetry (a two-way diagnostic with an asymmetric third cause), an opinionated aside with an edge, a lived detail, and unrepaired grammatical looseness as evidence of a human hand. These entered Do-not-overcorrect as techniques to use sparingly, never mechanically.
28. **Language-relative budgets.** The Spanish reviewer flagged the total absence of rayas, the German reviewer the absence of Gedankenstriche, in the same batch where English dash removal was the fix. One number cannot govern six languages; the budgets moved into `language-cues.md`.
29. **Revision against flags works, and what survives is instructive.** The blind re-scores fell from ~71 to 30 average, but the residual flags name the next frontier: cleft series used as a piece's sole engine (three 「〜したのは〜だ」 priority-clefts; twin ……的是X clefts on consecutive paragraphs), matched-numeral ring symmetry (the 2/9 anecdote closing as "nine weeks … looked like two"), and one escalating negative triad the author had been flagged on and kept anyway because it was good. The census must outrank the author's affection: a flagged pattern kept for its quality is still a flag.
30. **Earned instances get cleared.** The re-reviewer explicitly considered and cleared two AではなくB frames because each carried the actual experimental contrast, and passed the one-per-piece corrective turns elsewhere. The budgets in tells 1, 2 and 13 calibrate to what independent readers accept; the rules survive contact when the kept instance is load-bearing.
