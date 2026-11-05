# Blog posts can carry figures drawn as inline SVG

- **Date:** 2026-10-19
- **Type:** feature
- **Scope:** `landing`
- **PR:** [#1217](https://github.com/Prism-Shadow/penguin-harness/pull/1217)

[中文版](2026-10-19-blog-figure-styles.zh.md)

The landing site's stylesheet gained shared styles for figures drawn as inline SVG in a blog
post's Markdown. A figure written as one `<figure class="post-figure">` line takes the sites'
palette in both themes, keeps a legible size on a phone by scrolling sideways inside the prose
column, and carries its content a second time as a visually hidden list for screen readers.

## Details

- A drawing's marks carry classes, never inline colours: text (`fig-title`, `fig-label`,
  `fig-note`, `fig-tick`, `fig-num`, `fig-code`), flowcharts (`fig-box`, `fig-terminal`,
  `fig-edge`, `fig-arrowhead`), guides (`fig-axis`, `fig-bracket`, `fig-link`, `fig-marker`) and
  three series fills (`fig-s1`, `fig-s2`, `fig-s3`). A post's legend says what each series means,
  and the meaning holds in every figure of that post.
- The three series stay apart without colour: solid, pale with an outline, and mid amber with a
  dashed edge.
- A test checks that a one-line figure reaches the page as elements: an HTML block rather than
  inline HTML, SVG attributes in their original case, the hidden list and the caption intact.
