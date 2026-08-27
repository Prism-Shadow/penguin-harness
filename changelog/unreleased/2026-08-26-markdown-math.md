# LaTeX formulas render on every Markdown surface

- **Date:** 2026-08-26
- **Type:** feature
- **Scope:** `web`
- **PR:** [#503](https://github.com/Prism-Shadow/penguin-harness/pull/503)

[中文版](2026-08-26-markdown-math.zh.md)

Markdown bodies now render mathematical notation with KaTeX. The pipeline is shared, so chat
messages, Trace events, benchmark cases and Workspace file previews all gained it at once.

## Details

- Three delimiter pairs were enabled: `\[…\]` and `$$…$$` render as display math, `\(…\)` as
  inline. A `$$…$$` pair is display wherever it is written, not only when it stands alone on its
  own lines. The TeX bracket forms — the ones models emit most — were taught to the parser as a
  micromark syntax extension, which is what keeps them out of code spans and fenced blocks and lets
  an unclosed `\[` mid-stream stay ordinary text until its closer arrives.
- Single-dollar inline math was left off. `$PATH`, `$HOME` and prices such as `$5 and $10` are left
  exactly as written; `$$…$$` is unaffected.
- A formula KaTeX cannot parse renders as its own source with the parse error in a tooltip, rather
  than failing the message it sits in. Sizing commands were capped at 5em, so a `\rule{9999em}{9999em}`
  arriving from a model is a small square rather than a page-sized one.
- CJK inside `\text{}` renders in the application's own font stack. KaTeX's typefaces carry no CJK
  glyphs and leave the class they tag such runs with undefined, so the change added a rule for it.
- Display math scrolls horizontally inside its own block, as tables and code blocks already do, and
  a long inline formula scrolls inside itself instead of widening the message column.
- A formula in a message that is still streaming shows as its own TeX source and is typeset when
  the message settles. Rendering it per delta meant re-parsing KaTeX's markup and rebuilding a few
  hundred elements per formula around eight times a second, which is the cost the transcript
  memoization and the deferred syntax highlighting already exist to avoid.
- `\[` and `\]` are also CommonMark's escape for a literal bracket, and the collision was resolved
  in favour of math: `See \[1\] and \[2\] for details.` reads as two centred formulas rather than
  two footnote markers. A `\[…\]` broken by a blank line is not matched, and `\[a\\]` — a TeX line
  break butted against the closer — closes at the second backslash.
- A backtick between the delimiters declines the formula, so prose that shows a closing delimiter
  inside a code span keeps both the span and its sentence.
- KaTeX's stylesheet and its woff2 faces are bundled as local assets, so math renders with no
  network. The woff and truetype fallbacks KaTeX also ships are dropped at build time; the web
  bundle grew by about 550KB, of which roughly 250KB is fonts fetched only when a formula appears.
- The remark and rehype plugin lists moved to `packages/web/src/lib/markdown-plugins.ts`, and every
  `ReactMarkdown` call site was pointed at them rather than assembling its own.
