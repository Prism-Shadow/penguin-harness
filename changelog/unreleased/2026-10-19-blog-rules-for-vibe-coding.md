# A perspective post on laying down rules for vibe coding

- **Date:** 2026-10-19
- **Type:** process
- **Scope:** `landing`
- **PR:** [#1234](https://github.com/Prism-Shadow/penguin-harness/pull/1234)

[中文版](2026-10-19-blog-rules-for-vibe-coding.zh.md)

The blog gained a perspective post, in Chinese and English, argued as one essay: the rules an agent
must follow belong in the repository, where every session reads them (code as memory), in three
layers (human rules, interface abstractions, reusable components), and the hard ones are held by
code and tests rather than by prompts.

## Details

- The post was written Chinese first as one whole document and then translated. Each section makes
  one argument and answers its strongest objection, and a transition round rewrote only the
  sentences at the headings.
- Five figures are drawn as inline SVG with the shared figure styles. The three-layer figure is
  redrawn with the author's examples: rules written one per item like an RFC (the Trace is
  append-only), minimal core interfaces (the Agent State boundary, approval depending on the Human
  interface), and reuse of existing abstractions (the hot update reusing terminal handover). The
  other four (a hard rule's path to a test assertion, the Agent State directory tree, the
  boundaries around `context_engine`, the reuse-first decision) are reused as published.
- Sources are cited as numbered footnotes: at most one per paragraph, each source once, and the
  same 9 sources in both languages.
- The post opens with a three-point TL;DR and bolds one key sentence in the lead and in each
  section.
- The landing blog test lists the post first among the perspectives posts.
