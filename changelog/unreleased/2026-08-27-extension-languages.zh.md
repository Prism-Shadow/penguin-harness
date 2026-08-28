# 扩展带来语言，索引也不再只有内置的那份

- **Date:** 2026-08-27
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#526](https://github.com/Prism-Shadow/penguin-harness/pull/526)

[English](2026-08-27-extension-languages.md)

扩展现在可以贡献一份语法高亮语法，扩展市场页列出的也不再只是 server 包自带的内容。首个语言扩展 `@prismshadow/penguin-extension-languages` 带来 **Typst、Swift、Kotlin、C# 与 Dart**。

## 细节

- **`iface.languages.register({id, displayName, aliases, extensions, grammar})`**，与相邻的 sandbox 层一样在 `initialize` 时下发。`LanguageContribution` 与 `LanguageRegistry` 属于 `@prismshadow/penguin-core/extension` 中那份封闭的扩展契约，理由与 sandbox 词汇相同：语言扩展只针对这些名字编写，而存放与提供语法的那个服务留在 harness 一侧。注册写入随每个 App 一同构建的服务——因此被热推送移除的扩展所带的语言会立即停止提供，而不是残留到进程重启。
- **`GET /api/languages`** 列出已注册的内容但不含语法本体，**`GET /api/languages/:id/grammar`** 提供其中一份并缓存一小时：单份语法有几十到上百 KB，只有对话真正出现过的语言才值得取回，而语法不会在同一个 App 内改变——新的 App 就是一次新的页面加载。围栏别名与文件扩展名在语法**载入之前**就已到达 App：Shiki 只有在语法载入之后才会注册它自带的别名，而围栏信息串恰恰是决定要不要载入它的东西。语法在首次绘制之后才到达，因此已经显示在屏幕上的代码块会在它们到位时**重新高亮**，而不是在这一页的余生里保持无色。
- 扩展带来的语言**无法覆盖内置语言**，无论按 id 还是按别名：内置语法是针对当前 Shiki 版本构建并验证过的那份 chunk，让扩展悄悄替换掉 `typescript` 不是可接受的交易。语法是**数据而不是代码**——一份由 Shiki 的 JavaScript 正则引擎解释的文档——因此从扩展到浏览器这条路径上，没有任何环节会执行它所携带的东西。该引擎并非 oniguruma：依赖 oniguruma 专有构造的语法会编译失败，其代码块渲染为无高亮。这五份语法从 `@shikijs/langs` 转出——App 自身的语法也来自这个包——因此每一份都与内置路径会载入的文档完全一致。
- **`GET /api/extensions` 合入了已发布的索引**——由 `penguin-extensions` 仓库发布的那份——与内嵌在 server 包中的条目并列。该文档是**固定 tag 上的 release 附件**，`releases/download/nightly/index.json`，而不是一次 GitHub API 查询：该 tag 从不重新指向，索引仓库里每 6 小时运行一次的工作流替换的是它上面的附件，因此「最新 nightly」是一个由发布方解析的名字，读取它不消耗该部署与同一出口地址下所有人共享的匿名 API 配额。**每 30 分钟最多抓取一次**，并发读取共用同一次请求，刷新失败时继续提供上一份成功的文档。
- **某个来源失败只会让列表变短，而不会让它变空。** 响应中带有 `failures` 数组，逐一列出读不到的来源，页面在列表上方渲染一条提示——一个悄悄变短的列表会被读成「那个扩展不存在」。这与单个文档*内部*的规则刻意不同：那里一行格式错误仍然会让整份产物失败。`name@version` 冲突时靠前的来源胜出，且内置注册表排在最前：一个部署实际交付了什么，它自己说了算。**`PENGUIN_EXTENSION_INDEX`** 不设置即读取已发布的索引；`off` 完全关闭该查询、不发起任何出网请求（与 `PENGUIN_UPDATE_CHECK=off` 给版本检查的形态一致）；填其他值则替换该 URL，供 fork 或私有索引使用。
