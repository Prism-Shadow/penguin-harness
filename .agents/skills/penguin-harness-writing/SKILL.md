---
name: penguin-harness-writing
description: "Use when writing or revising reader-facing prose for penguin.ooo — a blog post of any category, a docs page, or landing-page copy: the division of labour (a gateway model writes every reader-facing word, agents research, prompt, assemble, draw, check and ship), the outline-then-sections flow with budgets, the FACTS guard and footnote citations, the profiles, inline SVG figures drawn from the model's figure blocks, the checks, and how it is verified."
---

# Writing for penguin.ooo

Posts, docs pages and landing copy are written by a model on the TokenDance gateway and shipped
by agents. A post is written the way a person writes one: an outline first, then one section at a
time, each within the size the outline gave it. This page is the contract; `scripts/prose.mjs` is
the only way text reaches a draft, and `prompts/` plus `reference/` hold every word sent to the
model. `penguin-harness-dev/reference/authoring.md` covers what is true of every post (the
bilingual pair, frontmatter, where screenshots live).

## 1. Who writes what

**The API model writes every word a reader sees**: the outline and its plan, every section, the
title and excerpt, every string inside a figure, alt text and captions, the second language, every
docs sentence and landing string, and every later fix. Each is its own API call through
`prose.mjs`.

**Agents never type a sentence into the text.** They research, compile FACTS, write prompts and
findings, put the model's sections together, draw figures from the model's figure blocks, take
screenshots, run the checks, review blind and ship. Putting the text into the manuscript is also
the agent's job, and it is mechanical: `assemble` joins the section files byte for byte and
`strip` publishes them. A wrong sentence goes back through a `fix` call with a numbered finding,
never through an editor. The only hand edits are mechanical: frontmatter `date` / `category`,
screenshot paths and their `-en` / `-zh` suffixes, whitespace, the boilerplate version note copied
verbatim from an existing post, and copying landing strings into the dictionaries verbatim.

