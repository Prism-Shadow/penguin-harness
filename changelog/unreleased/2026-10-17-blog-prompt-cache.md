# A blog post on keeping the prompt cache hot

- **Date:** 2026-10-17
- **Type:** process
- **Scope:** `landing`

[中文版](2026-10-17-blog-prompt-cache.zh.md)

The blog gained a technical post, in English and Chinese, on how PenguinHarness keeps every model request an extension of the previous one, and how the three `prompt-cache-*` suites in `packages/core` catch a change that breaks it.

## Details

- `keeping-the-prompt-cache-hot` covers provider prefix caching under Anthropic's documented rules, the engine rules that keep requests append-only, the compaction-request bug fixed in [#700](https://github.com/Prism-Shadow/penguin-harness/pull/700) that led to the suites, and the design of the recorder, the cache-miss diagnostic, the Anthropic-shaped simulator and the Session lifecycle suite added in [#722](https://github.com/Prism-Shadow/penguin-harness/pull/722).
- Its experiment tables (14 Session lifecycle scenarios, nine injected anti-patterns with a control, and a comparison of breakpoint placements) were produced with the suites' own helpers and simulator, deterministically and without calling a model API.
- The landing blog test lists the new post first in the practice category.
