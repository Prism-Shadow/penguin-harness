# 聊天 Markdown：收尾标点之后的粗体可以闭合

- **Date:** 2026-11-16
- **Type:** fix
- **Scope:** `chat-markdown`
- **PR:** [#1568](https://github.com/Prism-Shadow/penguin-harness/pull/1568)
- **Issue:** [#1500](https://github.com/Prism-Shadow/penguin-harness/issues/1500)

[English](2026-11-16-chat-bold-after-punctuation.md)

紧跟在 `. , : ; ! ? ) ] }` 之后的两个及以上 `*`，即使其后直接是字母或数字也能闭合粗体：`**Confirmed.**Next sentence.` 与 `**端口:**7364` 显示为粗体，不再露出星号；回复流式输出越过这个 `**` 时，粗体也不再变回星号。凡按聊天方言读回复的地方都遵循这条规则：Web App 与聊天渠道。

## 细节

- 左括号或引号之后的 `**`、单个 `*` 与 `_` 照旧解析，`f(**kwargs)`、`snake_case` 保持原样。
- `(a+b)**2 and (c+d)**3` 这类正文现在会在两处 `**` 之间配成粗体。
