# A perspective post on laying down rules for vibe coding

- **Date:** 2026-10-19
- **Type:** process
- **Scope:** `landing`
- **PR:** [#1234](https://github.com/Prism-Shadow/penguin-harness/pull/1234)

[中文版](2026-10-19-blog-rules-for-vibe-coding.zh.md)

The blog gained a perspective post, in Chinese and English, argued as one essay: the rules an agent
must follow belong in the repository, where every session reads them (code as memory), arranged as
a pyramid. RFC-style rules sit at the top, core interfaces in the middle and reusable components at
the base; the higher the layer, the less it holds and the more human attention it needs, the lower,
the more it holds and the less a person needs to read it. The hard rules are held by code and
tests rather than by prompts.

## Details

- The post was written Chinese first as one whole document and then translated. Each section makes
  one argument and answers its strongest objection, each layer says how much it holds and how much
  human attention it needs (25 numbered rules, 3 core interfaces, 1,489 source files in 0.2.16),
  and a transition round rewrote only the sentences at the headings.
- Five figures are drawn as inline SVG with the shared figure styles. The three-layer figure is
  redrawn as a pyramid: a narrow top band for the rules, a middle band for the interfaces and a wide
  base for the reusable components, each with its amount, who reads it and an example (the
  append-only Trace; the Agent State boundary and approval through the Human interface; the hot
  update reusing terminal handover), with human attention marked rising on one side and content
  volume rising downward on the other. The other four (a hard rule's path to a test assertion, the
  Agent State directory tree, the boundaries around `context_engine`, the reuse-first decision) are
  reused as published.
- Sources are cited as numbered footnotes: at most one per paragraph, each source once, and the
  same 9 sources in both languages.
- The post opens with a three-point TL;DR and bolds one key sentence in the lead and in each
  section.
- The landing blog test lists the post first among the perspectives posts.
