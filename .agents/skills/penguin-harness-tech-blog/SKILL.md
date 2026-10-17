---
name: penguin-harness-tech-blog
description: >-
  Use when writing, outlining or reviewing a PenguinHarness technical blog post: an
  engineering deep dive into how part of the harness works, why it was built that way
  and what was measured (landing category `practice`). The shape is modeled on Modal's
  "Building fast filesystems for VMs". It covers the opening, the order of sections,
  figures and captions, how numbers and baselines are presented, voice in English and
  Chinese, model polishing, and a pre-PR checklist. The mechanics of a post (the en/zh
  file pair, frontmatter, image hosting) stay in penguin-harness-dev's
  reference/authoring.md.
---

# Writing a technical blog post

A technical post tells one engineering story, in the order the team lived it. A problem is
measured, a design explains the measurement, and a second measurement proves the design. It is
not a release note (`penguin-harness-dev`'s `reference/release.md`), a news item, or a tutorial
that walks a reader through clicks.

**The reference post** is Modal's
[Building fast filesystems for VMs](https://modal.com/blog/vm-sandbox-filesystem) (2026-10-16).
Read it before the first draft. Three things make it work, and each is a rule here:

- Every section ends by moving the story on, with a result, a question or a new constraint. No
  section ends with a recap.
- The prose introduces each claim, and a figure confirms it right after.
- The before and after figures share one layout, so the difference is the only thing that changes.

The file pair, frontmatter, `/blog-assets/` paths and screenshot capture are in
`penguin-harness-dev`'s `reference/authoring.md`. The copy rules in its `reference/ai-slop.md`
apply to every post. This page covers what those two do not: the shape and the voice.

## Shape

| Section | Its job | In the reference post | en words |
| --- | --- | --- | ---: |
| Opening, no heading | What the team cares about, the stakes in the reader's own workloads, then one sentence of scope | "To us, it's all the same: make stuff go _really_ fast." … "Today, we'll be talking about how we evolved our filesystem stack…" | 100–150 |
| Background | The existing system the reader must hold in mind, and the property the new work has to keep. One diagram. | ImageFS: lazy loading, cache tiers, OverlayFS for writes | 150–250 |
| The obvious plan | The constraint, and the natural answer to it. Let it look right. | virtio-fs bridges the VM boundary; boot is fast. "So we shipped it… right?" | 150–250 |
| The turn | The measurement that broke the plan, against a baseline. Then one operation taken apart on a timeline with real units, down to a root cause stated in one sentence. | Bar chart of five operations; one `chown` = three host round trips, 99 µs; "virtio-fs is a _shared_ filesystem" | 300–400 |
| The redesign | The idea in one sentence first, then the mechanism. Name what it costs and what it buys. | "speaking in blocks"; "the host … loses its ability to work with the VM's filesystem. In return…" | 350–450 |
| Making it real | The hard part of the redesign. The naive implementation and the exact reason it fails. | `mkfs.ext4 -d` needs all content upfront; reflinks fail between FUSE and XFS | 350–450 |
| Results | The turn's chart again, same layout, new system against the naive baseline and the previous system. The headline number goes in prose with both endpoints. | "`bun install` … dropped 12x, from 12.5 seconds to 1.07 seconds." | 150–250 |
| Close | Where to get it (version, docs link) and what is still open, in one to three sentences | "generally available"; a screenshot of the open PR that comes next | 30–60 |

The whole post runs about 2,000–2,800 words in English. The redesign and its implementation are the
longest sections; the results section stays short because its figures carry it.

Adapt the slots and keep the order. Not every story has a shipped plan that failed. When yours does
not, the turn's slot holds the problem measured on the current system, such as the regression that
started the work. What holds in every post is that a measured problem comes before its fix, and the
fix's cost is named.

**Not in the shape:**
- a TL;DR box, a dek, or an "In this post we will…" agenda list (the opening's last sentence is the
  scope);
- "Introduction", "Overview" or "Conclusion" headings;
- a closing recap of what the reader just read.

Acknowledgements, with full names, are optional and go last.

## Figures

- **One figure per idea the reader must hold**, placed right after the paragraph that introduces it.
- **Draw mirror pairs.** The old and new data paths, and the old and new per-operation timelines,
  use the same layout, scale and labels. The reference post pairs figures 1↔6, 4↔5 and 3↔7.
- **A caption states the finding, with its numbers.** "virtio-fs + ImageFS is slowest on every
  operation: chown 9.87 s against 2.31 s on gVisor and 1.58 s on ImageFS", never "Benchmark
  results". The blog renders `![alt](…)` as a bare `<img>` with no caption element. The alt text
  therefore carries the finding. A figure that needs a visible caption gets a one-line italic
  paragraph directly under it.
- **Charts:**
  - Charts are SVG, with units on the axis. Each system keeps one colour across every chart in the
    post, and ours stays distinguishable from the baseline in greyscale.
  - Labels are per language, so a chart is a pair: `<name>-en.svg` / `<name>-zh.svg`.
  - Everything is hosted in the community repo's `blog-assets/`, per `reference/authoring.md`.
- **Table or chart.**
  - A table holds exact numbers a reader will look up.
  - A chart shows a comparison a reader should see at a glance.
  - Do not show the same numbers in both. The exception is the headline number, which also goes
    in prose.
- A screenshot of a real PR or issue is a good close for "what's next".

## Numbers

- **Units.** Every number carries its unit. Every ratio appears with both endpoints at least once.
- **Baselines.** The baseline is the naive design and the previous system, never a strawman nobody
  would ship.
- **Method.** One sentence says how the numbers were measured:
  - the count (e.g. "100,000 calls each");
  - the machine and the version;
  - whether they come from a live provider or from a simulator or recording.

  The reference post leaves this out; ours do not. When the numbers are not live, the results
  section says so in its first paragraph, not in a footnote.
- **Arithmetic.** Check every relative claim against its figure: "over 6x" has to match
  9.87 s / 1.58 s.
- **Reproducibility.** The numbers come from a run made for this post. The command that
  regenerates them goes in the PR description. A throwaway script may stay out of the repo, but
  its location is named there.
- **Paid APIs.** Live measurements that call paid model APIs need the user's go-ahead and a key
  they authorize for that purpose.

## Voice

**English**
- **Person and tense.** "We" is the team. "You" appears only in the close and when the reader's own
  setup is meant. Past tense covers what happened; present tense covers how it works.
- **Jargon.** Gloss a term at first use, in parentheses or in the sentence before (FUSE,
  "Filesystem in Userspace").
- **Analogies.** Use at most one per hard idea, and it must be technically true: blocks as "the
  language spoken by physical drives".
- **Rhythm.** Long explanatory sentences, with a short one where a result lands ("And indeed, it
  worked."). Humour is allowed when it is about the work ("the creatively named ImageFS-blk"),
  never about readers or competitors.
- **Headings.** Sentence case, saying what happens in the section; a play on words is fine ("Fast
  to boot, slow to use").
- **Limits that still apply.** One rhetorical question at most, as the turn. One or two exclamation
  marks at most, on a real result. The ai-slop copy tells hold in full:
  - no "not just X — it's Y";
  - no "blazing-fast" or "seamless";
  - no paragraphs of three-word sentences;
  - no em-dash triplets.

**Chinese**
- Write the zh post from the shared outline; do not translate the en post sentence by sentence.
  Both posts keep the same sections, figures (zh labels), numbers and links.
- A pun in an en heading rarely survives translation. Pick a zh heading that does the same job.
- Watch for translationese: chains of 「被」 sentences, 「进行」 used as a verb, 「对于……来说」,
  and long stacks of 「的」.
- The docs typography rules apply: spaces between CJK and Latin text and numbers, full-width
  punctuation, 「Agent」, and standard English casing for technical terms.

## Polishing with a model

Polishing is optional.

- **Section by section.** Send one section at a time, with an instruction built from the Voice
  section above. The fixed instruction in `penguin-harness-dev`'s
  `scripts/polish-release-prose.mjs` is the release-notes voice (it forbids rhetorical questions,
  for one), so do not run that script unchanged over a technical post.
- **Constraints to state in the instruction.** Every code span, number, table, link and heading
  comes back byte-identical. Keep the input's language.
- **Review.** Read every suggested edit against the facts, and reject any that changes a meaning, a
  number, an identifier or a term. The model's output is a suggestion.
- **Keys.** The key comes from an environment variable or a key file, and never appears in a file,
  commit, PR or log.

## Before the PR

- The opening ends with the scope sentence. There is no TL;DR.
- Every section's last sentence moves the story on. Recap sentences are deleted.
- A measured problem precedes the fix, and the fix's cost is named.
- Figures:
  - every figure appears after the prose that introduces it;
  - alt text or the caption states the finding with numbers;
  - before/after figures share a layout;
  - every chart has an en and a zh file.
- Numbers:
  - every number has a unit, a baseline and a source;
  - the method sentence is there;
  - every ratio checks out.
- en and zh match in headings, figures, numbers and links.
- The mechanics in `reference/authoring.md` are followed, and the checks pass: `format:check` and
  the landing package tests (`penguin-harness-dev`'s verification table), and the ai-slop
  `scan.mjs` over both files.
