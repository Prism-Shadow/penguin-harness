# A skill for writing technical blog posts

- **Date:** 2026-10-17
- **Type:** process
- **Scope:** `skills`
- **PR:** [#1188](https://github.com/Prism-Shadow/penguin-harness/pull/1188)

[中文版](2026-10-17-tech-blog-skill.zh.md)

`.agents/skills/penguin-harness-tech-blog/SKILL.md` is a new repo-development skill for engineering
deep dives on the landing blog. Its reference post is Modal's
[Building fast filesystems for VMs](https://modal.com/blog/vm-sandbox-filesystem). From that post it
takes:

- a section order: an opening that ends on one scope sentence, an optional TL;DR, background, the obvious plan, the
  measurement that broke it, the redesign with its cost named, implementation, results against the
  naive baseline, and a short close;
- a short, figure-led budget: about 800–1,200 words of prose, the reason and the principle rather than
  every parameter, and for a system post, comparisons of the design not taken against the one taken;
- figures: every post is drawn. Diagrams and charts are inline SVG in the post's Markdown, on the
  model of the agent-loop flowchart in the MMSP docs: classes styled for both themes, text in each
  language's file, and a hidden text equivalent. Bolder figures are welcome when every mark encodes
  something. Before/after figures share one layout, and captions state the finding with its
  numbers;
- how numbers are presented: units, both endpoints of every ratio, a real baseline, and one sentence
  on method that also says whether the numbers come from a simulator or a live provider;
- voice rules for the English and the Chinese posts.

It also covers polishing a post section by section with a model, and a checklist to go through
before the PR.

`penguin-harness-dev`'s `reference/authoring.md` points technical posts at the skill, and the
READMEs list it with the other development skills.
