---
name: penguin-harness-blog
description: "Use when writing or revising a penguin.ooo blog post of any category: the division of labour (a gateway model writes every reader-facing word, agents research, prompt, draw, check and ship), the FACTS guard, the prompt files, the figure rules, the checks, and how it is verified."
---

# Writing a penguin.ooo blog post

A post here is written by a model on the TokenDance gateway, one API call per text step, and
shipped by agents. This page is the contract; `scripts/blog-prose.mjs` is the only way text
reaches a draft, and `prompts/` plus `reference/` hold every word that is sent to the model.
`penguin-harness-dev/reference/authoring.md` covers what is true of every post (the bilingual
pair, frontmatter, where images live).

## 1. Who writes what

**The API model writes every word a reader sees**: outline, title, excerpt, body, every string
inside a figure, alt text and captions, the counterpart language, and every later fix. Each of
those is its own API call through `blog-prose.mjs`.

**Agents never type a sentence into a post.** They research, compile FACTS, write prompts and
findings, draw figures from the model's figure blocks, take screenshots, run the checks, review
blind, assemble and open the PRs. A wrong sentence is fixed by a `fix` call that carries a
numbered findings list, never by hand. The only hand edits allowed are mechanical: frontmatter
`date` / `category`, image paths and their `-en` / `-zh` suffixes, removing `{F#}` / `{O#}`
markers (`strip` does it), whitespace, and the boilerplate version note copied verbatim from an
existing post.

