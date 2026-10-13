# 向后兼容：画廊记住的明暗与语言

- **Date:** 2026-10-13
- **Type:** process
- **Scope:** `ui-gallery`
- **PR:** [#1101](https://github.com/Prism-Shadow/penguin-harness/pull/1101)

[English](2026-10-13-backward-compatibility-gallery-prefs.md)

画廊原先把明暗与语言记在浏览器里自己的两个键下：`penguin-gallery.mode` 与 `penguin-gallery.lang`。换用[站点导航栏](2026-10-13-gallery-site-nav.zh.md)后，这两项归站点所有，与落地页、文档站一样记在 `penguin-site.theme` 与 `penguin-site.lang` 下。

## 生效范围

两个站点键都为空时，画廊仍会读取它原来的两个键，老读者再来时，明暗与语言还是上次在画廊里选的。不再有任何代码写入旧键；三个站点中任何一个写入站点键后，以站点键为准。读者无需操作。

## 移除条件

0.3.0 发布准备时，由准备发布的人移除 `rememberedPrefs`（`packages/ui-gallery/src/lib/url-state.ts`）里对旧 `mode`、`lang` 的回退及对应的测试场景。届时只有旧键的读者会按系统的明暗与语言打开一次。
