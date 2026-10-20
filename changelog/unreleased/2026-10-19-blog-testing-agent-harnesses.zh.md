# 博客文章：用 Coding Agent 自动检查 Harness 的性能

- **Date:** 2026-10-17
- **Type:** process
- **Scope:** `landing`
- **PR:** [#1186](https://github.com/Prism-Shadow/penguin-harness/pull/1186)

[English](2026-10-17-blog-prompt-cache.md)

博客新增一篇中英文技术文章，介绍让每个模型请求都延续上一个请求的测试体系，即 `packages/core` 里的三个 `prompt-cache-*` 测试集。文中的图是直接写在 Markdown 里的内联 SVG，样式来自落地页样式表中新增的类。

## 细节

- `keeping-the-prompt-cache-hot` 篇幅短、以图为主。它讲为什么缓存未命中必须让测试失败，以及 [#722](https://github.com/Prism-Shadow/penguin-harness/pull/722) 加入的测试体系依据的原理（录下每个请求，再由字节级诊断器和按 Anthropic 规则构建的缓存模拟器各读一遍），然后按缓存命中率和输入成本对比四个设计选择：系统提示词里的时间戳、上下文中途改动工具、恢复时重建历史，以及 [#700](https://github.com/Prism-Shadow/penguin-harness/pull/700) 修复的压缩请求回归。结尾给出运行这些测试集的命令。
- 文中有七张绘制的图：按缓存状态着色的请求条、测试体系的流程图、请求的块顺序及每种改动得到的诊断，以及四组布局和比例尺都相同的前后对照图。每个 SVG 都使用所在语言的文字，带有标题和一份内容相同、视觉上隐藏的文字列表。图表和文中的失败报告，都由测试集自带的辅助模块和模拟器的一次运行生成，结果确定，没有调用任何模型 API。
- `packages/landing/src/styles.css` 新增了 `.post-figure` 和 `.fig-*` 类：每种缓存状态（读取、写入、重复写入）使用站点调色板里的一种颜色，并带有 `html.dark` 变体，图会跟随主题切换。
- 落地页博客测试把新文章列在技术实践分类的首位。
