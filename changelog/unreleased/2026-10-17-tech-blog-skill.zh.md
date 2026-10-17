# 一个用于撰写技术博客的 skill

- **Date:** 2026-10-17
- **Type:** process
- **Scope:** `skills`
- **PR:** [#1188](https://github.com/Prism-Shadow/penguin-harness/pull/1188)

[English](2026-10-17-tech-blog-skill.md)

新增仓库开发 skill `.agents/skills/penguin-harness-tech-blog/SKILL.md`，用于 landing 博客上的工程深度文章，以
Modal 的 [Building fast filesystems for VMs](https://modal.com/blog/vm-sandbox-filesystem) 为参考范文。该 skill 从这篇文章中提炼了：

- 章节顺序：开篇以一句交代本文范围的话收尾，可选的 TL;DR，然后依次是背景、直觉方案、推翻方案的测量、点明代价的重新设计、实现、以朴素方案为基线的结果，以及简短的结尾；
- 每节的篇幅预算；
- 图的规则：每篇都要画图。框图和图表以内联 SVG 写在文章的 Markdown 里，参照 MMSP 文档中 agent loop 的流程图：样式类同时适配深浅主题，图中文字随各语言文件，并附隐藏的文字版。只要每个图形元素都承载信息，欢迎画得更有表现力。先由正文引出再放图，改造前后的图采用同一版式，图注写明带数字的结论；
- 数字的写法：带单位，比值写出两端的值，基线要真实，并用一句话交代测量方法，包括数字来自模拟器还是线上服务商；
- 中英文两篇各自的文风规则。

该 skill 还说明了如何用模型逐节润色，并列出开 PR 前的检查清单。

`penguin-harness-dev` 的 `reference/authoring.md` 现在把技术文章指向这个 skill，两份 README 也把它列入开发用 Skill。