**The key never enters the repo.** It sits in a chmod-600 file outside the tree; the script reads
`TOKENDANCE_API_KEY` or the file named by `TOKENDANCE_KEY_FILE`, never an argument, and prints
neither. Raw responses (with the model's reasoning) are saved in a scratch directory and never
committed.

The default model is `seed-2.1-pro`, a reasoning model: a call can take minutes, its reasoning
counts against `max_tokens` (32000 by default), and `finish_reason: length` is a failure. The key
has a concurrency cap; a post's calls run one after another, and the script's 429 backoff absorbs
the rest. `--model` overrides the default per call.

## 2. Profiles

What differs by kind of text lives in one profile, `reference/profile-<name>.md`, chosen with
`--profile <name>` (or `--category`, its shorthand; by default the input's frontmatter decides):

| Profile | For | Contract |
| --- | --- | --- |
| `blog-perspectives` | a perspective post: one thesis, a lead, a few short sections | `prompts/contract-section.md` (per section), `contract-post.md` |
| `blog-practice` | a technical post: the system-post shape, numbers rules, TL;DR | the same |
| `docs` | a page of `packages/docs/content/`, Obsidian-Help style | `prompts/contract-docs.md` |
| `landing` | strings for the landing page's dictionaries | `prompts/contract-landing.md` |

A blog category without a profile file needs `--profile <file>` until one is written;
`--profile <file>` also tries a profile before it lands.

A profile holds the reader, the shape, the sizes and any rule that overrides the style guide for
that kind of text, inside `<!-- prompt -->` markers (a `<!-- prompt zh -->` block, when present,
replaces it for Chinese). The model receives it after the style guide, introduced as winning where
the two differ. A profile does not repeat the style guide and states nothing about the product:
facts come from FACTS only. Its `## Check settings` are what the script enforces —
`sections`, `lead`, `tldr`, `exclamations`, and the budgets `words`, `lead-words`,
`section-words`, `zh-chars`, `zh-lead-chars`, `zh-section-chars`, `tldr-words`, `zh-tldr-chars`, each
`floor-cap`.
A prompt rule with no matching setting is a rule `check` cannot see; change the two together.

## 3. Voice

`reference/en-style.md` and `reference/zh-style.md` hold the voice and the banned lists for every
kind of text; the outline, section, translate, polish, fix and review calls all receive them.

One rule there asks the model to write for a reader with dyslexia, a person who reads with
effort: the point first, short sentences with one idea each, common words, no asides or "by the
way" detours, no defensive hedging, no padding. Stating the reader that way measurably shortens
the model's output and keeps it on its point. The one habit it does not remove is the
"Yes, but…" / 「是的，但是……」 concession pivot, so that pivot is banned by name next to the
"not X but Y" pivot, and `check` and `review` look for it.

## 4. The pipeline

All work happens in a scratch directory, one folder per post: `<scratch>/articles/<slug>/` for
inputs, the outline, `sections/` and drafts, `<scratch>/articles/raw/` for raw responses
(`--raw-dir`). The folder name is the slug the figure ids carry; the `.en.` / `.zh.` token in a
file name is how the script knows the language.

| # | Step | Who | Notes |
| --- | --- | --- | --- |
| 1 | Research, FACTS | agents | `facts.md` (section 6), each fact tagged with its sources |
| 2 | `outline` | API | thesis, title candidates, section bullets, the figure plan, and the `# Plan` table: one row per section with its size, facts, opinions, figures and how it ends |
| 3 | `plan` | script | checks the plan against the profile's budgets, the manifest and FACTS; a failure writes `outline-feedback.auto.md` for one rerun (`outline --feedback … --previous …`); a second failure goes to the author. `plan --freeze` writes `outline.final.md` |
| 4 | `section` 0 … N | API | one call per section, in order, each seeing the plan, the sections already written and only its own facts → `sections/s<n>.<lang>.v<k>.md` |
| 5 | `check --section` | script | after every section: size, shape, the figures its row owns, markers, style; an error → `section --feedback` (size, shape) or `fix` (wording) |
| 6 | `assemble` | script | joins the latest section files byte for byte → `draft.<lang>.vN.md` |
| 7 | `check` | script | the whole: total size, section count against the plan, markers against FACTS, sources |
| 8 | `review` + truth review | API + agent | the model's editor pass (flow across sections) and an agent reading against FACTS and the sources; merged and numbered |
| 9 | `route` → `fix` per section | script + API | findings split by the section that quotes them; one `fix` per affected section; back to 6. Two rounds per section and two whole-post rounds, then the author |
| 10 | `translate` per section | API | in order, each seeing the plan and the sections already translated; markers and figure blocks kept string for string |
| 11 | `polish` per section, `assemble`, `review --tells` + native reader, `route`, `fix` | API + agent | the same loop in the second language |
| 12 | `pair` | script | section by section: markers, citations, figure blocks, code spans, URLs; numbers compared; Chinese size against the English |
| 13 | Draw | agent | from the frozen figure blocks (section 9) |
| 14 | `check --svg` | script | every drawn file against its block |
| 15 | `strip` | script | citations, inline figures, screenshot lines; the first language, then the second with `--numbering-from` when its citations come in the same order (section 7) |
| 16 | Visual check, verify, PR | agent | sections 9 and 12 |

**The ordering rule.** The outline is frozen before the first section call; a section is final
before the next one starts; the text of a language is frozen before any figure of it is drawn; and
no string inside a figure is ours. A figure that needs a string its block lacks goes back through a
`fix` finding.

## 5. Budgets

Sizes are set three times, so a post cannot grow past them unnoticed:

1. **The plan.** The outline's `# Plan` table gives every section a number, in English words or
   Chinese characters (Chinese-first posts plan in characters). `plan` rejects a table whose rows
   exceed the profile's section cap, whose lead leaves the lead range, whose sum exceeds the total
   cap, or whose section count leaves the profile's range.
2. **The section call.** The prompt states the section's planned size and its cap, and says a
   section over its cap is written again.
3. **`check`.** A section above `min(plan × 1.1, profile cap)` is an error; so is a lead above its
   cap and a whole post above the total cap. Without `--outline`, the profile caps apply. Below a
   floor is a warning: short is allowed, empty is not.

A TL;DR, in a profile that has one (`tldr: yes`), is not part of the lead: the `**TL;DR**` line
and its bullets are counted apart and held to `tldr-words` / `zh-tldr-chars`, the plan's row 0
sizes the lead alone, and the lead's section call states the TL;DR budget separately.

An over-budget section is rerun with `--feedback`; nobody trims it by hand. Counting is the same
everywhere: English words are whitespace tokens holding a letter or digit, Chinese characters are
non-whitespace characters once the Markdown syntax is removed; frontmatter, headings, figure
blocks, markers and the references do not count. The numbers themselves live in each profile's
`## Check settings`.

## 6. The FACTS file and the markers

`facts.md` has these sections, each a `## ` heading:

- `## FACTS` — atomic, numbered facts, each ending with its source tags in priority order, the
  primary source first: `- F12: … [S3]` or `[S3 S4]`. Only the first two public sources of a fact
  are ever cited (section 7), so order the tags deliberately.
- `## SOURCES` — one line per source: `- S3: <title> · <url>`, `· private` for a source that is
  never cited (the design repo), `· nolink` for a public source without a URL. A title is data:
  the page's own title, a repo file's path, `PR #N: <PR title>`, `PenguinHarness docs: <page>`,
  copied as it is, never reworded. Repo file links are pinned to the release the version note
  names (`blob/v<version>/<path>`, after `git ls-tree` confirms the file is there); `blob/main` is
  refused.
- `## OPINIONS` — the author's thesis points, ours to assert: `- O1: …`.
- `## TERMS` — spelling, the zh rendering and the UI labels, as a table whose first column is the
  term; a docs page's TERMS carries the labels exactly as the product's dictionaries spell them.
- `## NOT-FACTS` — claims the model must not make.
- `## EXISTING-FIGURES` — published screenshots the outline may reuse, by stem.

The writer makes a factual claim only when FACTS holds it. A section call ends every factual
sentence with its id (`{F3}`, several as `{F3}{F7}`) and every position with an OPINIONS id
(`{O1}`); headings, figure blocks and frontmatter carry none. `translate` and `polish` keep the
markers as they are and never add one; `fix` adds one only on a sentence a finding changed; the
script prints any marker a call added or dropped. A fact that needs a citation needs a public
source: a fact whose sources are all private may be used, with a warning, and gets no footnote.

## 7. Citations

The markers become paper-style citations when the post is published. `strip --facts facts.md`
turns each marker group into GFM footnotes placed after the sentence's closing punctuation
(`…was.[^1][^2]`, `……。[^1]`): each fact contributes its first two public sources in tag order,
the sentence keeps the first three after de-duplication, and those are numbered by first use
through the post; opinions and private sources emit nothing. A source only ever dropped by these
caps is not cited and so not listed, which keeps the list and the numbers consistent; the cap keeps
a sentence readable however many sources back it. The post ends with the list:

```markdown
[^1]: [PenguinHarness docs: Agent loop](https://penguin.ooo/docs/agent-loop)
[^2]: A title without a link
```

The post carries no references heading and no `**Sources**` line (the older form, now an error):
the site labels the list from its own dictionary and renders the numbers as superscript `[n]`
that jump to the list and back. The site numbers a footnote by its first use and builds its anchor
from its label, so the labels must run 1, 2, 3 … in the order they first appear; `check` makes any
other order an error.

Each language is therefore numbered by its own first use. `strip --numbering-from <the first
language's post>` keeps the first language's numbers when the second language cites the sources in
the same order, and refuses with a clear message when it does not; strip that language without
`--numbering-from` then. A source cited in only one of the two posts is an error either way
(`strip --numbering-from` or `pair` reports it).

`check` on a published post proves every `[^n]` is defined and every definition used, the labels
run 1 … N in first-use order, every link is in `## SOURCES`, and no citation sits in a figure or a
caption. `pair` proves both posts cite the same set of sources, and each section the same sources,
whatever numbers each language gave them.

## 8. Source language and translation

English first by default. Write Chinese first when the title, a meme or the sources are Chinese:
`outline --lang zh` plans in characters, and the English follows by translation. Translation runs
per section, in order: each call sees the plan and the sections already translated, keeps the
markers at the ends of the same sentences, and translates figure blocks string for string. With
`--reuse-figures <frozen target draft> --reuse-source <frozen source draft>`, a figure whose source
block did not change keeps its frozen translation, so it needs no redraw. If a polished section
still reads translated after one fix round, write that language's section afresh from the outline
(`section --lang <tgt>`) instead of iterating on the translation.

## 9. Figures

**Kinds.** Diagrams and charts we draw as inline SVG, real product screenshots in the light theme
(captured with the e2e harness and its mock LLM, or reused from the published inventory), or a
Markdown table when the comparison is words. No AI-generated illustrations, gradients, glows,
shadows, emoji or icons, and no invented data: a conceptual comparison is drawn as states or flows,
never as a chart with made-up numbers.

**The words come from the model.** The section that owns a figure writes its block:

````markdown
```figure id=<stem>
alt: <one sentence: what is in the picture>
caption: <one sentence: what the reader should take from it>
title: <the heading drawn inside the picture, when it needs one>
text:
- <where>: <a string drawn in the figure>
```
````

`<where>` is a short lowercase English key (box, column, layer, step1, config2, …) telling the
drawer where the string goes. A block with `alt` and `caption` only is a screenshot. A string is
data: a placeholder such as `<path>` in it is escaped by the drawer, never read as HTML.

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
directions, comparing text after unescaping; `strip --figures-dir <figures dir>` refuses a file
that does not match its block and inlines the rest as one line; `check --in <post> --draft
<draft>` re-runs the same assertions on the published post.

**Screenshots** stay in `Prism-Shadow/penguin-harness-community` under `blog-assets/`,
referenced as `/blog-assets/<name>-<lang>.png`; a new one is merged there before the post's PR.
`strip` writes them as an image line plus an italic caption, escaping `<`, `>` and `&` outside code
spans.

**Visual check**, on the test host only (a browser runs nowhere else): build the landing
(`--build "@prismshadow/penguin-landing..."` with the remote runner), serve it with
`pnpm --filter @prismshadow/penguin-landing preview --port <p>`, and drive a scratch Playwright
script over the post in both languages, light and dark (the `html.dark` class, set the way the
site's toggle sets it), at a desktop and a phone width. Assert `scrollWidth <= innerWidth`, no
console or page errors, every `.fig-steps` hidden and every figure inside the prose column; save
the screenshots and look at them (labels not clipped, CJK inside its boxes, strokes visible in
dark, the references list and a jump to it). `curl` there may need `--noproxy '*'`.

## 10. Checks

- **`check`** (local, no network) exits 1 on a hard hit. For every kind: frontmatter, the
  profile's budgets, section range and TL;DR rule, no numbered headings, no emoji, raw HTML or
  leaked `{{SLOT}}`s, markers against FACTS and their sources (`--facts`), and the language rules
  — the patterns at the end of `reference/en-style.md` / `reference/zh-style.md` plus what the
  script counts (em dashes per section, exclamation marks against the profile, list and paragraph
  length, CJK–Latin spacing, `——`, ASCII quotes and colons in Chinese). For one section
  (`--section`, or an `s<n>.…` file): its shape and the figures its plan row owns. For posts also:
  `## ` only, figure blocks complete and in manifest order (`--figures`), drawn figures (`--svg`,
  `--draft`), screenshot paths and files (`--assets`), footnotes on a published post, no
  `**Sources**` line, no in-page anchors. Landing strings are checked as `key: text` lines.
  Warnings are for a person to judge.
- **The fact diff** (agent): every number, URL, code span, bold or 「」 label and proper noun
  resolves to a FACT or TERM; headings and figures match the outline.
- **Review**: the API `review` step (an editor's findings on naturalness, flow, concision, reading
  effort and figures, in the form `fix` consumes, never a rewrite; per section, or the whole post
  with flow across sections as its main question) and the agents' blind reviews — a truth reviewer
  with FACTS and the sources, a native reader for the second language.

Findings, from any reviewer, are numbered and quote the passage:
`N. [passage quoted verbatim] — problem — the fact (F#) or rule it violates — what the fix must achieve (not the wording)`.
`route` relies on that quote to find the section; a passage it finds nowhere or twice goes to
`findings.unrouted.<lang>.vN.md` for the orchestrator.

## 11. Assembly and publishing

- **`assemble`** picks the latest version of each `s<n>.<lang>.v<k>.md` (or `--pin s<n>=v<k>`),
  requires sections 0 … N with frontmatter in section 0, refuses a figure owned by two sections,
  and prints each section's size against its plan and cap.
- **Manual-paste fallback.** When `assemble` cannot run, concatenate the latest section files in
  order (`cat`, one blank line between them) into `draft.<lang>.vN.md`, change nothing, run
  `check --in … --outline …`, and say in the PR body that assembly was manual. Typing a word into a
  section file is never the fallback.
- **A post**: `strip --in <frozen draft> --out packages/landing/content/blog/<slug>.<lang>.md
  --facts facts.md --figures-dir <figures dir> [--assets <community>/blog-assets]`, the first
  language first, then the second with `--numbering-from` the first's post (or without it when
  its citations come in another order, see section 7). It prints the model's
  notes (`<!-- omitted: … -->`, `<!-- not applied: … -->`, `<!-- figure changed: … -->`) so they are
  read. Then `check --in <post> --draft <draft> --facts facts.md --pair <other post>`.
  `packages/landing/test/blog.test.ts` pins post order per category, so a new post edits that
  list. Add a changelog pair (`Type: process`, `Scope: landing`) per
  `penguin-harness-dev/reference/changelog.md`.
- **A docs page**: `write` (one call) to a draft, `strip` to
  `packages/docs/content/<slug>.<lang>.md`; a new page is also added to `src/lib/nav.ts`, which the
  docs package's content test keeps in sync.
- **Landing strings**: `write` with `--profile landing`; each `key: text` line is copied verbatim
  into `strings-en.ts` or the zh dictionary in `strings.ts`.

## 12. Verification

Markdown is skipped by `format:check`; the text is covered by `check`, by the landing package's
blog tests (content integrity, anchors, links) or the docs package's content tests, and by reading.
A post PR runs the landing tests, `format:check` and
`node .agents/skills/penguin-harness-dev/reference/ai-slop/scan.mjs packages/landing/content/blog`.
When the author asks for the suite on another machine, `penguin-harness-dev/reference/verification.md`
has the remote runner and its traps. After changing the script, a contract, a profile's settings or
the check patterns, run `node .agents/skills/penguin-harness-writing/scripts/prose.mjs selftest`
(local, no network): it runs the local steps on built-in fixtures, and a case that guards a fixed
bug goes there.

## 13. Files

| Path | What it holds |
| --- | --- |
| `scripts/prose.mjs` | The runner: API steps `outline`, `section`, `write`, `translate`, `polish`, `fix`, `review`; local steps `plan`, `assemble`, `route`, `check`, `strip`, `pair`, `selftest`. `--help` lists every option; `--dry-run` prints the assembled messages without calling or saving |
| `prompts/<step>.system.md`, `prompts/<step>.user.md` | One prompt pair per API step; `{{SLOT}}`s filled by the script, and any slot left unfilled aborts the call |
| `prompts/contract-section.md`, `contract-post.md`, `contract-docs.md`, `contract-landing.md` | The output contract for one section, a whole post, a docs page, landing strings |
| `prompts/fragments.md` | Prompt text used as slot values: the section shapes, marker rules, the review scopes, the neighbours and translated-context blocks, the version-note rule, the meme brief, feedback blocks, the default title rules, the translation tells |
| `reference/en-style.md`, `reference/zh-style.md` | Voice and the full banned lists, for every kind of text. The block between the `prompt` markers is what the model receives; the check patterns below it are what `check` greps for; change both together |
| `reference/profile-<name>.md` | One per kind of text (section 2) |
