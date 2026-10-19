# A repo skill for blog posts written through the gateway model

- **Date:** 2026-10-19
- **Type:** process
- **Scope:** `skills`

[中文版](2026-10-19-blog-prose-skill.zh.md)

Added the `penguin-harness-blog` development skill under `.agents/skills/`. It records how a
penguin.ooo post is made: a model on the TokenDance gateway writes every reader-facing word, one
API call per step, and agents research, compile the facts, write the prompts, draw the figures,
check and ship. The key is read from `TOKENDANCE_API_KEY` or `TOKENDANCE_KEY_FILE` and never
enters the repository.

## Details

- `scripts/blog-prose.mjs` runs the API steps `outline`, `write`, `translate`, `polish`, `fix`
  and `review` (`seed-2.1-pro` by default). Each step saves the answer and the raw response, fails
  on a truncated answer, and retries the key's concurrency limit with backoff. `--dry-run` prints
  the assembled messages instead.
- The same script's local steps check drafts without the network. `check` covers frontmatter,
  structure, image paths, the Sources footer, fact markers against the facts file, figure blocks
  against the figure manifest, drawn figure sources against their figure blocks, and the
  per-language banned lists. `pair` compares the two languages, and `strip` removes markers and
  turns figure blocks into image lines.
- Every word inside a figure comes from the model: `write` emits a figure block per figure, and
  `translate` translates it.
- `prompts/` holds one prompt pair per step, the shared Markdown contract, and the reusable
  fragments. `reference/en-style.md` and `reference/zh-style.md` hold the voice and banned lists
  the model receives, along with the patterns `check` greps for.
- The dev skill's read table and `reference/authoring.md` point to the new skill.
