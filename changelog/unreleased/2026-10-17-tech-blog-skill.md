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

- a section order: an opening that ends on one scope sentence, background, the obvious plan, the
  measurement that broke it, the redesign with its cost named, implementation, results against the
  naive baseline, and a short close;
- word budgets per section;
- figures placed after the prose that introduces them, before/after figures in one layout, and
  captions that state the finding with its numbers;
- how numbers are presented: units, both endpoints of every ratio, a real baseline, and one sentence
  on method that also says whether the numbers come from a simulator or a live provider;
- voice rules for the English and the Chinese posts.

It also covers polishing a post section by section with a model, and a checklist to go through
before the PR.

`penguin-harness-dev`'s `reference/authoring.md` points technical posts at the skill, and the
READMEs list it with the other development skills.
