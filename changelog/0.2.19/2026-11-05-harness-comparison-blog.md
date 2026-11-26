# Harness comparison experiment blog post

- **Date:** 2026-11-05
- **Type:** process
- **Scope:** `landing`
- **PR:** [#1484](https://github.com/Prism-Shadow/penguin-harness/pull/1484)

[中文版](2026-11-05-harness-comparison-blog.zh.md)

Added Chinese and English experiment blog posts comparing PenguinHarness, DSH, Pi and Codex across five task subsets and three repeated runs.

## Details

- Added bilingual practice posts covering all six sections of the manuscript, including two task-level case studies.
- Added the article to the practice-post index with the byline Zhihao Liu (Prism Shadow AI).
- Matched the Chinese article to the Feishu manuscript and translated its title, experiment prompt, tables, captions and alt text into English.
- Referenced 15 language-specific figures per article through `/blog-assets/`, with image bytes stored in `penguin-harness-community`.
- Registered the dimensions of all 30 assets and removed this post's image files from the main repository.
- Described benchmark selection, the three-step reproduction workflow, pass frequencies, per-task stability and resource use.
- Analyzed DSH's storage-engine self-tests and its repeated local tuning on a table-suppression task, with bilingual execution-flow figures for both cases.
- Replaced both bilingual case-study flows with editable SVGs, removed repeated notes and added the retest loop to the parameter-tuning case.
- Centered captions and removed the white card treatment from diagrams while retaining captured interface backgrounds.
