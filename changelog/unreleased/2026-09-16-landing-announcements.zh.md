# 落地页公告栏换上新的 Flash 模型与 Penguin Go

- **Date:** 2026-09-16
- **Type:** feature
- **Scope:** `landing`
- **PR:** [#747](https://github.com/Prism-Shadow/penguin-harness/pull/747)

[English](2026-09-16-landing-announcements.md)

落地页导航栏上方的轮播公告栏撤下了 GLM-5.3 Flash 与 Qwen 3.8 Flash 的公告，以及 AMD 开发者计划 Fireworks API 额度的公告，换上两条新公告，中英双语。

## 细节

- 第一条为「DeepSeek V4.1 Flash 与 Gemini 3.8 Flash 现已在 PenguinHarness 上线」，链接到同时介绍这两款模型的 0.2.11 发布博文 `/blog/penguinharness-0-2-11`，沿用字典键 `flashModels`。
- 第二条为「Penguin Go 官方 Token 包上线，Gemini 全系列模型 5 折」，链接到 Penguin Go 站点 `https://token.penguin.ooo/`；其字典键 `penguinGo` 在 `strings.ts` 与 `strings-en.ts` 中取代了 `fireworks`。
- 公告可以链接到站外。公告列表从 `announcement-bar.tsx` 移到了 `src/lib/announcements.ts`，每条公告恰好带 `to` 与 `href` 之一：`to` 是经路由跳转的博客路径，`href` 是 `https://` 地址，渲染为在新标签页打开的普通链接（`target="_blank"`、`rel="noopener noreferrer"`），样式、箭头以及焦点与 `tabIndex` 处理与博客链接一致。两者都带或都不带的条目通不过条目类型的检查。
- 新增落地页测试 `test/announcements.test.ts`：对公告栏上的每个博客链接，用 `getPost` 分别按 `en` 与 `zh` 查找对应博文，任一查找找不到博文或回退到另一种语言即失败。
