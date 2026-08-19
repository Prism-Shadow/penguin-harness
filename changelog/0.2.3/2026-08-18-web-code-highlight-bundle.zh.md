# Web App：代码高亮去掉 WASM 引擎与完整语法注册表

- **Date:** 2026-08-18
- **Type:** refactor
- **Scope:** `web`
- **PR:** [#300](https://github.com/Prism-Shadow/penguin-harness/pull/300)

[English](2026-08-18-web-code-highlight-bundle.md)

一段对话渲染的第一个代码块，此前要先拉取约 308 KB gzip 的高亮器才能给出第一个着色 token；现在只拉取约 69 KB。

## 变更内容

聊天代码块与工作区源码视图不再导入 `shiki`（它的完整打包）（[#300](https://github.com/Prism-Shadow/penguin-harness/pull/300)）。高亮器改为基于 `shiki/core` 以一份显式语言清单组装，而 oniguruma 的 WASM 引擎被 Shiki 的纯 JavaScript 正则引擎取代。

完整打包的开销不在语法上——那些本就按语言惰性加载、每种语言一个分块——而在于两样无论什么语言都会随**第一个**代码块一起加载的东西：WASM 引擎（原始 622 KB / gzip 230 KB），以及描述全部 332 种内置语法的注册表。

在本应用上实测，以第一个 TypeScript 代码块为例：

| | 之前 | 之后 |
| --- | --- | --- |
| 高亮器内核 | 62.08 KB | 48.25 KB |
| 正则引擎 | 230.29 KB（WASM） | — |
| 主题 | 含在内核中 | 5.06 KB |
| `typescript` 语法 | 16.04 KB | 16.04 KB |
| **第一个代码块** | **约 308 KB** | **约 69 KB** |
| `dist/` 总量 | 11 MB，304 个分块 | 3.3 MB，29 个分块 |

（均为 gzip；主入口分块增大 0.85 KB，用于现在无需加载高亮器即可解析的扩展名与别名表。）

这个 JavaScript 引擎是等价替换而非近似：全部 332 种内置语法中的 220,772 条 TextMate 模式全部成功转换为 JavaScript 正则，无一失败；而在抽样语言（TypeScript、C++、shell、PHP、Ruby、Python、Markdown、HTML）上，它的 token 输出与 oniguruma 逐字节一致。

## 代价

只有 `code-languages.ts` 中列出的语言会被高亮——即工作区浏览器按文件扩展名映射的那 23 种，加上 `diff`。用该清单之外的语言（`swift`、`kotlin` 等）标注的代码块会渲染为未高亮的等宽文本，而完整打包本会给它上色。新增一种语言只需一行，而同一个文件也承载着决定去取哪份语法的围栏别名（` ```ts `、` ```bash `），因此一次引入了新别名的 Shiki 升级需要在那里补一行，否则该围栏会不再高亮。

未变之处：两种主题仍由同一遍高亮以 CSS 变量形式提供，因此明暗切换绝不会重新高亮；未标注语言的围栏与未映射的文件扩展名仍渲染为带主题的纯文本；消息流式输出期间仍然跳过高亮。
