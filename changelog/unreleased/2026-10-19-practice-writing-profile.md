# A practice profile for technical posts in the writing skill

- **Date:** 2026-10-19
- **Type:** process
- **Scope:** `skills`
- **PR:** [#1188](https://github.com/Prism-Shadow/penguin-harness/pull/1188)

[中文版](2026-10-19-practice-writing-profile.zh.md)

The `penguin-harness-writing` skill gained `reference/profile-blog-practice.md`, its profile for
technical posts (`--profile blog-practice`, blog category `practice`). The skill's script sends the
profile's prompt block to the gateway model with every step of such a post, and its Chinese block
for Chinese text. The profile sets:

- two shapes, each with per-section word ranges in a short, figure-led budget. One is a change
  story in the section order of Modal's
  [Building fast filesystems for VMs](https://modal.com/blog/vm-sandbox-filesystem): the obvious
  plan, the measurement that broke it, the redesign with its cost named, and results against the
  naive baseline. The other is a post about a system we built: why it exists, its principle, three
  or four comparisons of the design not taken against the one taken, and a close with the command
  and the docs link;
- how numbers are used: units, both endpoints of every ratio, a real baseline, one sentence on
  method that says whether the numbers come from a simulator or a live provider, and no number or
  ratio that FACTS does not hold;
- what the model's figure blocks must carry: a diagram of the mechanism and a chart per
  measurement, mirror pairs on one layout and scale, and captions that state the finding with its
  numbers;
- the voice on top of the English and Chinese style guides, with one rhetorical question allowed,
  at the turn.

Its check settings allow 6 to 9 sections and require a lead; a TL;DR is allowed. The READMEs list
`penguin-harness-writing` with the other development skills.
