# LaTeX formulas render on every Markdown surface

- **Date:** 2026-08-26
- **Type:** feature
- **Scope:** `web`
- **PR:** [#503](https://github.com/Prism-Shadow/penguin-harness/pull/503)

[中文版](2026-08-26-markdown-math.zh.md)

Markdown bodies now render mathematical notation with KaTeX. The pipeline is shared, so chat
messages, Trace events, benchmark cases and Workspace file previews all gained it at once.

## Details

- Four delimiter forms are recognised: `\[…\]` and `$$…$$` render as display math, `\(…\)` as
  inline. The TeX bracket forms — the ones models emit most — are read by a micromark syntax
  extension (`packages/web/src/lib/remark-math-brackets.ts`), which is what keeps them out of code
  spans and fenced blocks and lets an unclosed `\[` mid-stream stay ordinary text until its closer
  arrives.
- Single-dollar inline math is disabled. `$PATH`, `$HOME` and prices such as `$5 and $10` are left
  exactly as written; `$$…$$` is unaffected.
- A formula KaTeX cannot parse renders as its own source with the parse error in a tooltip, rather
  than failing the message it sits in.
- CJK inside `\text{}` renders in the application's own font stack. KaTeX's typefaces carry no CJK
  glyphs and leave the class they tag such runs with undefined, so `packages/web/src/styles.css`
  defines it.
- Display math scrolls horizontally inside its own block, as tables and code blocks already do.
- KaTeX's stylesheet and its woff2 faces are bundled as local assets, so math renders with no
  network. The woff and truetype fallbacks KaTeX also ships are dropped at build time; the web
  bundle grew by about 550KB, of which roughly 250KB is fonts fetched only when a formula appears.
- The remark and rehype plugin lists moved to `packages/web/src/lib/markdown-plugins.ts`, which all
  five `ReactMarkdown` call sites read.