**The key never enters the repo.** It sits in a chmod-600 file outside the tree; the script reads
`TOKENDANCE_API_KEY` or the file named by `TOKENDANCE_KEY_FILE`, never an argument, and prints
neither. Raw responses (which include the model's reasoning) are saved beside the drafts in a
scratch directory and never committed.

The default model is `seed-2.1-pro`, a reasoning model: a call can take several minutes, its
reasoning counts against `max_tokens` (32000 by default), and `finish_reason: length` is a
failure, not a short answer. The key has a concurrency cap; run at most three calls at once and
let the script's 429 backoff absorb the rest. `--model` overrides the default per call.

## 2. The pipeline

All work happens in a scratch directory, one folder per post:
`<scratch>/articles/<slug>/` for inputs and drafts, `<scratch>/articles/raw/` for raw responses
(`--raw-dir`). Drafts are versioned by name: `outline.v1.md`, `draft.en.v1.md`,
`draft.en.v2.md`, `findings.en.v1.md`, `review.en.v1.md`, … — the `.en.` / `.zh.` token is how
the script knows the language.

| Step | Who | Input | Output |
| --- | --- | --- | --- |
| Research | agents | web + repo | briefs; every claim with a URL or a repo path |
| FACTS | agent | briefs, the author's brief | `facts.md` (section 3) |
| Outline | API `outline` | brief, facts, research summaries | thesis, title candidates, sections with F/O ids, the figure plan; one feedback round at most (`--feedback` + `--previous`); the plan becomes `figures.md`, the manifest of final stems |
| Write | API `write` | approved outline, `figures.md`, facts | `draft.<src>.v1.md` with markers and one figure block per manifest figure |
| Check | `check` | draft + facts + manifest | exits 1 on hard hits |
| Review | API `review` + agents | draft (+ facts) | the model's editor pass (flow, naturalness, concision); an agent's fact diff and a blind truth reviewer; all merged into one numbered findings list |
| Fix | API `fix` | draft + findings + facts | next draft version; repeat check → review → fix until the findings are empty, three rounds at most, then ask the author |
| Translate | API `translate` | frozen source draft + TERMS | `draft.<tgt>.v1.md`, paragraph-aligned, markers and figure block keys kept, values translated |
| Polish | API `polish` | target draft only | translationese removed, facts untouched |
| Check + parity | `check --pair` | both drafts | same headings, figure blocks, code spans, URLs, markers; numbers compared |
| Review (target) | API `review` + a native-reader agent | target draft only | findings → `fix` |
| Figures | agents | the frozen figure blocks | drawn sources whose every string is in the block (`check --svg`); screenshots picked or captured |
| Strip + assemble | `strip` + agent | frozen drafts | `<slug>.en.md` / `<slug>.zh.md`, figure sources, `blog.test.ts`, changelog pair |
| Verify + ship | agent | worktree | landing tests + format check, community PR first (section 7) |

Figures are drawn **after** the text is frozen, because the words inside a figure come from the
model's figure block like every other sentence.

## 3. The FACTS file and the markers

`facts.md` has five sections, each a `## ` heading:

- `## FACTS` — atomic, numbered facts, each with its source: `- F1: … Source: <url or repo path>`.
- `## OPINIONS` — the author's thesis points, ours to assert: `- O1: …`.
- `## TERMS` — spelling, the zh rendering and the UI labels, as a table whose first column is the
  term. `translate` sends this section as its term list.
- `## NOT-FACTS` — claims the model must not make, stated plainly.
- `## EXISTING-FIGURES` — the published screenshots the outline may reuse, by stem.

The writer may make a factual claim only when FACTS holds it. Every factual sentence ends with its
id (`{F3}`, several as `{F3}{F7}`), every position with an OPINIONS id (`{O1}`); headings,
figure blocks, frontmatter and the footer carry none. No URL, number, product name, quote or UI
label outside FACTS / TERMS. `check --facts` rejects an unknown id or a URL outside FACTS and
lists numbers and code spans it cannot find there; the agent's fact diff reads each marked
sentence against its fact. `strip` removes the markers mechanically before publishing.

## 4. Source language

English first by default: the post is written in English, `translate --to zh` re-authors it, and
`polish` removes what still reads translated. Write Chinese first when the title, a meme or the
sources are Chinese (design-repo specs, a title the author fixed in Chinese): `outline --lang zh`,
a `draft.zh.v1.md`, then `translate --to en`. The steps are symmetric. If a polished translation
still reads translated after one fix round, re-author that language from the outline and FACTS
(`write` with a `.<tgt>.` output name) instead of iterating on the translation.

## 5. Figures

**Kinds.** Diagrams we draw (layers, a comparison, a tree, a flow), real product screenshots in the
light theme (captured with the e2e harness and its mock LLM, or reused from the published
inventory), or a Markdown table when the comparison is words. No AI-generated illustrations,
gradients, glows, shadows, emoji or icons, and no invented data: a conceptual comparison is drawn
as states or flows, never as a chart with made-up numbers.

**The words come from the model.** `write` emits one figure block per manifest figure, at its
position:

````markdown
```figure id=<stem>
alt: <one sentence: what is in the picture>
caption: <one sentence: what the reader should take from it>
title: <the figure's own heading, when it has one>
text:
- <where>: <a string drawn in the figure>
```
````

`<where>` is a lowercase English word or two (box, column, layer, arrow, note, …) that tells the
drawer where the string goes. `translate` translates the values and keeps the ids, keys and item
order, so both languages draw from the same layout. A drawer who needs a string the block lacks
asks for it through a `fix` finding; `check --in <draft> --svg <file|dir>` fails any drawn string
that is not in the block (whitespace normalised, no spaces between CJK characters) and warns about
block strings never drawn. A screenshot's block has `alt` and `caption` only.

**Format and rendering.** _Being decided; this part is a stub._ Until it is settled, `strip` turns
each block into `![alt](/blog-assets/<id>-<lang>.png)` plus its italic caption, the published
form of every post so far.

**Naming and home.** `<prefix><stem>-<lang>.png`, one per language, light theme. Binary assets go
to `Prism-Shadow/penguin-harness-community` under `blog-assets/`; posts reference them as
`/blog-assets/<name>` and the renderer resolves the host (`authoring.md`). Figure sources, never
binaries, are committed with the post.

## 6. Checks

- **`check`** (local, no network) reads a draft or a published post and exits 1 on a hard hit:
  frontmatter fields and quoting, the version note (`--version-note`), a lead before the first
  heading, 4–6 `## ` sections and no `###` or numbered headings, figure blocks complete and in
  manifest order (`--figures`), image paths with the file's language, the `**Sources**` footer
  last, no in-page anchors, callouts, raw HTML, emoji or leaked `{{SLOT}}`s, markers against
  FACTS (`--facts`), every referenced image present (`--assets`), the drawn figures (`--svg`) and
  the parity of a pair (`--pair`). Then the language rules: the patterns at the end of
  `reference/en-style.md` / `reference/zh-style.md`, plus what the script counts (em dashes per
  section, exclamation marks, list and paragraph length, CJK–Latin spacing, `——`, ASCII quotes and
  colons in Chinese). Warnings are for a person to judge.
- **The fact diff** (agent): every number, URL, code span, bold or 「」 label and proper noun
  resolves to a FACT or TERM; headings and figures match the outline.
- **Review**: the API `review` step (an editor's findings on flow, naturalness and concision, in
  the form `fix` consumes) and two blind agent reviewers — one with FACTS and the sources reading
  for truth, one with the draft only reading as the target reader — after every write, translate
  and polish. A third, native-reader review runs on the target language.
- **The fix loop** is capped at three rounds; after that the author decides. Nobody hand-edits
  prose at any point.

Findings, from any reviewer, are numbered and quote the passage:
`N. [passage quoted verbatim] — problem — the fact (F#) or rule it violates — what the fix must achieve (not the wording)`.

## 7. Assembly

- `strip --in <frozen draft> --out packages/landing/content/blog/<slug>.<lang>.md` for both
  languages; it prints the model's trailing notes (`<!-- omitted: … -->`,
  `<!-- not applied: … -->`) so they are read, not lost. Run `check --pair --assets
  <community checkout>/blog-assets` on the stripped pair.
