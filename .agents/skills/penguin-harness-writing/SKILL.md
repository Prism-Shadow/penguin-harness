---
name: penguin-harness-writing
description: "Use when writing or revising reader-facing prose for penguin.ooo — a blog post of any category, a docs page, or landing-page copy: the division of labour (a gateway model writes every reader-facing word, agents research, prompt, draw, check and ship), the profiles, the FACTS guard, the prompt files, inline SVG figures drawn from the model's figure blocks, the checks, and how it is verified."
---

# Writing for penguin.ooo

Posts, docs pages and landing copy are written by a model on the TokenDance gateway, one API call
per text step, and shipped by agents. This page is the contract; `scripts/prose.mjs` is the only
way text reaches a draft, and `prompts/` plus `reference/` hold every word sent to the model.
`penguin-harness-dev/reference/authoring.md` covers what is true of every post (the bilingual
pair, frontmatter, where screenshots live).

## 1. Who writes what

**The API model writes every word a reader sees**: outline, title, excerpt, body, every string
inside a figure, alt text and captions, the counterpart language, every docs sentence and landing
string, and every later fix. Each is its own API call through `prose.mjs`.

**Agents never type a sentence into the text.** They research, compile FACTS, write prompts and
findings, draw figures from the model's figure blocks, take screenshots, run the checks, review
blind, assemble and open the PRs. A wrong sentence is fixed by a `fix` call that carries a numbered
findings list, never by hand. The only hand edits are mechanical: frontmatter `date` /
`category`, screenshot paths and their `-en` / `-zh` suffixes, removing `{F#}` / `{O#}` markers
(`strip` does it), whitespace, the boilerplate version note copied verbatim from an existing post,
and copying landing strings into the dictionaries verbatim.

