# 观点文章：vibe coding 时如何立住规矩

- **Date:** 2026-10-19
- **Type:** process
- **Scope:** `landing`
- **PR:** [#1234](https://github.com/Prism-Shadow/penguin-harness/pull/1234)

[English](2026-10-19-blog-rules-for-vibe-coding.md)

博客新增一篇观点文章，中英文各一份，讲怎样让 AI 写出的代码不越界：把 Agent 必须遵守的约束分三层写进仓库（人的规矩、接口抽象、可复用组件），其中的硬约束由代码和测试守住。

## 细节

- `rules-for-vibe-coding` 配有五张以内联 SVG 绘制的插图，使用共享的插图样式：三层约束、一条硬规矩从编号原则到测试断言的落地路径、Agent State 目录树、`context_engine` 周围的边界，以及复用优先的判断流程。
- 落地页博客测试把这篇文章列为观点类的第一篇。
