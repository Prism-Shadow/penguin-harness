# 开发与调优文案轮换标题

- **Date:** 2026-08-31
- **Type:** feature
- **Scope:** `landing`
- **PR:** [#560](https://github.com/Prism-Shadow/penguin-harness/pull/560)

[English](2026-08-31-landing-rotating-headline.md)

为首页主标题加入了轮换文案：中文在「自动开发」与「自动调优」之间切换，英文对应 “auto-dev” 与 “auto-tuning”。

## 标题动画

- 高亮文案每三秒切换一次，配合短暂的淡入淡出与纵向位移。
- 为两段文案预留了共同的占位空间，保持周围标题布局稳定。
- 为屏幕阅读器提供了包含两段文案的静态文本，并在启用减少动态效果时同时显示两段文案。
