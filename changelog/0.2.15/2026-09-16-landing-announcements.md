# The landing announcement bar features the new Flash models and Penguin Go

- **Date:** 2026-09-16
- **Type:** feature
- **Scope:** `landing`
- **PR:** [#747](https://github.com/Prism-Shadow/penguin-harness/pull/747)

[中文版](2026-09-16-landing-announcements.zh.md)

The rotating announcement bar above the landing site's navigation dropped the announcement of GLM-5.3 Flash and Qwen 3.8 Flash and the one for the AMD Developer Program's Fireworks API credits. Two new announcements took their place, in both languages.

## Details

- The first slide reads "DeepSeek V4.1 Flash and Gemini 3.8 Flash are now live in PenguinHarness" and links to the 0.2.11 release post, `/blog/penguinharness-0-2-11`, which covers both models. It kept the `flashModels` dictionary key.
- The second reads "Penguin Go official Token packs are live: 50% off every Gemini model" and links to the Penguin Go site, `https://token.penguin.ooo/`. Its `penguinGo` key replaced `fireworks` in `strings.ts` and `strings-en.ts`.
- Announcements can link off-site. Their list moved out of `announcement-bar.tsx` into `src/lib/announcements.ts`, and each item carries exactly one of `to`, a blog route followed through the router, or `href`, an `https://` URL rendered as a plain anchor that opens in a new tab (`target="_blank"`, `rel="noopener noreferrer"`) with the blog links' styling, arrow, and focus and `tabIndex` handling. The item type rejects an item with both or neither.
- A landing test, `test/announcements.test.ts`, looks up the post behind each blog link on the bar with `getPost`, in `en` and in `zh`, and fails when either lookup finds no post or falls back to the other language.
