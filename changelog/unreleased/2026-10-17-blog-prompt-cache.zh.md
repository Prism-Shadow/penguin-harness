# 关于提示词缓存持续命中的博客文章

- **Date:** 2026-10-17
- **Type:** process
- **Scope:** `landing`

[English](2026-10-17-blog-prompt-cache.md)

博客新增一篇中英文技术文章，介绍 PenguinHarness 如何让每个模型请求都延续上一个请求，以及 `packages/core` 里的三个 `prompt-cache-*` 测试集如何抓住破坏这一点的改动。

## 细节

- `keeping-the-prompt-cache-hot` 介绍了按 Anthropic 文档规则运作的供应商前缀缓存、让请求只追加的引擎规则、[#700](https://github.com/Prism-Shadow/penguin-harness/pull/700) 修复的压缩请求 Bug（这套测试正是由它引出），以及 [#722](https://github.com/Prism-Shadow/penguin-harness/pull/722) 加入的录制器、缓存未命中诊断器、按 Anthropic 规则构建的模拟器和 Session 生命周期测试的设计。
- 文中的实验表格（14 个 Session 生命周期场景、9 个故意注入的反模式加一个对照组、断点位置对比）都用测试集自带的辅助模块和模拟器生成，结果确定，没有调用任何模型 API。
- 落地页博客测试把新文章列在技术实践分类的首位。
