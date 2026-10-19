# writing Skill 新增技术文章的 practice profile

- **Date:** 2026-10-19
- **Type:** process
- **Scope:** `skills`
- **PR:** [#1188](https://github.com/Prism-Shadow/penguin-harness/pull/1188)

[English](2026-10-19-practice-writing-profile.md)

`penguin-harness-writing` Skill 新增 `reference/profile-blog-practice.md`，作为技术文章（`--profile blog-practice`，博客分类 `practice`）的 profile。写这类文章时，Skill 的脚本在每一步都把 profile 的提示词块发给网关模型，中文文本则发送其中的中文块。profile 规定了：

- 两种结构，各带分节字数，整体篇幅短、以图为主。一种是改动的故事，章节顺序取自 Modal 的 [Building fast filesystems for VMs](https://modal.com/blog/vm-sandbox-filesystem)：顺理成章的方案、推翻它的测量、点明代价的重新设计、以朴素方案为基线的结果。另一种介绍我们做出的系统：它为什么存在、它的原理、三到四组没采用与采用的设计对比，最后给出运行命令和文档链接；
- 数字怎么用：带单位，比值写出两端的值，基线要真实，用一句话交代测量方法并说明数字来自模拟器还是线上服务商，FACTS 里没有的数字和比值一律不用；
- 模型写的图块要包含什么：一张讲机制的框图，每项测量一张图表，镜像对照共用版式和刻度，图注写明带数字的结论；
- 在中英文文风指南之上的语气规则，其中允许在转折处用一个设问。

它的检查设置允许 6 到 9 节，要求有导语，并允许 TL;DR。两份 README 把 `penguin-harness-writing` 列入开发用 Skill。
