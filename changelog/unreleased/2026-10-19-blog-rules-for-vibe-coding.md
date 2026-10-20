# A perspective post on laying down rules for vibe coding

- **Date:** 2026-10-19
- **Type:** process
- **Scope:** `landing`

[中文版](2026-10-19-blog-rules-for-vibe-coding.zh.md)

The blog gained a perspective post, in Chinese and English, on keeping AI-written code within
bounds: the constraints an agent must follow are written into the repository in three layers
(human rules, interface abstractions, reusable components), and the hard ones are held by code and
tests.

## Details

- `rules-for-vibe-coding` carries five figures drawn as inline SVG with the shared figure styles:
  the three layers, a hard rule's path from numbered principle to test assertion, the Agent State
  directory tree, the boundaries around `context_engine`, and the reuse-first decision.
- The landing blog test lists the post first among the perspectives.
