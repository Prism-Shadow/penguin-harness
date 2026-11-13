---
name: penguin-harness-writing
description: "Use when writing or revising reader-facing prose for penguin.ooo — a blog post of any category, a docs page, or landing-page copy: the division of labour (a gateway model writes every reader-facing word, agents research, prompt, assemble, draw, check and ship), the outline-then-whole-draft flow with budgets and a transition round (section mode as the fallback), the FACTS guard and sparse footnote citations, the profiles, inline SVG figures drawn from the model's figure blocks, the checks, and how it is verified."
---

# Writing for penguin.ooo

Posts, docs pages and landing copy are written by a model on the TokenDance gateway and shipped
by agents. A post is written the way a person writes one: an outline first, then the whole post in
one call, so its sections join; the review, the fixes, the cuts and the translation work on the
whole post too, and a round of its own edits only the sentences at the headings. A long post or a docs page can fall back to section mode. This page is the contract; `scripts/prose.mjs` is
the only way text reaches a draft, and `prompts/` plus `reference/` hold every word sent to the
model. `penguin-harness-dev/reference/authoring.md` covers what is true of every post (the
bilingual pair, frontmatter, where screenshots live).

## 1. Who writes what

**The API model writes every word a reader sees**: the outline and its plan, every section, the
title and excerpt, every string inside a figure, alt text and captions, the second language, every
docs sentence and landing string, and every later fix or cut. Each is its own API call through
`prose.mjs`.

**Agents never type a sentence into the text.** They research, compile FACTS, write prompts and
findings, put the model's text together, draw figures from the model's figure blocks, take
screenshots, run the checks, review blind and ship. Putting the text into the manuscript is also
the agent's job, and it is mechanical: `write` saves the draft, `assemble` joins section files in
section mode, and `strip` publishes them. A wrong sentence goes back through a `fix` call with a numbered finding,
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
| `blog-perspectives` | a perspective post: an essay on one thesis in connected paragraphs, a lead, a TL;DR, a few sections | `prompts/contract-section.md` (per section), `contract-post.md` |
| `blog-practice` | a technical post argued as an essay: a design thesis, sections that each argue one point with evidence and answer the design not taken, numbers rules, TL;DR | the same |
| `docs` | a page of `packages/docs/content/`, Obsidian-Help style | `prompts/contract-docs.md` |
| `landing` | strings for the landing page's dictionaries | `prompts/contract-landing.md` |

A blog category without a profile file needs `--profile <file>` until one is written;
`--profile <file>` also tries a profile before it lands. The file names its profile by its name
(`profile-blog-practice.md`, or `profile-practice.md` for a blog category) or by the `--profile
<name>` its header says it is loaded for, and the script says which profile it loaded.

A profile holds the reader, the shape, the sizes and any rule that overrides the style guide for
that kind of text, inside `<!-- prompt -->` markers (a `<!-- prompt zh -->` block, when present,
replaces it for Chinese). The model receives it after the style guide, introduced as winning where
the two differ. A profile does not repeat the style guide and states nothing about the product:
facts come from FACTS only. Its `## Check settings` are what the script enforces —
`sections`, `lead`, `tldr`, `exclamations`, and the budgets `words`, `lead-words`,
`section-words`, `zh-chars`, `zh-lead-chars`, `zh-section-chars`, `tldr-words`, `zh-tldr-chars`, each
`floor-cap`, `emphasis` with its caps `emphasis-words` / `zh-emphasis-chars` (section 4),
`sources`, the floor and cap of a post's reference list (section 7), `body-lists` and
`body-tables` (`none` makes a list outside the TL;DR, or a Markdown table, an error, for a post
written as an essay in paragraphs), and `ui-labels`: `quoted` in a post, where bold is only the emphasized sentence and a UI label goes in
quotes ("…" / 「…」), `bold` in a docs page.
A prompt rule with no matching setting is a rule `check` cannot see; change the two together.

## 3. Voice

`reference/en-style.md` and `reference/zh-style.md` hold the voice and the banned lists for every
kind of text; the outline, section, translate, polish, fix and review calls all receive them.

