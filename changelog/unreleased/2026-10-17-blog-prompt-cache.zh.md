# 关于提示词缓存持续命中的博客文章

- **Date:** 2026-10-17
- **Type:** process
- **Scope:** `landing`
- **PR:** [#1186](https://github.com/Prism-Shadow/penguin-harness/pull/1186)

[English](2026-10-17-blog-prompt-cache.md)

博客新增一篇中英文技术文章，介绍 PenguinHarness 如何让每个模型请求都延续上一个请求，以及 `packages/core` 里的三个 `prompt-cache-*` 测试集如何抓住破坏这一点的改动。文中的图是直接写在 Markdown 里的内联 SVG，样式来自落地页样式表中新增的类。

## 细节

- `keeping-the-prompt-cache-hot` 从测量到根因，完整追溯了 [#700](https://github.com/Prism-Shadow/penguin-harness/pull/700) 修复的压缩请求 Bug，然后介绍让请求只追加的引擎规则，以及 [#722](https://github.com/Prism-Shadow/penguin-harness/pull/722) 加入的测试体系：录制器、缓存未命中诊断器、按 Anthropic 规则构建的模拟器和 Session 生命周期测试。
- 文中有七张绘制的图：按缓存状态着色的请求条、以前后对照方式呈现的 #700 重放、拆开来看的那个压缩请求、测试体系的流程图，以及 14 个 Session 场景、9 个故意注入的反模式加一个对照组、两种断点位置的图表。每个 SVG 都使用所在语言的文字，带有标题和一份内容相同、视觉上隐藏的文字列表。图表由实验输出生成，而实验用的是测试集自带的辅助模块和模拟器，结果确定，没有调用任何模型 API。
- `packages/landing/src/styles.css` 新增了 `.post-figure` 和 `.fig-*` 类：每种缓存状态（读取、写入、重复写入）使用站点调色板里的一种颜色，并带有 `html.dark` 变体，图会跟随主题切换。
- 落地页博客测试把新文章列在技术实践分类的首位。
