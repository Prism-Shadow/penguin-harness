# A blog post on keeping the prompt cache hot

- **Date:** 2026-10-17
- **Type:** process
- **Scope:** `landing`
- **PR:** [#1186](https://github.com/Prism-Shadow/penguin-harness/pull/1186)

[中文版](2026-10-17-blog-prompt-cache.zh.md)

The blog gained a technical post, in English and Chinese, on how PenguinHarness keeps every model request an extension of the previous one, and how the three `prompt-cache-*` suites in `packages/core` catch a change that breaks it. Its figures are inline SVG in the post's Markdown, styled by new classes in the landing stylesheet.

## Details

- `keeping-the-prompt-cache-hot` follows the compaction-request bug fixed in [#700](https://github.com/Prism-Shadow/penguin-harness/pull/700) from measurement to root cause, then covers the engine rules that keep requests append-only and the test system added in [#722](https://github.com/Prism-Shadow/penguin-harness/pull/722): the recorder, the cache-miss diagnostic, the Anthropic-shaped simulator and the Session lifecycle suite.
- Seven drawn figures: request strips coloured by cache state, the #700 replay as a before/after pair, that compaction request taken apart, the test system as a flowchart, and charts for the 14 Session scenarios, nine injected anti-patterns with a control, and two breakpoint placements. Each SVG carries its language's text, a title and a visually hidden text list with the same content. The charts were generated from the experiment output, which came from the suites' own helpers and simulator, run deterministically without any model API call.
- `packages/landing/src/styles.css` gained the `.post-figure` and `.fig-*` classes: one colour per cache state (read, written, written again) taken from the sites' palette, with `html.dark` variants, so a figure follows the theme.
- The landing blog test lists the new post first in the practice category.
