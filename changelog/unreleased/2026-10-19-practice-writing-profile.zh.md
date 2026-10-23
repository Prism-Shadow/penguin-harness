# writing Skill 新增技术文章的 practice profile

- **Date:** 2026-10-19
- **Type:** process
- **Scope:** `skills`
- **PR:** [#1188](https://github.com/Prism-Shadow/penguin-harness/pull/1188)

[English](2026-10-19-practice-writing-profile.md)

`penguin-harness-writing` Skill 新增 `reference/profile-blog-practice.md`，作为技术文章（`--profile blog-practice`，博客分类 `practice`）的 profile。写这类文章时，Skill 的脚本在每一步都把 profile 的提示词块发给网关模型，中文文本则发送其中的中文块。profile 规定了：

- 议论文的写法：一篇技术文章是一篇完整的议论文，段落前后相连。导语提出全文要辩护的设计主张，并说明它和读者的关系；每一节论证一个分论点，给出推理和论据，并把没采用的设计当作反方来回应；结尾回到论点，说明它对读者意味着什么。正文不用列表和表格，图支撑它前面的那一段，不代替段落；
- 按论证顺序排列的两种结构。一种是改动的故事，章节顺序取自 Modal 的 [Building fast filesystems for VMs](https://modal.com/blog/vm-sandbox-filesystem)：测出来的问题、被测量推翻的顺理成章的方案、点明代价的重新设计、作为证明的结果。另一种介绍我们做出的系统：它为什么非有不可及其原理，两到三个用同一指标回应没采用设计的论证，最后给出运行命令和文档链接；
- 数字怎么用：带单位，比值写出两端的值，基线要真实，用一句话交代测量方法并说明数字来自模拟器还是线上服务商，FACTS 里没有的数字和比值一律不用；
- 模型写的图块要包含什么：一张讲机制的框图，每项测量一张图表，镜像对照共用版式和刻度，图注写明带数字的结论；
- 在中英文文风指南之上的语气规则，其中允许在转折处用一个设问；
- 引用：多数句子不带引用，需要引用的是第三方的数字、原话引述和我们自己的测量。

它的检查设置写明了 practice 的篇幅预算：4 到 5 节；正文最多 750 个英文词（中文 1,800 字）；导语 50 到 90 词；论证小节 100 到 170 词，结尾 60 到 100 词（每节上限 170 词，中文 400 字）；可选的 TL;DR 30 到 50 词。已发布的 practice 文章引用 8 到 13 个来源，`body-lists: none` 和 `body-tables: none` 让正文里的列表或表格报错。Skill 的 `review` 按同样的写法审阅 practice 文章：标出的关键句和「先摆出反方再回应」都在预期之中，也不会要求在正文里用列表。`trim` 只把 practice 文章里超过上限的节删到略低于每节 170 词（中文 400 字）的上限，不压到计划篇幅，保留每个数字，模型动过的图块也会换回原样。两份 README 把 `penguin-harness-writing` 列入开发用 Skill。
