# A blog post: how we test an agent harness in CI without calling a model

- **Date:** 2026-10-19
- **Type:** process
- **Scope:** `landing`
- **PR:** [#1186](https://github.com/Prism-Shadow/penguin-harness/pull/1186)

[中文版](2026-10-19-blog-testing-agent-harnesses.zh.md)

The blog gained a technical post, in English and Chinese, on how to design the automated CI system
that checks an agent harness. Its worked example is the `prompt-cache-*` suites in
`packages/core`; the post argues the design, not how the cache is computed.

## Details

- `testing-agent-harnesses` (category `practice`) is one argued essay in five sections. A harness
  regression with no functional signal comes first, then the principle: replace only the provider
  stream and run the real Session, context engine and model client. Three design choices are each
  argued against the design not taken: a scripted edge against live calls, with where CI runs the
  suites (the files a change touches, three operating systems, no secrets in test jobs); an
  invariant with a named allow-list against pinned numbers; and failing loudly against
  re-baselining, with the deliberate revert of
  [#700](https://github.com/Prism-Shadow/penguin-harness/pull/700) as the caught regression. It
  closes with the command that runs the suites and the docs link.
- The numbers come from the suites' own helpers, run on the project's test machine with no model
  API: the suites' run time, the token counts after a harmless prompt edit, and the estimated
  compaction-request cost with [#700](https://github.com/Prism-Shadow/penguin-harness/pull/700) reverted in two scenarios.
- Five figures are drawn as inline SVG with the shared figure styles of
  [#1217](https://github.com/Prism-Shadow/penguin-harness/pull/1217) and reused as published: the
  silent regression, the test pipeline, and three comparisons of a rejected design with the chosen
  one. The two figures about cache internals were dropped.
- The post opens with a TL;DR, and one key sentence in the lead and in each section is set in bold.
  Sources are numbered footnotes, at most one per paragraph and each source once: ten sources,
  the same set and numbers in both languages.
- The landing blog test lists the post first in the practice category.
