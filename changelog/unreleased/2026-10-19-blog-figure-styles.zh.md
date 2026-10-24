# 博客文章可以放入以内联 SVG 绘制的插图

- **Date:** 2026-10-19
- **Type:** feature
- **Scope:** `landing`
- **PR:** [#1217](https://github.com/Prism-Shadow/penguin-harness/pull/1217)

[English](2026-10-19-blog-figure-styles.md)

落地页样式表新增一组共享样式，供博客文章在 Markdown 里以内联 SVG 绘制插图。一张插图写成一行 `<figure class="post-figure">`，即在浅色与深色主题下使用站点调色板；在手机上保持可读的尺寸，在正文栏内横向滚动；并以一个视觉上隐藏的列表把内容再给一遍，供屏幕阅读器读取。

## 细节

- 图中的图形一律以类名取色，不写内联颜色：文字（`fig-title`、`fig-label`、`fig-note`、`fig-tick`、`fig-num`、`fig-code`）、流程图（`fig-box`、`fig-terminal`、`fig-edge`、`fig-arrowhead`）、辅助线（`fig-axis`、`fig-bracket`、`fig-link`、`fig-marker`），以及三种系列填充（`fig-s1`、`fig-s2`、`fig-s3`）。每个系列的含义由文章的图例说明，并在这篇文章的所有插图中保持不变。
- 三个系列不靠颜色也能区分：实心、浅色带描边、中度琥珀色带虚线边。
- 新增一条测试，确认单行插图以元素形式到达页面：是 HTML 块而不是行内 HTML，SVG 属性保持原有大小写，隐藏列表与图注完整保留。