One rule there asks the model to write for a reader with dyslexia or ADHD, a person who reads
with effort and loses the thread easily: the point first, short sentences with one idea each, common words, no asides or "by the
way" detours, no defensive hedging, no padding. Stating the reader that way measurably shortens
the model's output and keeps it on its point. The one habit it does not remove is the
"Yes, but…" / 「是的，但是……」 concession pivot, so that pivot is banned by name next to the
"not X but Y" pivot, and `check` and `review` look for it. For the same reader a post opens with a
TL;DR of its key points, and one sentence per section is marked in bold by `emphasize`; the writer
bolds nothing else.

The tip this rule comes from (the author's post, verbatim):

> 亲测超级好用😂 | 之前为了矫正大模型的说话问题（RL不是没有代价的，你就是代价……），我整过很多版本的工作要求，最极端的是输出前多加一步子Agent专门负责矫正Agent汇报……，然而，真的不如假装残疾人好使。方法就一行⬇️【直接在Agent.md里加入，假设用户是阅读障碍。】⬆️大模型就会说人话了，也不长篇大论了，也会捡重点的说了，也不防御性写作了，也不BTW了唯一扳不过来的是【Yes, But】这个有主意朋友可以跟我说说。现在 LLM 也很难低成本私有化部署和调试，各家又都是冲着把人干掉去训练的，结果现在工作就是个可悲的【人机打架】的L3阶段。而且就DeepSeek而言，我老觉得他有点文本代码化的倾向，就是完全没有脑子……比之前还没有那种，不做真正的思考，纯无脑执行那种。

The rule keeps the tip's one line, assume a reader with dyslexia, and turns the rest of its report
into bans: its "BTW" detours and its defensive writing are the aside and hedging bans, and the
"Yes, but" pivot the tip could not remove is banned by name.

The zh style guide keeps Harness and Agent Harness in English with that capitalisation, never
「夹具」「线束」「挽具」; a test fixture is 合成测试, 测试数据 or 测试配置; `check` makes 夹具 an error and a
lowercase "harness" a warning.

## 4. The pipeline

All work happens in a scratch directory, one folder per post: `<scratch>/articles/<slug>/` for
inputs, the outline, the notes and the drafts, `<scratch>/articles/raw/` for raw responses
(`--raw-dir`). The folder name is the slug the figure ids carry; the `.en.` / `.zh.` token in a
file name is how the script knows the language. A post is written as one document:

| # | Step | Who | Notes |
| --- | --- | --- | --- |
| 1 | Research, FACTS, notes | agents | `facts.md` (section 6), each fact tagged with its sources; `notes.md`, the author's settled wording |
| 2 | `outline` | API | thesis, title candidates, section bullets, the figure plan, and the `# Plan` table: one row per section with its size, facts, opinions, figures and the point it lands on |
| 3 | `plan` | script | checks the plan against the profile's budgets, the manifest and FACTS; a failure writes `outline-feedback.auto.md` for one rerun (`outline --feedback … --previous …`); a second failure goes to the author. `plan --freeze` writes `outline.final.md` |
| 4 | `write` | API | the whole post in one call from the frozen outline: frontmatter, lead, TL;DR, every section and its join to the next, the figure blocks. `--title` pins the title, `--notes` passes the notes, `--reuse-figures <frozen draft>` the blocks already drawn; its report names the next step. A wrong shape is written again with `--feedback … --previous <the attempt>` |
| 5 | `check --plan-rows advisory` | script | the page cap and the profile's caps are hard, the plan's rows are targets; over a cap → `trim` on the whole draft |
| 6 | `review` + truth review | API + agent | the whole post, flow first: every join after a heading is scored (`transition`, `signpost`), and `<out>.flow.txt` holds `transitions: n of m`; the agent reads against FACTS, the sources and the notes; merged and numbered |
| 7 | `fix` | API | the whole post, held to its findings (section 10). At most two rounds, the second only when the first had `transition`, `flow` or truth findings, then the author; `trim` if a cap breaks |
| 8 | `transition`, then `review` | API | the joins alone: for each `## ` heading, the first sentence after it and, when the join needs it, the last sentence before it; the review's `transition` / `signpost` findings go along (`--findings`), and the guard refuses any other change (section 10). The new review's `transitions: n of m` is the acceptance number: `m of m`, else the author decides. Once per language, after its last `fix` and before `emphasize` |
| 9 | `translate` | API | the whole post in one call (section 8) |
| 10 | `check`, `review --tells` + native reader, `fix` | script + API + agent | the same loop in the second language, at most two rounds; `trim` if over |
| 11 | `transition`, then `review` | API | the joins of the second language, as in step 8 |
| 12 | `emphasize` | API | on each language's frozen draft, the first language first, then the second with `--mirror <the first's emphasized draft>`: one `**` span per section and in the lead, nothing else changed |
| 13 | `pair` | script | section by section: markers, citations, emphasis, figure blocks, code spans, URLs; numbers compared; Chinese size against the English |
| 14 | Draw | agent | from the frozen figure blocks (section 9); a block `write` or `translate` changed is redrawn |
| 15 | `check --svg` | script | every drawn file against its block |
| 16 | `strip` | script | citations, inline figures, screenshot lines; the first language, then the second with `--numbering-from` when its citations come in the same order (section 7) |
| 17 | Visual check, verify, PR | agent | sections 9 and 12 |

**Flow.** The post is one argument written in one sitting. The first sentence after every `## `
heading continues the last sentence before it; no section opens with a signpost ("In this
section", "Next,", 「接下来」) or ends on a sentence that only announces the next heading. The plan's
`ends with` column names the point a section lands on, not a sentence to write. `write` states
this, `review` scores every join, `transition` mends the joins that fail without touching anything
else, and `check` warns on the signposts the style guides list. A post's joins get a round of
their own because a fix round aimed at the whole text leaves them broken: the author's rule is to
write the whole post, revise it as a whole, then edit only the sentences at the headings.

**Emphasis.** A profile with `emphasis: yes` gets one marked key sentence, a whole one, per `##`
section and one in the lead: the claim a reader skimming the section must not miss. `emphasize`
adds the `**` pairs to a frozen draft and changes nothing else; `--notes` passes the author's
notes as guidance on which sentence to mark. The script refuses an answer that
differs from its input once the `**` are removed, has no span or two in a section, holds a span
over `emphasis-words` / `zh-emphasis-chars` or over part of a sentence (a span opens where its
sentence opens and closes right before its final punctuation), or puts one in a heading, figure block, caption,
version note, TL;DR, code span or link, or around a marker. The closing `**` goes before the
sentence's punctuation and markers, so the citation follows it there (`**claim**[^1].`,
`**句子**[^1]。`), and the script refuses the other order: after Chinese punctuation a closing `**`
is not read as bold (`**关键句。**后文` shows its asterisks). Bold in a post is only that sentence:
the writing prompts put a UI label in quotes, and `check` makes any other bold an error. A text
that changes after `emphasize` is assembled and emphasized again.

**The ordering rule.** The outline is frozen before the text is written; the text of a language is
frozen before any figure of it is drawn; and no string inside a figure is ours. A figure that
needs a string its block lacks goes back through a `fix` finding.

### Section mode

A post well over a thousand words, or a docs page written task by task, can be written one section
per call instead. `section` writes plan row n from the frozen outline, seeing the plan, the
sections already written and only that row's facts, into `sections/s<n>.<lang>.v<k>.md`, and
`check --section` follows every call (size alone → `trim`, shape → `section --feedback`, wording →
`fix`). `assemble` joins the latest section files byte for byte, or the versions `--pin
s<n>=v<k>` names. `route` splits merged findings by the section that quotes each one, and `fix`,
`translate`, `polish`, `review` and `trim` then run per section, with the neighbours read-only.
Their prompts aim at the lowest of the planned size, what the page has left and the profile's cap
(section 5), and `--page <assembled draft>` tells them which version of each other section the
page holds. From `emphasize` on, the flow is the same. Section mode trades the joins for control,
so a post written this way needs its transitions checked by `review` on the assembled draft and
mended by `transition`.

## 5. Budgets

Sizes are set three times, so a post cannot grow past them unnoticed:

1. **The plan.** The outline's `# Plan` table gives every section a number, in English words or
   Chinese characters (Chinese-first posts plan in characters). `plan` rejects a table whose rows
   exceed the profile's section cap, whose lead leaves the lead range, whose sum exceeds the total
   cap, or whose section count leaves the profile's range.
2. **The prompt.** A whole-post `write`, `translate`, `fix` or `polish` states the profile's caps
   for the whole, the lead, each section and the TL;DR, and `write` takes the plan's row sizes as
   targets; each prints, after its call, every section against its cap and plan and the page
   against its cap. In section mode, every call that writes or changes a section (`section`,
   `translate`, `polish`, `fix`, `trim`) asks for the lowest of three sizes: the section's planned size (from a plan in
   the other language's unit, converted at the translation ratio), what the page has left once the
   other sections take theirs, and the profile's cap. The other sections count as `--page
   <assembled draft>` holds them, so a pinned older version counts and a newer file set aside does
   not; without `--page`, the newest file of each, or the planned size of one not yet written. It never offers `check`'s 1.1 × tolerance, so a round of fixes
   cannot walk every section up to it and the page over its cap. `polish`, `fix` and `trim` also
   state the section's current size, and `outline` and a whole-piece `write` the profile's caps.
   Each states the counting rule `check` applies, in words and with an example sentence the script
   counts itself, so a cap is one number for the model and for `check`. The wording is the
   `count-rule-<lang>` fragment; change it with `countBody`.
3. **`check`.** A section above `min(plan × 1.1, profile cap)` is an error; with `--plan-rows
   advisory`, the mode for a post written as one document, a section above its plan row is a
   warning and only the profile's cap an error. A lead above its cap and a whole post above the
   total cap are errors either way. Without `--outline`, the profile caps apply. Below a
   floor is a warning: short is allowed, empty is not. On a section file it also reports the page
   total, counted the same way as the prompt's page budget (with `--page` too), names where the
   other sections' sizes came from, and warns when the total is over the page cap; every
   per-section API step prints the same line, so creep shows before assembly.

A TL;DR, in a profile that has one (`tldr: yes`), is not part of the lead: the `**TL;DR**` line
and its bullets are counted apart and held to `tldr-words` / `zh-tldr-chars`, the plan's row 0
sizes the lead alone, and the lead's section call states the TL;DR budget separately.

**Over budget.** A whole draft over a cap goes through `trim --in draft.<lang>.vN.md`, which
names the sections to cut and asks for just enough. A section over its profile cap aims at 95 % of
that cap, never at its plan row. If the page is still over its cap, the rest of the cut, down to
95 % of the page cap, is shared among the other sections in proportion to their size; the lead is
left alone. Each named section has a floor at 90 % of its target. The prompt asks for rephrasing
inside complete sentences and keeps every fact: numbers with their units, approximations
("about", 约), attributions, and qualifiers as strong as they are ("many" never becomes "most").
`trim` refuses an answer that changes any other section, leaves a named section or the page over
its cap, cuts a named section below its floor, or loses a number the text stated, so a telegraphic
cut is rerun, not shipped. Figure blocks are not the model's to cut: a block the answer changed is
put back from the draft before the guard runs. In section mode, a section whose
only problem is its size goes through `trim --in <section> --outline <outline>` (or `--cap <n>`).
Either way the call may only delete words or put a shorter phrase in place of a longer one. The script refuses the answer when it is still over the cap, or when a
marker, a footnote reference, a figure block, a heading, the frontmatter or the version note
changed: the answer is
kept as `<out>.rejected.md`, the next version is not written, and the step exits 1. Retry once,
then hand it to the author. With `--page <assembled draft>`, `trim` also cuts a section that is
within its own cap to what the page has left when the page is over its cap; without it, the newest
section files only produce a note. A section wrong in shape or content is rerun with `section --feedback`;
rerunning it only to shorten it brings back errors already fixed, and so does writing a whole post
again only to shorten it. Nobody cuts a section by hand.

Counting is the same everywhere: English words are whitespace tokens holding a letter or digit,
Chinese characters are non-whitespace characters once the Markdown syntax is removed, so every
punctuation mark and every letter of a Latin word counts; frontmatter, headings, figure blocks,
markers and the references do not count. The numbers themselves live in each profile's
`## Check settings`.

## 6. The FACTS file and the markers

`facts.md` has these sections, each a `## ` heading:

- `## FACTS` — atomic, numbered facts, each ending with its source tags in priority order, the
  primary source first: `- F12: … [S3]` or `[S3 S4]`. Only the first public source of a fact is
  ever cited (section 7), so order the tags deliberately.
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
- `## NOCITE` (optional) — facts the writer still marks but that cite nothing: `- F12: <why>`.
  Section 7 says what is cited; list here general background, a restatement under another
  source, and every repo file or docs page the post only refers to. Record the choices in the PR
  body.

**The author's notes.** A post may keep a `notes.md` beside `facts.md` for wording settled with the
author, one line each: `keep[ en|zh]: <exact string>` (the answer must carry it verbatim),
`avoid[ en|zh]: <string>` (the answer must never hold it) and `note: <text>` (a point the prompt
states). A line tagged with a language applies to that language alone. `write`, `translate`,
`review` and `fix` take the file with `--notes`; `write`, `translate` and `fix` refuse an answer
that breaks a `keep:` or `avoid:` line, and `review` flags a sentence that breaks a note. Keep
`keep:` lines to the few clauses the author settled; everything else is a `note:`.

The writer makes a factual claim only when FACTS holds it. A section call ends every factual
sentence with its id (`{F3}`, several as `{F3}{F7}`) and every position with an OPINIONS id
(`{O1}`); headings, figure blocks and frontmatter carry none. `translate` and `polish` keep the
markers as they are and never add one; `fix` adds one only on a sentence a finding changed; the
script prints any marker a call added or dropped. A fact that needs a citation needs a public
source: a fact whose sources are all private may be used, with a warning, and gets no footnote.

## 7. Citations

The markers become paper-style citations when the post is published, and most sentences carry
none: one footnote per paragraph at most, each source once per post, and about 13 sources per post
as the ceiling (the profile's `sources` setting). Writers still mark every factual sentence, since
the markers are the truth guard; the citer thins them. `strip --facts facts.md` reads each marker
group (the markers closing one sentence): of its facts, in the writer's order, the first whose
first public source is not cited yet is the group's offer, and the first group in a paragraph
with an offer becomes the paragraph's one GFM footnote. The paragraph's other groups cite
nothing, so a source they offered stays free for a later paragraph. A list item and a table row
count as paragraphs. Opinions, private sources and facts under `## NOCITE` cite nothing.

Cite what a reader would want to check: a third-party number, a verbatim quote, a named paper,
standard or product claim by someone else, our own measurement, and the first mention of a product
behaviour. List repo files and docs pages the post merely refers to under `## NOCITE`, and name
the file in a code span instead.

The TL;DR sums up the body, so its markers stay in the draft as anchors and cite nothing; the
body's first use sets the numbers, and a citation in a published TL;DR is an error. The footnote
goes before the punctuation that ends its clause, outside a closing quotation mark, bracket or
bold (`text[^1].`, `文字[^1]。`, `"the slope"[^1].`, `**claim**[^1].`); when the punctuation sits
inside the closing mark (`slope."`), it follows the whole run and `check` warns. Footnotes are
numbered by first use. The post ends with the list:

```markdown
[^1]: [PenguinHarness docs: Agent loop](https://penguin.ooo/docs/agent-loop)
[^2]: A title without a link
```

A URL in the text is an autolink, `<https://…>`. A bare URL right before a citation is an error:
strip writes the `[^n]` straight after it, and the site's renderer reads the reference as part of
the link.

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
caption; a citation after the punctuation is an error. On a published post, and on a draft read
through the same citer with `--facts`, a paragraph or a sentence with two citations is an error,
and so is a post citing more sources than the profile's `sources` cap; fewer than its floor is a
warning. `pair` proves both posts cite the same set of sources, and each section the same
sources, whatever numbers each language gave them.

## 8. Source language and translation

English first by default. Write Chinese first when the title, a meme or the sources are Chinese:
`outline --lang zh` plans in characters, and the English follows by translation. `translate`
takes the whole post in one call, with TERMS, the notes (`--notes`) and the pinned title of the
target language (`--title`); it keeps the markers at the ends of the same sentences and translates
figure blocks string for string. With `--reuse-figures <frozen target draft> --reuse-source <frozen
source draft>`, a figure whose source block did not change keeps its frozen translation, so it needs
no redraw. If the translation still reads translated after one fix round, write that language
afresh from the outline (`write --lang <tgt>`) instead of iterating on it. In section mode,
translation runs per section, in order, each call seeing the plan and the sections already
translated.

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

The manifest's `kind` column (or the outline's `# Figures` table) says which figures are
screenshots, because a block cannot: one that gained `text:` lines reads as drawn. `check` with
`--figures` or `--outline` makes any line but `alt` and `caption` in a screenshot's block an
error.

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
  leaked `{{SLOT}}`s (an autolink, `<https://…>` or `<mailto:…>`, is a link, not HTML), markers
  against FACTS and their sources (`--facts`), and the language rules
  — the patterns at the end of `reference/en-style.md` / `reference/zh-style.md` plus what the
  script counts (em dashes per section, exclamation marks against the profile, list and paragraph
  length, CJK–Latin spacing, `——`, ASCII quotes and colons in Chinese). For one section
  (`--section`, or an `s<n>.…` file): its shape and the figures its plan row owns. For posts also:
  `## ` only, figure blocks complete and in manifest order (`--figures`), drawn figures (`--svg`,
  `--draft`), screenshot paths and files (`--assets`), footnotes on a published post, no
  `**Sources**` line, no in-page anchors, no list outside the TL;DR or no table where the profile
  says `body-lists: none` or `body-tables: none`, the emphasis rule where the profile has one (section 4;
  a draft before `emphasize` has no span, and one with any span needs one in every section), and
  the citation rules of section 7. In every profile, a `**` that CommonMark cannot read as
  emphasis is an error: a closing run after punctuation and before a letter, an opening run after a
  letter and before punctuation. Sentences over 35 English words or 60 Chinese characters are
  warnings. Landing strings are checked as `key: text` lines. Warnings are for a person to judge.
- **The step guards** run when an answer arrives, before it is written. `write` refuses an answer
  whose version note or pinned title differs from the one given, that breaks a `keep:` or `avoid:`
  line of the notes, or that carries a footnote or, where bold is the emphasis, bold beyond the
  `**TL;DR**` line; its report lists the shape, the figures against the manifest and the frozen
  blocks, and the sizes. On a whole post, `fix` also refuses a changed heading no finding quotes, a
  changed title no finding names, and a section added or dropped; on an outline (`outline*.md`,
  or a text with `# Plan`) it validates the plan after the call instead. `translate` refuses another
  title than `--title` and a broken note. `fix` refuses an answer
  that brings in a fact or opinion id neither its input nor its findings name, adds, drops or
  reorders a figure, gives a screenshot's block a `title` or `text:` lines, or changes a figure
  block no finding names by its id or by quoting its text. `trim`, on a section or a whole draft,
  refuses what section 5 lists.
  `fix`, `polish`, `translate` and `trim` refuse an answer whose version note is not, byte for
  byte, the one they were given. Before any guard, an answer loses a lone fence line it echoed
  from the prompt (the steps send the text inside a four-backtick fence), and `trim`,
  `transition` and `emphasize` put back, by id, any figure block the answer changed; a dropped
  block is still refused. `emphasize` refuses what section 4 lists. `transition` compares
  the two texts block by block (paragraphs, headings, the TL;DR, figure and code blocks): it
  refuses an answer that adds, drops, splits or merges a block, changes any block but the paragraph
  right after a `## ` heading and the paragraph right before one, changes a sentence of those but
  the first after the heading and the last before it, changes a rewritten sentence's markers (set
  and order) or its `**`, changes the frontmatter, or breaks a note. A TL;DR, list, figure or
  caption next to a heading is no paragraph, so that side of the join stays as it is.
  A refused answer is kept as `<out>.rejected.md` and the step exits 1; a change the findings
  should allow goes back with a finding that names it.
