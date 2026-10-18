# 关于提示词缓存持续命中的博客文章

- **Date:** 2026-10-17
- **Type:** process
- **Scope:** `landing`
- **PR:** [#1186](https://github.com/Prism-Shadow/penguin-harness/pull/1186)

[English](2026-10-17-blog-prompt-cache.md)

博客新增一篇中英文技术文章，介绍让每个模型请求都延续上一个请求的测试体系，即 `packages/core` 里的三个 `prompt-cache-*` 测试集。文中的图是直接写在 Markdown 里的内联 SVG，样式来自落地页样式表中新增的类。

## 细节

- `keeping-the-prompt-cache-hot` 讲为什么缓存未命中必须让测试失败，[#722](https://github.com/Prism-Shadow/penguin-harness/pull/722) 加入的测试体系怎么设计（录制器、缓存未命中诊断器、按 Anthropic 规则构建的模拟器、`expectHits` 和三个测试集），贡献者怎么运行它、怎么读它的报告，它测出了什么，最后把 [#700](https://github.com/Prism-Shadow/penguin-harness/pull/700) 修复的压缩请求回归从头到尾重放一遍。
- 文中有八张绘制的图：按缓存状态着色的请求条、模拟器里的块顺序及每种改动得到的诊断、测试体系的流程图、14 个 Session 场景、9 个故意注入的反模式加一个对照组和两种断点位置的图表，以及以前后对照方式呈现的 #700 重放和拆开来看的那个压缩请求。每个 SVG 都使用所在语言的文字，带有标题和一份内容相同、视觉上隐藏的文字列表。图表和文中的两份失败报告，都由测试集自带的辅助模块和模拟器的一次运行生成，结果确定，没有调用任何模型 API。
- `packages/landing/src/styles.css` 新增了 `.post-figure` 和 `.fig-*` 类：每种缓存状态（读取、写入、重复写入）使用站点调色板里的一种颜色，并带有 `html.dark` 变体，图会跟随主题切换。
- 落地页博客测试把新文章列在技术实践分类的首位。
