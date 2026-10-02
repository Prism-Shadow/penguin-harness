# 插件贡献的语言，以及内置之外的索引

- **Date:** 2026-08-27
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#526](https://github.com/Prism-Shadow/penguin-harness/pull/526)

[English](2026-08-27-extension-languages.md)

插件现在可以贡献语法高亮的语法，插件页列出的也不再只是 server 包自带的内容。本仓库只提供贡献点；第一个语言插件（Typst、Swift、Kotlin、C#、Dart）作为外部插件放在自己的仓库 [Myriad-Dreamin/penguin-plugin-languages](https://github.com/Myriad-Dreamin/penguin-plugin-languages)。

## 细节

- **贡献点：**插件通过 `LanguagesModule.grammars` 槽贡献 `{language, displayName, aliases?, extensions?}` 以及对应的 TextMate 语法。类型 `LanguageContribution` 与 `LanguageGrammar` 在 `@prismshadow/penguin-core/plugin` 里。存放和提供语法的服务随每个 App 构建，插件不再加载后，它的语言也随之不再提供。
- **接口：**
  - `GET /api/languages` 列出贡献的语言，不带语法。
  - `GET /api/languages/:id/grammar` 提供单份语法，缓存一小时。
  - App 先拿到别名与文件扩展名，再拿语法，因为决定是否加载某份语法的正是代码块的 info string。语法到达后，已在屏幕上的代码块会重新高亮。
- **语法是数据：**贡献的语言不能按 id 或别名覆盖内置语言。语法是 Shiki 的 JavaScript 正则引擎解释的文档，这条路径不会执行插件提供的任何东西。依赖 oniguruma 独有构造的语法会编译失败，相应代码块不高亮显示。
- **公开索引：**`GET /api/plugins/registry` 把公开索引与 server 包内置的条目合并，返回 `{plugins, failures}`。
  - 公开索引是固定 tag 上的 release 附件（`releases/download/nightly/index.json`），最多每 30 分钟抓取一次；并发读者共用一次请求，刷新失败时继续提供上一份完好的文档。
  - 读不到的来源列入 `failures`，只让列表变短、不会让它变空；但在单个文档内部，一行格式错误仍会让整份文档失败。
  - `name@version` 冲突时以内置条目为准。
  - `PENGUIN_PLUGIN_INDEX=off` 关闭查询、不发出任何请求；其他值替换 URL。