**The key never enters the repo.** It sits in a chmod-600 file outside the tree; the script reads
`TOKENDANCE_API_KEY` or the file named by `TOKENDANCE_KEY_FILE`, never an argument, and prints
neither. Raw responses (which include the model's reasoning) are saved in a scratch directory and
never committed.

The default model is `seed-2.1-pro`, a reasoning model: a call can take several minutes, its
reasoning counts against `max_tokens` (32000 by default), and `finish_reason: length` is a
failure. The key has a concurrency cap; run at most three calls at once and let the script's 429
backoff absorb the rest. `--model` overrides the default per call.

## 2. Profiles

What differs by kind of text lives in one profile, `reference/profile-<name>.md`, chosen with
`--profile <name>` (or `--category`, its shorthand; by default the input's frontmatter decides):

| Profile | For | Contract |
| --- | --- | --- |
| `blog-perspectives` | a perspective post: one thesis, a lead, 4–6 sections | `prompts/contract-post.md` |
| `blog-practice` | a technical post: the system-post shape, numbers rules, TL;DR | `prompts/contract-post.md` |
| `docs` | a page of `packages/docs/content/`, Obsidian-Help style | `prompts/contract-docs.md` |
| `landing` | strings for the landing page's dictionaries | `prompts/contract-landing.md` |

A blog category without a profile file (`blog-news`, `blog-changelog`) needs `--profile <file>`
until one is written; `--profile <file>` also tries a profile before it lands.

A profile holds the reader, the shape, the length and any rule that overrides the style guide for
that kind of text, inside `<!-- prompt -->` markers (a `<!-- prompt zh -->` block, when present,
replaces it for Chinese). The model receives it after the style guide, introduced as winning where
the two differ. A profile does not repeat the style guide's voice or banned lists, and it states
nothing about the product: facts come from FACTS only. Its `## Check settings` (`sections: 4-6`,
`lead: yes`, `tldr: yes`, `exclamations: 0`) is what `check` enforces for it, and a prompt rule
with no matching setting is a rule `check` cannot see; change the two together.

## 3. The pipeline

All work happens in a scratch directory, one folder per piece: `<scratch>/articles/<slug>/` for
inputs and drafts, `<scratch>/articles/raw/` for raw responses (`--raw-dir`). Drafts are
versioned by name (`outline.v1.md`, `draft.en.v1.md`, `findings.en.v1.api.md`, …); the `.en.` /
`.zh.` token is how the script knows the language, and the folder name is the slug the figure ids
carry.

| # | Step | Who | Notes |
| --- | --- | --- | --- |
| 1 | Research | agents | every claim with a URL or a repo path |
| 2 | FACTS | agent | `facts.md` (section 4) |
| 3 | `outline` | API | profile, word budget, figure count; one feedback round at most (`--feedback` + `--previous`); pick the title; freeze the figure ids into `figures.md` (id, kind, shows, working labels) |
| 4 | `write` | API | the text, with one figure block per manifest figure; nothing is drawn yet |
| 5 | `check` | script | structure, markers, banned phrases, `--figures` coverage |
| 6 | `review` + truth review | API + agent | the model's editor pass and an agent reading against FACTS and the sources; merged, deduplicated, numbered |
| 7 | `fix` | API | repeat 5–7 until both reviews return `none`, three rounds at most, then ask the author |
| 8 | `translate` | API | figure blocks translated string for string, same count and order |
| 9 | `polish` | API | target language only |
| 10 | `review --tells` + native reader | API + agent | → `fix`, same cap |
| 11 | `pair` | script | headings, figure ids and string counts, code spans, URLs, markers, date, category; numbers compared |
| 12 | Draw | agent | from the frozen blocks, each language separately (section 6) |
| 13 | `check --svg` | script | every drawn file against its block |
| 14 | `strip` → assembly | script + agent | inline the figures, screenshot suffixes, files into the worktree (section 8) |
| 15 | Visual check | agent | on the test host, both languages, themes and widths (section 6) |
| 16 | Verify + PR | agent | section 9 |

**The ordering rule**: the text of a language is frozen before any figure of it is drawn, and no
string inside a figure is ours. A figure that needs a string its block lacks goes back through a
`fix` finding.

## 4. The FACTS file and the markers

`facts.md` has five sections, each a `## ` heading:

- `## FACTS` — atomic, numbered facts with their source: `- F1: … Source: <url or repo path>`.
- `## OPINIONS` — the author's thesis points, ours to assert: `- O1: …`.
- `## TERMS` — spelling, the zh rendering and the UI labels, as a table whose first column is the
  term. `translate` sends this section as its term list; a docs page's TERMS carries the labels
  exactly as the product's dictionaries spell them.
- `## NOT-FACTS` — claims the model must not make.
- `## EXISTING-FIGURES` — published screenshots the outline may reuse, by stem.

The writer makes a factual claim only when FACTS holds it. `write` ends every factual sentence
with its id (`{F3}`, several as `{F3}{F7}`) and every position with an OPINIONS id (`{O1}`);
headings, figure blocks, frontmatter and the footer carry none. `translate` and `polish` keep the
markers exactly as they are and never add one; `fix` adds one only on a sentence a finding changed.
After each of those three calls the script prints any marker it saw added or dropped. No URL,
number, product name, quote or UI label outside FACTS / TERMS: `check --facts` rejects an unknown id
or a URL outside FACTS and lists numbers and code spans it cannot find there. `strip` removes the
markers before publishing.

## 5. Source language

English first by default: write in English, `translate --to zh` re-authors it, and `polish`
removes what still reads translated. Write Chinese first when the title, a meme or the sources are
Chinese (`outline --lang zh`, a `draft.zh.v1.md`, then `translate --to en`); the steps are
symmetric. If a polished translation still reads translated after one fix round, re-author that
language from the outline and FACTS (`write` with a `.<tgt>.` output name) instead of iterating.

## 6. Figures

**Kinds.** Diagrams and charts we draw as inline SVG, real product screenshots in the light theme
(captured with the e2e harness and its mock LLM, or reused from the published inventory), or a
Markdown table when the comparison is words. No AI-generated illustrations, gradients, glows,
shadows, emoji or icons, and no invented data: a conceptual comparison is drawn as states or flows,
never as a chart with made-up numbers.

**The words come from the model.** `write` emits one figure block per manifest figure, at its
position:

````markdown
```figure id=<stem>
alt: <one sentence: what is in the picture>
caption: <one sentence: what the reader should take from it>
title: <the heading drawn inside the picture, when it needs one>
text:
- <where>: <a string drawn in the figure>
```
````

`<where>` is a lowercase English word or two (box, column, layer, arrow, note, …) telling the
drawer where the string goes. A block with `alt` and `caption` only is a screenshot.

**Drawn figures are inline SVG in the post**, one file per figure and language,
`<scratch>/articles/<slug>/figures/<id>.<lang>.html`, holding exactly one
`<figure class="post-figure" data-figure="<id>">` with:

- `<svg class="fig-svg" viewBox="0 0 560 <h>" role="img" aria-labelledby="<slug>-<id>-<lang>-title">`
  whose `<title id="…">` is the block's `alt`;
- a `<text>` / `<tspan>` leaf for every `text:` string, at least once, and no leaf containing a
  letter (Latin or CJK) that is not a `text:` string or the block's `title` (numeric-only leaves —
  digits, `%`, `×`, `#`, punctuation — are exempt, so axis ticks need no listing);
- then `<ol class="fig-steps">` with one `<li>` per `text:` string in order (visually hidden, read
  by screen readers), then `<figcaption>` with the block's `caption`.

Marks carry the site's figure classes from `packages/landing/src/styles.css` (`.post-figure`,
`.fig-svg`, the `.fig-*` text and structure classes, series `.fig-s1`–`.fig-s3` whose meaning the
post's legend assigns), never inline colours; dark mode comes from their `html.dark` variants. No
blank line inside a figure (a blank line ends a CommonMark HTML block); `<`, `>` and `&` in strings
are escaped; every id starts with `<slug>-<id>-<lang>`. A chart generated from data is drawn by a
throwaway script in the scratch directory that reads the numbers and the figure block and refuses
to emit a string not in the block; mirror pairs share one script and one scale. zh and en are drawn
from their own blocks, on the same layout, wider where CJK needs it. Read the `dataviz` skill before
any chart and use the site tokens, not its placeholder palette.

`check --in <draft> --svg <figures dir>` proves each drawn file against its block, in both
directions, comparing text after unescaping (a block string such as `<root>/<project>/` is data,
and the drawing must escape it); `strip --figures-dir <figures dir>` refuses a file that does not
match its block and inlines the rest as one line; and `check --in <post> --draft <draft>` re-runs
the same assertions on the stripped post.

**Screenshots** stay in `Prism-Shadow/penguin-harness-community` under `blog-assets/`,
referenced as `/blog-assets/<name>-<lang>.png`; a new one is merged there before the post's PR.
`strip` writes them as an image line plus an italic caption, escaping `<`, `>` and `&` outside
code spans so a placeholder in the alt text or caption stays text.

**Visual check**, on the test host only (a browser runs nowhere else): build the landing
(`--build "@prismshadow/penguin-landing..."` with the remote runner), serve it with
`pnpm --filter @prismshadow/penguin-landing preview --port <p>`, and drive a scratch Playwright
script over the post in both languages, light and dark (the `html.dark` class, set the way the
site's toggle sets it), at 1280 and 390 px. Assert `scrollWidth <= innerWidth`, no console or page
errors, every `.fig-steps` hidden and every figure inside the prose column; save the screenshots and
look at them (labels not clipped, CJK inside its boxes, strokes visible in dark). `curl` there may
need `--noproxy '*'`.

## 7. Checks

- **`check`** (local, no network) exits 1 on a hard hit. For every kind: frontmatter fields, a lead
  where the profile asks for one, the profile's section range and TL;DR rule, no numbered headings,
  no emoji, raw HTML or leaked `{{SLOT}}`s, markers against FACTS (`--facts`), and the language
  rules — the patterns at the end of `reference/en-style.md` / `reference/zh-style.md` plus what
  the script counts (em dashes per section, exclamation marks against the profile, list and
  paragraph length, CJK–Latin spacing, `——`, ASCII quotes and colons in Chinese). For posts also:
  `## ` only, figure blocks complete and in manifest order (`--figures`), drawn figures
  (`--svg`, `--draft`), screenshot paths with the file's language and present (`--assets`), the
  `**Sources**` footer last, no in-page anchors. Landing strings are checked as `key: text` lines.
  Warnings are for a person to judge.
- **The fact diff** (agent): every number, URL, code span, bold or 「」 label and proper noun
  resolves to a FACT or TERM; headings and figures match the outline.
- **Review**: the API `review` step (an editor's findings on naturalness, flow and concision, in
  the form `fix` consumes, never a rewrite) and the agents' blind reviews — a truth reviewer with
  FACTS and the sources, a reader without them, a native reader for the target language.
- **The fix loop** is capped at three rounds; after that the author decides. Nobody hand-edits
  prose at any point.

Findings, from any reviewer, are numbered and quote the passage:
`N. [passage quoted verbatim] — problem — the fact (F#) or rule it violates — what the fix must achieve (not the wording)`.

## 8. Assembly

- **A post**: `strip --in <frozen draft> --out packages/landing/content/blog/<slug>.<lang>.md
  --figures-dir <figures dir> [--assets <community>/blog-assets]` for both languages. It prints the
  model's trailing notes (`<!-- omitted: … -->`, `<!-- not applied: … -->`) so they are read.
  Then `check --in <post> --draft <draft> --pair <other post>`.
  `packages/landing/test/blog.test.ts` pins post order per category, so a new post edits that
  list. Add a changelog pair (`Type: process`, `Scope: landing`) per
  `penguin-harness-dev/reference/changelog.md`.
- **A docs page**: `strip` to `packages/docs/content/<slug>.<lang>.md`; a new page is also added
  to `src/lib/nav.ts`, which the docs package's content test keeps in sync.
- **Landing strings**: each `key: text` line is copied verbatim into `strings-en.ts` or the zh
  dictionary in `strings.ts`.

## 9. Verification

Markdown is skipped by `format:check`; the text is covered by `check`, by the landing package's
blog tests (content integrity, anchors, links) or the docs package's content tests, and by reading.
A post PR runs the landing tests, `format:check` and
`node .agents/skills/penguin-harness-dev/reference/ai-slop/scan.mjs packages/landing/content/blog`.
When the author asks for the suite on another machine, `penguin-harness-dev/reference/verification.md`
has the remote runner and its traps. After changing the script, a contract or the check patterns,
run `node .agents/skills/penguin-harness-writing/scripts/prose.mjs selftest` (local, no
network): it runs `check` and `strip` on built-in fixtures, and a case that guards a fixed bug goes
there.

## 10. Files

| Path | What it holds |
| --- | --- |
| `scripts/prose.mjs` | The runner: API steps `outline`, `write`, `translate`, `polish`, `fix`, `review`; local steps `check`, `strip`, `pair`, `selftest`. `--help` lists every option; `--dry-run` prints the assembled messages without calling or saving |
| `prompts/<step>.system.md`, `prompts/<step>.user.md` | One prompt pair per API step; `{{SLOT}}`s filled by the script, and any slot left unfilled aborts the call |
| `prompts/contract-post.md`, `contract-docs.md`, `contract-landing.md` | The output contract for each kind of text |
| `prompts/fragments.md` | Prompt text used as slot values: the marker rules, the version-note rule, the meme brief, the outline feedback block, the default translate title rules, the translation tells, the review's FACTS lines |
| `reference/en-style.md`, `reference/zh-style.md` | Voice and the full banned lists, for every kind of text. The block between the `prompt` markers is what the model receives; the check patterns below it are what `check` greps for; change both together |
| `reference/profile-<name>.md` | One per kind of text (section 2) |
