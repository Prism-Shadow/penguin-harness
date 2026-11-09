# 文档语言标记跟随界面语言

- **Date:** 2026-10-16
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1212](https://github.com/Prism-Shadow/penguin-harness/pull/1212)

[English](2026-10-16-html-lang-follows-ui.md)

文档根的 `lang` 属性现在与界面语言一致，英文界面按英文宣告。此前无论屏幕上是英文、中文还是「跟随系统」，它都写着 `zh-CN`：那是 `index.html` 里的静态字面量，应用内没有任何地方改写它——读屏软件因此宣告错误的语言，浏览器翻译与断词启发也把每一页当作中文。

## 细节

- 生效语言（`en` 或 `zh`；「跟随系统」先按设备语言解析成两者之一）在与切换活动词典的同一轮渲染里写到文档根，切换与 reload 之后标记都与屏幕上的文字一致。
- `zh` 宣告为 `zh-CN`（简体中文词典），`en` 宣告为不带地区的 `en`。
- 写入经由 `applyDocumentLang(document, locale)`：一个以文档为参数的小导出函数，node 环境的单测因此无需 DOM 就能覆盖取值口径与写入本身。
