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

- A post is written the way a person writes one, by `scripts/prose.mjs`:
  - `outline` plans the post. Its `# Plan` table gives every section a size, its facts and its
    figures.
  - `plan` checks that table against the profile's budgets, the figure manifest and the facts,
    then freezes it.
  - `section` writes one section per call, in order, from the frozen plan and the sections
    already written.
  - `assemble` joins the sections byte for byte, and `route` splits review findings by the
    section they quote.
  - `translate`, `polish`, `fix` and `review` work section by section; `review` returns findings
    for `fix` and never rewrites.
- Budgets are hard. The plan is held to the profile's caps, and `check` rejects a section above
  1.1 × its planned size or the profile's cap.
- Posts cite like papers. Each fact in the facts file is tagged with its sources, and `strip` turns
  the writer's fact markers into numbered GFM footnotes with a linked reference list. The second
  language reuses the first one's numbers. The `**Sources**` footer is gone.
- Profiles in `reference/profile-<name>.md` hold what differs by kind of text: shape, reader,
  sizes and the rules `check` enforces. The profiles shipped are a perspective post, a docs page
  and landing strings, each with its own output contract.
- The voice rules ask the model to write for a reader with dyslexia, a person who reads with
  effort: the point first, short sentences, common words, no asides or defensive hedging. They also
  ban the "Yes, but…" concession pivot by name, and `review` checks for both.
- Every word inside a figure comes from the model, in a figure block. Drawn figures are inline SVG
  that `check` compares string by string against their blocks.
- The script's local steps check text without the network: structure, budgets, figures, fact
  markers and their sources, footnotes, and the per-language banned lists. `selftest` runs them on
  built-in fixtures.
- The dev skill's read table and `reference/authoring.md` point to the new skill.