- **The fact diff** (agent): every number, URL, code span, bold or 「」 label and proper noun
  resolves to a FACT or TERM; headings and figures match the outline.
- **Review**: the API `review` step (an editor's findings on naturalness, flow, concision, reading
  effort and figures, in the form `fix` consumes, never a rewrite; on the whole post, flow across
  sections is its main question, every join after a heading is scored, and the closing
  `transitions: n of m` line goes to `<out>.flow.txt`; per section in section mode) and the
  agents' blind reviews — a truth reviewer with FACTS and the sources, a native reader for the
  second language. The API review reads the text between fence lines, apart from its
  instruction. It expects the `**TL;DR**` line and the key sentences `emphasize` adds (`check`
  counts those), takes an objection stated and answered as part of the argument rather than a
  "Yes, but…" pivot, and never asks for a list where the profile says `body-lists: none`.

Findings, from any reviewer, are numbered and quote the passage:
`N. [passage quoted verbatim] — problem — the fact (F#) or rule it violates — what the fix must achieve (not the wording)`.
In section mode `route` relies on that quote to find the section; a passage it finds nowhere or
twice goes to `findings.unrouted.<lang>.vN.md` for the orchestrator.

## 11. Assembly and publishing

- **`assemble`** (section mode) picks the latest version of each `s<n>.<lang>.v<k>.md` (or `--pin s<n>=v<k>`),
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
- **A published post back into a draft**: `unstrip --in packages/landing/content/blog/<slug>.<lang>.md
  --out-dir <scratch>/articles/<slug>/` writes `recovered.<lang>.md` (each inline figure and each
  screenshot back as its figure block, each `[^n]` back as a fact marker after its punctuation),
  `figures/<id>.<lang>.html` (each inline figure as published, so `check --svg` and `strip
  --figures-dir` work without a redraw) and `facts.<lang>.seed.md` (`## SOURCES` from the reference
  list, verbatim; `## FACTS` one line per citation, the sentence that carried it). The second
  language takes `--pair <the first's recovered draft> --facts <its seed>`, so both drafts carry the
  same source and fact ids section by section. Its guard proves every figure against its block and
  strips the draft with the seed: figure and image lines must come back byte for byte, every other
  line once citations are removed; it then reports how many citations the current citer keeps.
  The seed is a starting point: merge it into `facts.md` and verify each fact again.
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
A post is finished when, on the test host, those pass with `git diff --check`; `check --in <post>
--draft <draft> --facts facts.md --pair <other post>` and `pair` report 0 errors, `check --svg`
passes, both reference lists are within the profile's `sources` cap and the last `review` scores
`m of m` joins; and the built landing, driven in 8 combinations (en and zh, light and dark, 1280
and 390 px wide), shows every citation as `[n]` or `[n, m]` with no two groups touching and none
at a line start, jumps from every `[n]` to its note below the sticky nav and back with no new tab
or reload, opens the external-link dialog for a reference link, never scrolls sideways, hides
every `.fig-steps`, holds exactly one bold span in the lead and in each section, carries no 「夹具」
on a zh page and logs no console or page error. A change to this skill runs `selftest` and
`format:check` on the test host, `git diff --check`, and `--dry-run` of `transition` and `write`.
When the author asks for the suite on another machine, `penguin-harness-dev/reference/verification.md`
has the remote runner and its traps. After changing the script, a contract, a profile's settings or
the check patterns, run `node .agents/skills/penguin-harness-writing/scripts/prose.mjs selftest`
(no network): it runs the local steps on built-in fixtures, and the API steps' guards against a
stand-in gateway on a loopback port with a dummy key. A case that guards a fixed bug goes there.