- `packages/landing/test/blog.test.ts` pins post order per category: a new post edits that list.
- A changelog pair in `changelog/unreleased/` (`Type: process`, `Scope: landing`), per
  `penguin-harness-dev/reference/changelog.md`.
- The community PR with the images merges first; the post's PR after it, since posts resolve
  `/blog-assets/<name>` to the community repo's `main`.

## 8. Verification

The posts are Markdown, which `format:check` skips; they are covered by `check`, by the landing
package's blog tests (content integrity, anchors, links) and by reading. A post PR runs the
landing tests and `format:check`; `node .agents/skills/penguin-harness-dev/reference/ai-slop/scan.mjs
packages/landing/content/blog` is a cheap extra pass. When the author asks for the suite on
another machine, `penguin-harness-dev/reference/verification.md` has the remote runner and its
traps.

## 9. Files

| Path | What it holds |
| --- | --- |
| `scripts/blog-prose.mjs` | The runner: API steps `outline`, `write`, `translate`, `polish`, `fix`, `review`; local steps `check`, `strip`, `pair`. `--help` lists every option; `--dry-run` prints the assembled messages without calling or saving |
| `prompts/<step>.system.md`, `prompts/<step>.user.md` | One prompt pair per API step; `{{SLOT}}`s filled by the script, and any slot left unfilled aborts the call |
| `prompts/markdown-contract.md` | The output contract shared by `write`, `translate`, `polish` and `fix` |
| `prompts/fragments.md` | Prompt text used as slot values: the version-note rule, the meme brief, the outline feedback block, the default translate title rules, the translation tells, the review's FACTS lines |
| `reference/en-style.md`, `reference/zh-style.md` | The voice and the full banned lists. The block between the `prompt` markers is what the model receives; the check patterns below it are what `check` greps for; change both together |

The prompts are written for the `perspectives` category; a post of another category gets the
same pipeline, with the contract's `category` line and the post-type sentence of the step prompts
adjusted in the same PR.
