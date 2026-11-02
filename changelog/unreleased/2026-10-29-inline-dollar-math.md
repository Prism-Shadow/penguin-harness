# Single-dollar inline math renders, and shell variables and prices stay text

- **Date:** 2026-10-29
- **Type:** feature
- **Scope:** `ui`
- **PR:** [#1397](https://github.com/Prism-Shadow/penguin-harness/pull/1397)

[中文版](2026-10-29-inline-dollar-math.zh.md)

A formula written as `$…$` in a chat reply, a Trace event, a benchmark case or a Markdown file preview now typesets inline, as `\(…\)` already did. Before, only `$$…$$`, `\(…\)` and `\[…\]` rendered, and a reply such as `分母 $n-1=2$，均值标准误 $s/\sqrt{3}$` showed its TeX source. The docs site and the blog are unchanged.

## The rule

- A `$` opens a formula when a non-space character follows it and the character before it is not an ASCII letter, digit, `\` or `$`.
- The first `$` after it that is not escaped by a backslash closes the formula, when a non-space character precedes it and no ASCII letter or digit follows it. If that `$` cannot close, the opener opens nothing.
- A formula stays on one line, and code spans, code blocks and `\$` keep their dollar signs.

`Set $PATH and $HOME`, `$5-$10`, `echo $PATH; echo $HOME`, `$1,200 and $3,400`, `export PATH=$HOME/bin:$PATH`, `"$A$B"` and `价格是$5，折扣后$3` stay text with every dollar sign, while a CJK character or punctuation after a closer is fine (`$n$）`). A formula written directly against a word, such as `$i$th`, stays text; `$i$-th` renders.

## Details

- While a reply streams, a `$…$` whose closing `$` is the last character received shows as typed until the next character arrives, so shell text never drops its dollar signs for a frame. Formulas are typeset when the reply settles, as before.
- `$$…$$` keeps rendering as display math, and `$…$` next to it stays inline.
- An inline formula, in either `$…$` or `\(…\)`, stays on one line with the punctuation mark right after it (`，。、；：！？）」』》】` and `,.;:!?)`) and the one right before it (`（「『《【` and `(`), so a line no longer starts with the `，` that follows a formula. A formula too wide for the column still scrolls inside itself, with its punctuation beside it.