## 13. Files

| Path | What it holds |
| --- | --- |
| `scripts/prose.mjs` | The runner: API steps `outline`, `section`, `write`, `translate`, `polish`, `fix`, `trim`, `emphasize`, `transition`, `review`; local steps `plan`, `assemble`, `route`, `check`, `strip`, `unstrip`, `pair`, `selftest`. `--help` lists every option; `--dry-run` prints the assembled messages without calling or saving |
| `prompts/<step>.system.md`, `prompts/<step>.user.md` | One prompt pair per API step; `{{SLOT}}`s filled by the script, and any slot left unfilled aborts the call |
| `prompts/contract-section.md`, `contract-post.md`, `contract-docs.md`, `contract-landing.md` | The output contract for one section (section mode), a whole post, a docs page, landing strings |
| `<scratch>/articles/<slug>/notes.md` | Per post, outside the repo: the author's `keep:` / `avoid:` / `note:` lines (section 6) |
| `<scratch>/articles/<slug>/recovered.<lang>.md`, `figures/`, `facts.<lang>.seed.md` | Per post, outside the repo: what `unstrip` recovers from a published post (section 11) |
| `prompts/fragments.md` | Prompt text used as slot values: the section shapes, marker rules, the counting rules and budgets, the flow rule, the transition step's findings and notes rules, the notes and fixed-title blocks, the trim scopes, the review scopes, the neighbours and translated-context blocks, the version-note rule, the meme brief, feedback blocks, the default title rules, the translation tells |
| `reference/en-style.md`, `reference/zh-style.md` | Voice and the full banned lists, for every kind of text. The block between the `prompt` markers is what the model receives; the check patterns below it are what `check` greps for; change both together |
| `reference/profile-<name>.md` | One per kind of text (section 2) |
