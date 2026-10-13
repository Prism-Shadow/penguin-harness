# Every blog post rewritten for readability

- **Date:** 2026-09-16
- **Type:** process
- **Scope:** `landing`
- **PR:** [#757](https://github.com/Prism-Shadow/penguin-harness/pull/757)

[中文版](2026-09-16-blog-rewrite.zh.md)

All 21 blog posts were rewritten in both languages. The English version of each post was
rewritten first and the Chinese version translated from it, and every draft was checked against
the old post, the product's UI strings and the code before it replaced the old text.

## Details

- Release posts (0.1.4 through 0.2.13), the launch post, the model posts and the July roundup now
  open with a short summary and give each change its own section: what users can now do, how to
  use it, and any limit worth knowing. Internal implementation detail that does not change what a
  user sees was dropped.
- The three practice posts became step-by-step tutorials with prerequisites, numbered steps and
  expected results. `natural-language-training-loop` was restructured from an argument into steps
  built on the prompts the post already used.
- The three perspectives essays state their question and thesis up front and give each step of the
  argument its own section. Their dated claims were kept as of their publication date.
- Stale or wrong statements were corrected against the code at each post's release, among them:
  the 0.2.13 post now says that the CEO-proposes, board-decides rule is guidance in the company
  Skills and handbook rather than something the server enforces; the 0.2.4 post names the default
  command-policy rules that block commands such as `rm -rf`; the self-improvement tutorial creates
  `meeting_summary_agent`, because agent ids do not allow hyphens. UI labels are the ones the app
  showed on each post's date (for example **Set API key for group**, **Costs**, **Trajectory**),
  and claims that no longer hold today are tied to the version they describe.
- In-page anchor links were replaced by plain references to the section they pointed at.
- Posts whose title names no release open with a note saying which version they were written for
  (0.0.1, 0.1.0, 0.1.1 or 0.1.2).
- The Chinese posts use the Chinese UI's own labels and the product's term 插话 for steering, keep
  their China-specific material (the China ADP route in the Fireworks guide, localized prompts
  and screenshots), and render every bold span next to CJK punctuation.
- The landing package now checks the blog directory itself: every post ships both languages, the
  two halves agree on `date`, `category` and `pinned`, and every `penguin.ooo/docs/<slug>` a post
  links to is a page the docs site navigates.
