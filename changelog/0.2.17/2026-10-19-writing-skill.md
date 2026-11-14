# A repo skill for prose written through the gateway model

- **Date:** 2026-10-19
- **Type:** process
- **Scope:** `skills`
- **PR:** [#1216](https://github.com/Prism-Shadow/penguin-harness/pull/1216)

[中文版](2026-10-19-writing-skill.zh.md)

Added the `penguin-harness-writing` development skill under `.agents/skills/`. It records how
penguin.ooo text is made, whether a blog post, a docs page or landing copy. A model on the
TokenDance gateway writes every reader-facing word, one API call per step. Agents research,
compile the facts, write the prompts, assemble the model's sections, draw the figures from the
model's own strings, check and ship. The key is read from `TOKENDANCE_API_KEY` or
`TOKENDANCE_KEY_FILE` and never enters the repository.

## Details

- `scripts/prose.mjs` writes posts the way a person writes one:
  - `outline` plans the post. Its `# Plan` table gives every section a size, its facts and its
    figures.
  - `plan` checks that table against the profile's budgets, the figure manifest and the facts, then
    freezes it.
  - `write` writes the whole post in one call from the frozen plan, so each section continues the
    one before it. It keeps a pinned title, the author's notes and the figure blocks already drawn,
    and it reports every section's size against its cap and its plan.
  - `check --plan-rows advisory` treats the plan's sizes as targets and the profile's caps as
    limits.
  - `review` reads the whole post and scores every join between sections. `fix`, `trim` and
    `translate` work on the whole post too, and refuse an answer that changes what they were not
    asked to change. The review gets the text fenced apart from its instruction. It does not
    flag the TL;DR line, the marked key sentences, or an objection stated and answered as the
    essay form asks. In a post whose body has no lists it never asks for one.
  - `transition` mends the joins in a round of its own, once per language after its last `fix`.
    For each heading only the first sentence after it may change and, when the join needs it, the
    last sentence before it. Any other change, or a lost fact marker, is refused. `review` then
    scores the joins again.
  - `unstrip` turns a published post back into a draft. It restores the figure blocks and fact
    markers, keeps the drawn figures as files and seeds a facts file from the reference list, so a
    post can be revised without redrawing its figures. Its guard checks that `strip` gives back
    the same figures and text.
  - Section mode remains for long posts and docs pages: `section` writes one section per call,
    `assemble` joins the sections byte for byte, and `route` splits review findings by the section
    they quote.
- Budgets are hard. Plans are held to their profile's caps. `check` rejects any section above 1.1 ×
  its planned size or the profile's cap. Every prompt written to a budget states the cap and the
  counting rule `check` uses. A prompt for one section asks for its planned size, or for what the
  page has left when that is less. It never asks for the 1.1 × margin. After every section step,
  `check` reports the page total against its cap. `trim` shortens sections that are only too long,
  without rewriting them. On a whole draft it cuts each section over its cap to just under that cap,
  never down to its plan row. When the page is over its cap, it shares the cut among the sections
  instead. It asks for complete sentences that keep every number, unit, approximation, attribution
  and qualifier, and it refuses an answer that cuts a section more than 10% below its target or
  loses a number. `trim`, `transition` and `emphasize` put back any figure block an answer changed,
  and every step drops a lone fence line the model echoed from the prompt before its guard runs.
- `fix` and `trim` answers are checked before they are saved. Such an answer is set aside if it
  brings in a fact no finding named, changes a figure block no finding named, changes a marker, or
  is still over its cap after a cut. `fix`, `polish`, `translate`, and `trim` also set aside an
  answer that changes the version note. The next version is not written.
- Posts cite like papers, and most sentences carry no citation. Each fact in the facts file is
  tagged with its sources. `strip` turns the writer's fact markers into numbered GFM footnotes with
  a linked reference list. Footnotes are numbered by first use. Each source is cited once per post,
  and each paragraph at most once: by its first sentence whose facts bring a source not yet cited.
  Facts listed under an optional `## NOCITE` section cite nothing, and so do the repo files and docs
  pages a post only refers to; the post names them in code spans. The TL;DR sums up the body, so it
  carries no footnotes. The footnote goes before the punctuation that ends its clause (`text[^1].`,
  `文字[^1]。`). A profile's `sources` setting bounds the reference list: 6 to 13 sources for a
  perspective post. `check` reports an error above that cap and on a paragraph or sentence with two
  citations, and a warning below the floor. The second language keeps the first language's numbers
  when it cites the sources in the same order. `pair` checks that both cite the same sources. The `**Sources**`
  footer is gone. URLs in the text are autolinks, formatted as `<https://…>`. This is because the
  site reads a footnote right after a bare URL as part of the link.
- Profiles in `reference/profile-<name>.md` hold what differs by kind of text: shape, reader,
  sizes and the rules `check` enforces. The profiles shipped are a perspective post, a docs page
  and landing strings, each with its own output contract. A perspective post is written as an
  essay in connected paragraphs: each section argues one point with reasoning and evidence and
  answers the strongest objection where it arises. A profile's `body-lists: none` makes a list
  outside the TL;DR an error, and `body-tables: none` does the same for a table.
- Voice rules ask the model to write for readers with dyslexia or ADHD, who read with effort. The
  rules require the model to put the point first, use short sentences, use common words, omit
  asides, and omit defensive hedging. They also ban the "Yes, but…" concession pivot by name.
  `review` checks for both. `SKILL.md` quotes the author's tip this rule comes from, verbatim.
  `check` warns on sentences over 35 English words or 60 Chinese characters. In Chinese text, Harness and Agent Harness stay in English. `check` treats 夹具 as an
  error. It treats a lowercase "harness" as a warning.
- For the same readers, a post opens with a TL;DR of its key points. The new `emphasize` step marks
  one key sentence per section in bold. It does not change any other character. Bold in a post is
  reserved for that sentence. UI labels go in quotes. `check` makes any other bold an error. The
  step's answer is refused if it changes the text, marks no span in a section, marks two spans in a
  section, marks only part of a sentence, or closes a span after the sentence's punctuation. Chinese
  text does not render spans closed in this position as bold. The author's notes (`--notes`) can say
  which sentence to mark. `check` flags any `**` that CommonMark cannot read as bold.
- Every word inside a figure comes from the model, in a figure block. Drawn figures are inline SVG
  that `check` compares string by string against their blocks.
- The script's local steps check text without the network: structure, budgets, figures, fact
  markers and their sources, footnotes, and the per-language banned lists. `selftest` runs them on
  built-in fixtures.
- The dev skill's read table and `reference/authoring.md` point to the new skill.
