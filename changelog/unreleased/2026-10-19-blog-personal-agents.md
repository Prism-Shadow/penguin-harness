# Blog post: personal agents need an agent-native cloud computer

- **Date:** 2026-10-19
- **Type:** process
- **Scope:** `landing`
- **PR:** [#1237](https://github.com/Prism-Shadow/penguin-harness/pull/1237)

[中文版](2026-10-19-blog-personal-agents.zh.md)

The blog gained a perspectives post in English and Chinese, "Personal agents need an agent-native
cloud computer" (`personal-agents-need-a-computer`). It splits a personal agent into a stronger
model, an Agent Runtime and an agent-native cloud computer, compares how common sandbox hosts keep
state across tasks, and sets PenguinHarness's runtime, Machines page and connection scopes against
that split.

## Details

- Two figures were drawn as inline SVG with the shared figure styles: the three parts of a personal
  agent, with the runtime loop inside a guards layer and the cloud computer column highlighted; and
  the layers of software an agent can reach, each performance callout with its own source.
- The Machines page screenshot is served from the community repository's `blog-assets/`.
- The blog test's perspectives order lists the new post first.
