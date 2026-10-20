# A blog post: inspecting harness performance automatically with a coding agent

- **Date:** 2026-10-17
- **Type:** process
- **Scope:** `landing`
- **PR:** [#1186](https://github.com/Prism-Shadow/penguin-harness/pull/1186)

[中文版](2026-10-17-blog-prompt-cache.zh.md)

The blog gained a technical post, in English and Chinese, on the test system that keeps every model request an extension of the previous one: the three `prompt-cache-*` suites in `packages/core`. Its figures are inline SVG in the post's Markdown, styled by new classes in the landing stylesheet.

## Details

- `keeping-the-prompt-cache-hot` is short and figure-led. It explains why a cache miss has to fail a test and the principle of the test system added in [#722](https://github.com/Prism-Shadow/penguin-harness/pull/722) (every request recorded, then read by a byte-level diagnostic and an Anthropic-shaped cache simulator), then compares four design choices by cache hit ratio and input cost: a timestamp in the system prompt, a tool edited mid-context, history rebuilt on resume, and the compaction-request regression fixed in [#700](https://github.com/Prism-Shadow/penguin-harness/pull/700). It closes with the command that runs the suites.
- Seven drawn figures: request strips coloured by cache state, the test system as a flowchart, the request's block order with the diagnosis each change gets, and four before/after pairs that share one layout and scale. Each SVG carries its language's text, a title and a visually hidden text list with the same content. The charts and the failure report shown were generated from a run of the suites' own helpers and simulator, deterministic and without any model API call.
- `packages/landing/src/styles.css` gained the `.post-figure` and `.fig-*` classes: one colour per cache state (read, written, written again) taken from the sites' palette, with `html.dark` variants, so a figure follows the theme.
- The landing blog test lists the new post first in the practice category.
