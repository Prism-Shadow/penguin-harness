# A blog post: testing agent harnesses with scripted edges and invariants

- **Date:** 2026-10-19
- **Type:** process
- **Scope:** `landing`
- **PR:** [#1186](https://github.com/Prism-Shadow/penguin-harness/pull/1186)

[中文版](2026-10-19-blog-testing-agent-harnesses.zh.md)

The blog gained a technical post, in English and Chinese, on how PenguinHarness checks its request
assembly in CI. Its worked example is the `prompt-cache-*` suites in `packages/core`.

## Details

- `testing-agent-harnesses` (category `practice`) starts from the regression that led to the
  suites, the compaction request's thinking level fixed in
  [#700](https://github.com/Prism-Shadow/penguin-harness/pull/700), and describes the test system
  added in [#722](https://github.com/Prism-Shadow/penguin-harness/pull/722): the real Session and
  model client over a scripted provider stream, every recorded request read by a byte diagnostic
  and by a simulator of Anthropic's documented cache rules, and one invariant with a named
  allow-list. It then compares the designs not taken (live API calls, a bytes-only check, pinned
  token counts, re-baselining to green) and ends with the command that runs the suites.
- The numbers in the post come from the suites' own helpers, run on the project's test machine
  with no model API: the suites' run time, the token counts after a thinking-level move and after a
  harmless prompt edit, and the estimated compaction-request cost with #700 reverted in two
  scenarios.
- Seven figures are drawn as inline SVG with the shared figure styles of
  [#1217](https://github.com/Prism-Shadow/penguin-harness/pull/1217): the silent regression, the
  request's blocks up to the cache breakpoint, the test pipeline, and four comparisons of a
  rejected design with the chosen one, the last with its costs as bars on one scale. Every string
  in a figure is the post's own text in that language.
- The landing blog test lists the post first in the practice category.
