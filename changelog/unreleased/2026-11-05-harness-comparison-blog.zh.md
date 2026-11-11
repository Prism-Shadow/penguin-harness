# Harness 横评实验博客

- **Date:** 2026-11-05
- **Type:** process
- **Scope:** `landing`
- **PR:** [#1484](https://github.com/Prism-Shadow/penguin-harness/pull/1484)

[English](2026-11-05-harness-comparison-blog.md)

新增了中英文实验博客，对比 PenguinHarness、DSH、Pi 和 Codex 在五个任务子集上的三轮运行结果。

## 细节

- 新增中英文实践博客，覆盖主稿全部六节正文，包括两个单题案例分析。
- 将文章加入实践博客索引，署名为 Zhihao Liu (Prism Shadow AI)。
- 按飞书主稿同步中文内容，并将标题、实验 Prompt、表格、图注和替代文本译为英文。
- 每种语言通过 `/blog-assets/` 引用对应的 13 张配图，图片文件存放于 `penguin-harness-community`。
- 登记全部 26 张图片的尺寸，并从主仓移除本篇博客的图片文件。
- 介绍题目筛选、三步复现流程、通过频次、单题稳定性和资源开销。
- 分析 DSH 修复存储引擎时的自测过程，以及在表格脱敏任务中反复局部调参的行为。
