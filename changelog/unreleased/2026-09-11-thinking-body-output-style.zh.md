# 思考与压缩正文按输出呈现，不再是引用样式

- **Date:** 2026-09-11
- **Type:** fix
- **Scope:** `web`
- **PR:** [#694](https://github.com/Prism-Shadow/penguin-harness/pull/694)

[English](2026-09-11-thinking-body-output-style.md)

## 详情

- 展开的思考块与压缩横幅的两个小节此前缩在一只带底色的圆角框里——对话区用来表示引用的形
  状——字号还比紧邻其上的工具输出大一档。现在它们与展开的 `exec_command` 输出同款：整宽贴
  在所属行下、用同一条分隔线与行分开、同为 `text-xs` 字号与同一套字色。两处正文仍按
  Markdown 渲染，也都不套用输出块的高度上限：它们是流式产出的，内嵌滚动框会把对话区自身跟
  随滚动的那截尾巴关在里面。
