# 所有 Markdown 界面渲染 LaTeX 公式

- **Date:** 2026-08-26
- **Type:** feature
- **Scope:** `web`

[English](2026-08-26-markdown-math.md)

Markdown 正文改用 KaTeX 渲染数学公式。渲染管线是共用的，因此对话消息、Trace 事件、Benchmark 用例与
Workspace 文件预览同时具备该能力。

## 细节

- 识别四种分隔符：`\[…\]` 与 `$$…$$` 渲染为独立成块的公式，`\(…\)` 渲染为行内公式。模型最常输出的
  TeX 方括号形式由一个 micromark 语法扩展解析（`packages/web/src/lib/remark-math-brackets.ts`），
  这使其不会侵入行内代码与围栏代码块，也使流式输出中尚未闭合的 `\[` 先按普通文本显示、待结束符到达
  后再变为公式。
- 关闭单个 `$` 的行内公式。`$PATH`、`$HOME` 以及 `$5 和 $10` 这类价格保持原样；`$$…$$` 不受影响。
- KaTeX 无法解析的公式显示为其自身源码，解析错误保留在悬停提示中，不会波及所在的整条消息。
- `\text{}` 中的中文使用应用自身的字体栈渲染。KaTeX 的字体不含 CJK 字形，且未为其标记的中文片段定义
  样式，因此该样式由 `packages/web/src/styles.css` 补齐。
- 成块公式在自身区块内横向滚动，与表格、代码块的既有处理一致。
- KaTeX 的样式表与 woff2 字体作为本地资源打包，离线也能渲染公式。KaTeX 同时提供的 woff 与 truetype
  回退在构建时丢弃；Web 产物体积增加约 550KB，其中约 250KB 是仅在出现公式时才会请求的字体。
- remark 与 rehype 插件列表移至 `packages/web/src/lib/markdown-plugins.ts`，五处 `ReactMarkdown`
  调用点统一读取该列表。
