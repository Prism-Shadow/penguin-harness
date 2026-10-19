# A repo skill for prose written through the gateway model

- **Date:** 2026-10-19
- **Type:** process
- **Scope:** `skills`
- **PR:** [#1216](https://github.com/Prism-Shadow/penguin-harness/pull/1216)

[中文版](2026-10-19-writing-skill.zh.md)

Added the `penguin-harness-writing` development skill under `.agents/skills/`. It records how
penguin.ooo text is made, whether a blog post, a docs page or landing copy. A model on the
TokenDance gateway writes every reader-facing word, one API call per step. Agents research,
compile the facts, write the prompts, draw the figures from the model's own strings, check and
ship. The key is read from `TOKENDANCE_API_KEY` or `TOKENDANCE_KEY_FILE` and never enters the
repository.

## Details

- `scripts/prose.mjs` runs the API steps `outline`, `write`, `translate`, `polish`, `fix` and
  `review` (`seed-2.1-pro` by default).
  - Each step saves the answer and the raw response, fails on a truncated answer, and retries the
    key's concurrency limit with backoff.
  - `--dry-run` prints the assembled messages instead of calling.
  - `review` returns numbered findings for `fix` and never rewrites.
- Profiles in `reference/profile-<name>.md` hold what differs by kind of text: shape, reader,
  length, and the structure rules `check` enforces. The profiles shipped are a perspective post, a
  docs page and landing strings, each with its own output contract.
- Every word inside a figure comes from the model. `write` emits a figure block per figure,
  `translate` translates it, and drawn figures are inline SVG checked string for string against
  their blocks.
- The same script's local steps check text without the network:
  - `check` covers frontmatter, structure, figure blocks against the manifest, drawn figures
    against their blocks, the Sources footer, fact markers against the facts file, and the
    per-language banned lists.
  - `pair` compares the two languages.
  - `strip` removes markers and inlines the drawn figures.
- `prompts/` holds one prompt pair per step, the contracts and the reusable fragments.
  `reference/en-style.md` and `reference/zh-style.md` hold the voice and banned lists the model
  receives, along with the patterns `check` greps for.
- The dev skill's read table and `reference/authoring.md` point to the new skill.
