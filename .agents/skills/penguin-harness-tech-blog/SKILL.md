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
| TL;DR, optional | Three to five bullets with the headline numbers, right after the opening | (none; the reference post goes straight on) | 50–100 |
| Background | The existing system the reader must hold in mind, and the property the new work has to keep. One diagram. | ImageFS: lazy loading, cache tiers, OverlayFS for writes | 150–250 |
| The obvious plan | The constraint, and the natural answer to it. Let it look right. | virtio-fs bridges the VM boundary; boot is fast. "So we shipped it… right?" | 150–250 |
| The turn | The measurement that broke the plan, against a baseline. Then one operation taken apart on a timeline with real units, down to a root cause stated in one sentence. | Bar chart of five operations; one `chown` = three host round trips, 99 µs; "virtio-fs is a _shared_ filesystem" | 300–400 |
| The redesign | The idea in one sentence first, then the mechanism. Name what it costs and what it buys. | "speaking in blocks"; "the host … loses its ability to work with the VM's filesystem. In return…" | 350–450 |
| Making it real | The hard part of the redesign. The naive implementation and the exact reason it fails. | `mkfs.ext4 -d` needs all content upfront; reflinks fail between FUSE and XFS | 350–450 |
| Results | The turn's chart again, same layout, new system against the naive baseline and the previous system. The headline number goes in prose with both endpoints. | "`bun install` … dropped 12x, from 12.5 seconds to 1.07 seconds." | 150–250 |
| Close | Where to get it (version, docs link), in one or two sentences | "generally available" | 30–60 |

The whole post runs about 2,000–2,800 words in English. The redesign and its implementation are the
longest sections; the results section stays short because its figures carry it.

Adapt the slots and keep the order. Not every story has a shipped plan that failed. When yours does
not, the turn's slot holds the problem measured on the current system, such as the regression that
started the work. What holds in every post is that a measured problem comes before its fix, and the
fix's cost is named.

**A post about a system or tool we built** (a test harness, a diagnostic, a pipeline) follows the
owner's order instead (2026-10-17):

1. why it had to exist, with the stakes measured;
2. how it is designed;
3. how to use it;
4. what it measured;
5. one worked example at the end, from a real run.

The figure, number and voice rules below apply to it unchanged.

**Not in the shape:**
- a dek, or an "In this post we will…" agenda list (the opening's last sentence is the scope);
- "Introduction", "Overview" or "Conclusion" headings;
- a closing recap of what the reader just read;
- TODOs, a roadmap, "what's next" or open recommendations (owner, 2026-10-17). A post reports what
  exists; plans go in issues.

Acknowledgements, with full names, are optional and go last.

## Figures

A technical post is drawn, not only written (owner, 2026-10-17). Every post needs at least one
diagram of the mechanism, and a chart for each measurement it argues from. A table alone does not
count as a figure.

- **Inline SVG in the post's Markdown.** The model is the agent-loop flowchart in the MMSP docs
  (<https://mmsp.penguin.ooo/docs/agent-loop/>). Its source is in the agenthub repo:
  `site/src/docs/agent-loop.en.md` and the `.flowchart` rules in `site/src/styles/global.css`.
  - A `<figure>` holds `<svg viewBox="…" role="img" aria-labelledby="…">` with a `<title>`,
    followed by a `<figcaption>`.
  - Marks carry classes, never inline colours. The `.post-figure` and `.fig-*` rules in
    `packages/landing/src/styles.css` style them from the site palette (`--site-*`), with
    `html.dark` variants, so a figure follows the theme. Reuse those classes, and add one there
    when a figure needs a new kind of mark. Nothing else reads post bodies (the landing site has no
    blog search index, RSS feed or Markdown export), so the SVG needs no text conversion.
  - SVG text is in the file's language. The en and zh posts each carry their own copy, so a drawn
    figure needs no asset pair and no hosting step.
  - The same content as text (the steps, or the numbers) sits in a visually hidden list after the
    `<svg>`. It serves screen readers and anything that reads the post as Markdown.
  - Every id is unique per figure and per language (`<slug>-<figure>-en-…`), because all ids share
    one page.
- **Go beyond boxes and arrows when that explains more.** The owner asked for bolder figures than
  a plain flowchart: request strips coloured by state, timelines with real units, annotated charts,
  before/after splits. The ai-slop rule still decides:
  - every mark, colour and motion encodes something: a state, a quantity or a step;
  - each state keeps one colour across every figure in the post, and stays legible in greyscale and
    in dark mode;
  - motion appears only to show a process, never as atmosphere, and is off under
    `prefers-reduced-motion`;
  - no decorative gradients or glows.
- **Draw from the data.** Generate a chart's SVG from the same output the tables and the prose come
  from (a throwaway script is fine), so a bar and the number beside it cannot disagree. Units go on
  the axis.
- **One figure per idea the reader must hold**, placed right after the paragraph that introduces it.
- **Draw mirror pairs.** The old and new data paths, and the old and new per-operation timelines,
  use the same layout, scale and labels. The reference post pairs figures 1↔6, 4↔5 and 3↔7.
- **A caption states the finding, with its numbers.** "virtio-fs + ImageFS is slowest on every
  operation: chown 9.87 s against 2.31 s on gVisor and 1.58 s on ImageFS", never "Benchmark
  results".
- **Screenshots and video are captured, not drawn.** They are hosted in the community repo's
  `blog-assets/`, per `reference/authoring.md`. The blog renders `![alt](…)` as a bare `<img>`
  with no caption, so the alt text carries the finding, and a visible caption is a one-line italic
  paragraph under the image.
- **Look at every figure as a reader will.** Render the post page in the light and the dark theme,
  at desktop width and at 390 px. On a narrow screen a wide figure scrolls inside the prose column,
  as tables do, instead of shrinking its text below legibility; the page itself never scrolls
  sideways.
- **Table or chart.**
  - A table holds exact numbers a reader will look up.
  - A chart shows a comparison a reader should see at a glance.
  - Do not show the same numbers in both. The exception is the headline number, which also goes
    in prose.

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

Every finished post gets a last pass through a model (owner, 2026-10-17: glm-5.3-flash). The pass
makes the prose read like a story the team lived, in natural language: connected paragraphs with
transitions, a developer talking to a developer, not a list of facts. The owner supplies the key for
each post. It is used for that post's polishing only.

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

- The opening ends with the scope sentence, and a TL;DR, if there is one, follows it.
- Every section's last sentence moves the story on. Recap sentences are deleted.
- No TODO, roadmap or "what's next" text anywhere.
- A measured problem precedes the fix, and the fix's cost is named.
- Figures:
  - there is a diagram of the mechanism, and a chart for each measurement the post argues from;
  - drawn figures are inline SVG with classes, a `<title>`, a `<figcaption>` and a hidden text
    equivalent;
  - every figure appears after the prose that introduces it;
  - the caption states the finding with numbers;
  - before/after figures share a layout;
  - every figure was looked at in both themes, at desktop and phone width.
- Numbers:
  - every number has a unit, a baseline and a source;
  - the method sentence is there;
  - every ratio checks out.
- en and zh match in headings, figures, numbers and links.
- The mechanics in `reference/authoring.md` are followed, and the checks pass: `format:check` and
  the landing package tests (`penguin-harness-dev`'s verification table), and the ai-slop
  `scan.mjs` over both files.
