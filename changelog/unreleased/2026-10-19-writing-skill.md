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
    asked to change.
  - Section mode remains for long posts and docs pages: `section` writes one section per call,
    `assemble` joins the sections byte for byte, and `route` splits review findings by the section
    they quote.
- Budgets are hard. Plans are held to their profile's caps. `check` rejects any section above 1.1 ×
  its planned size or the profile's cap. Every prompt written to a budget states the cap and the
  counting rule `check` uses. A prompt for one section asks for its planned size, or for what the
  page has left when that is less. It never asks for the 1.1 × margin. After every section step,
  `check` reports the page total against its cap. `trim` shortens sections that are only too long,
  without rewriting them.
- `fix` and `trim` answers are checked before they are saved. Such an answer is set aside if it
  brings in a fact no finding named, changes a figure block no finding named, changes a marker, or
  is still over its cap after a cut. `fix`, `polish`, `translate`, and `trim` also set aside an
  answer that changes the version note. The next version is not written.
- Posts cite like papers, with at most one key citation per sentence. Each fact in the facts file is
  tagged with its sources. `strip` turns the writer's fact markers into numbered GFM footnotes with
  a linked reference list. Footnotes are numbered by first use. A sentence cites the first source of
  its facts that is not yet cited. Our own pages and repositories are cited once per post. All other
  sources are cited once per section. Facts listed under an optional `## NOCITE` section cite
  nothing. The TL;DR sums up the body, so it carries no footnotes. The footnote goes before the
  punctuation that ends its clause (`text[^1].`, `文字[^1]。`). `check` warns when citation rates rise
  above 3.5 citations per 100 English words or 1.5 per 100 Chinese characters. It also warns on any
  sentence with two citations. The second language keeps the first language's numbers when it cites
  the sources in the same order. `pair` checks that both cite the same sources. The `**Sources**`
  footer is gone. URLs in the text are autolinks, formatted as `<https://…>`. This is because the
  site reads a footnote right after a bare URL as part of the link.
- Profiles in `reference/profile-<name>.md` hold what differs by kind of text: shape, reader,
  sizes and the rules `check` enforces. The profiles shipped are a perspective post, a docs page
  and landing strings, each with its own output contract.
- Voice rules ask the model to write for readers with dyslexia or ADHD, who read with effort. The
  rules require the model to put the point first, use short sentences, use common words, omit
  asides, and omit defensive hedging. They also ban the "Yes, but…" concession pivot by name.
  `review` checks for both. `check` warns on sentences over 35 English words or 60 Chinese
  characters. In Chinese text, Harness and Agent Harness stay in English. `check` treats 夹具 as an
  error. It treats a lowercase "harness" as a warning.
- For the same readers, a post opens with a TL;DR of its key points. The new `emphasize` step marks
  one key sentence per section in bold. It does not change any other character. Bold in a post is
  reserved for that sentence. UI labels go in quotes. `check` makes any other bold an error. The
  step's answer is refused if it changes the text, marks no span in a section, marks two spans in a
  section, or closes a span after the sentence's punctuation. Chinese text does not render spans
  closed in this position as bold. `check` flags any `**` that CommonMark cannot read as bold.
- Every word inside a figure comes from the model, in a figure block. Drawn figures are inline SVG
  that `check` compares string by string against their blocks.
- The script's local steps check text without the network: structure, budgets, figures, fact
  markers and their sources, footnotes, and the per-language banned lists. `selftest` runs them on
  built-in fixtures.
- The dev skill's read table and `reference/authoring.md` point to the new skill.
