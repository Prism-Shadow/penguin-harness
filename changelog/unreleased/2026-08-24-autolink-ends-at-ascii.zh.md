# 裸链接在 URL 结束处终止，而不是在句子结束处

- **Date:** 2026-08-24
- **Type:** fix
- **Scope:** `web`
- **PR:** [#PLACEHOLDER](https://github.com/Prism-Shadow/penguin-harness/pull/0)

[English](2026-08-24-autolink-ends-at-ascii.md)

写在中文行文里的 URL 会把后面的内容一并吞掉：`见 https://penguin.ooo，然后继续` 会把逗号及其后的
半句话一起链接进去，于是链接 404，句子的标点也被套上了链接样式。Web App 的 Markdown 渲染现在让裸
链接在最后一个 ASCII 字符处终止。

## 细节

- GFM 的 autolink literal 以空白作为裸链接的终止，再裁掉少量结尾的 ASCII 标点。两条规则都不认识
  CJK，因此 `，`、`。`、`（）` 以及紧贴主机名的中文文字都留在了 href 里。英文从来不受影响——
  `see https://penguin.ooo, then` 本就正确终止。
- 边界取最后一个 ASCII 字符：按 RFC 3986，URL 本就是 ASCII；结尾的非 ASCII 片段会作为文本交还给段落。
- 显式的 `[文档](https://…)` 链接不受影响：裁剪只作用于链接文字即 URL 本身的 autolink。
- 五个 Markdown 渲染入口——对话消息、两处 Trace 事件视图、Benchmark 用例浏览器与工作区文件预览——
  现在共用同一份插件列表，因此裸链接在每个界面上的终止位置一致。
- 路径中携带**未编码** CJK 的 URL 会在最后一个 ASCII 字符处被截断。该写法本就不符合 RFC；同一链接
  经百分号编码后不受影响。
