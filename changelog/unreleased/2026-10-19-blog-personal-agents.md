# Blog post: personal agents need an agent-native cloud computer

- **Date:** 2026-10-19
- **Type:** process
- **Scope:** `landing`
- **PR:** [#1237](https://github.com/Prism-Shadow/penguin-harness/pull/1237)

[中文版](2026-10-19-blog-personal-agents.zh.md)

The blog gained a perspectives post in English and Chinese, "Personal agents need an agent-native
cloud computer" (`personal-agents-need-a-computer`). It splits a personal agent into a stronger
model, an Agent Runtime and an agent-native cloud computer, argues that the runtime loop is
settled and per-task sandboxes are the wrong home, and gives the user's app connections a section
of their own: the machine, not each agent or conversation, should hold them as the one entry
point. It then sets PenguinHarness's runtime, Machines page and connection scopes against that
split.

## Details

- The post is written as one argued essay: the whole post in one call from a frozen outline,
  revised as a whole, then a round that edits only the sentences at the headings. It opens with a
  TL;DR, and one key sentence in the lead and in each section is set in bold.
- Two figures are drawn as inline SVG with the shared figure styles and reused as published: the
  three parts of a personal agent, with the runtime loop inside a guards layer and the cloud
  computer column highlighted; and the layers of software an agent can reach, with their measured
  callouts.
- The Machines page screenshot is served from the community repository's `blog-assets/`.
- Sources are cited as numbered footnotes generated from the draft's fact markers, at most one per
  paragraph and each source once: seven sources, the same set and numbers in both languages.
- The blog test's perspectives order lists the new post first.
