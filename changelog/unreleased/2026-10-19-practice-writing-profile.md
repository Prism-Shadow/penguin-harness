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

- the essay form: a technical post is one argued essay in connected paragraphs. The lead states
  the design claim the post defends and why it matters to the reader. Each section argues one
  point with its reasoning and evidence, and answers the design not taken as the objection. The
  close returns to the thesis with its consequence for the reader. The body has no list and no
  table, and a figure supports the paragraph before it instead of replacing it;
- two shapes in argument order. One is a change story in the section order of Modal's
  [Building fast filesystems for VMs](https://modal.com/blog/vm-sandbox-filesystem): the problem
  measured, the obvious design argued and broken by a measurement, the redesign with its cost
  named, and the results as the proof. The other is a post about a system we built: why it must
  exist and its principle, two or three arguments that each answer the design not taken with the
  same metric, and a close with the command and the docs link;
- how numbers are used: units, both endpoints of every ratio, a real baseline, one sentence on
  method that says whether the numbers come from a simulator or a live provider, and no number or
  ratio that FACTS does not hold;
- what the model's figure blocks must carry: a diagram of the mechanism and a chart per
  measurement, mirror pairs on one layout and scale, and captions that state the finding with its
  numbers;
- the voice on top of the English and Chinese style guides, with one rhetorical question allowed,
  at the turn;
- citations: most sentences carry none, and the facts that need one are third-party numbers,
  quotes and our own measurements.

Its check settings hold the practice budgets: 4 to 5 sections, a body of at most 750 English words
(1,800 Chinese characters), a lead of 50 to 90 words, argument sections of 100 to 170 words and a
close of 60 to 100 (a section cap of 170 words, 400 characters), and an optional TL;DR of 30 to 50
words. A published practice post cites 8 to 13 sources, and `body-lists: none` and
`body-tables: none` make a list or a table in its body an error. The skill's `review` reads a
practice post by the same form: it expects the key sentences and an objection stated and
answered, and never asks for a list in the body. Its `trim` cuts a practice post's over-cap
sections to just under the 170-word section cap (400 characters), never to the plan rows, keeps
every number and puts back any figure block the model touched. The
READMEs list
`penguin-harness-writing` with the other development skills.
