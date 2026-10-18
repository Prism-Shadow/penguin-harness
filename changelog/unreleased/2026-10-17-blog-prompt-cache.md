# A blog post: inspecting harness performance automatically with a coding agent

- **Date:** 2026-10-17
- **Type:** process
- **Scope:** `landing`
- **PR:** [#1186](https://github.com/Prism-Shadow/penguin-harness/pull/1186)

[中文版](2026-10-17-blog-prompt-cache.zh.md)

The blog gained a technical post, in English and Chinese, on the test system that keeps every model request an extension of the previous one: the three `prompt-cache-*` suites in `packages/core`. Its figures are inline SVG in the post's Markdown, styled by new classes in the landing stylesheet.

## Details

- `keeping-the-prompt-cache-hot` explains why a cache miss has to fail a test, how the test system added in [#722](https://github.com/Prism-Shadow/penguin-harness/pull/722) is designed (the recorder, the cache-miss diagnostic, the Anthropic-shaped simulator, `expectHits` and the three suites), how a contributor runs it and reads its reports, what it measured, and the compaction-request regression fixed in [#700](https://github.com/Prism-Shadow/penguin-harness/pull/700), replayed from start to finish.
- Eight drawn figures: request strips coloured by cache state, the simulator's block order with the diagnosis each change gets, the test system as a flowchart, charts for the 14 Session scenarios, nine injected anti-patterns with a control and two breakpoint placements, and the #700 replay as a before/after pair with that compaction request taken apart. Each SVG carries its language's text, a title and a visually hidden text list with the same content. The charts and the two failure reports shown were generated from a run of the suites' own helpers and simulator, deterministic and without any model API call.
- `packages/landing/src/styles.css` gained the `.post-figure` and `.fig-*` classes: one colour per cache state (read, written, written again) taken from the sites' palette, with `html.dark` variants, so a figure follows the theme.
- The landing blog test lists the new post first in the practice category.
