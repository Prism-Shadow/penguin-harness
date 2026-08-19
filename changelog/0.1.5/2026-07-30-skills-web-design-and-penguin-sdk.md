# web-design and penguin-sdk skills: editorial theme, output contracts, thinking and images

- **Date:** 2026-07-30
- **Type:** feature
- **Scope:** `skills`, `web`
- **PR:** [#133](https://github.com/Prism-Shadow/penguin-harness/pull/133)

[中文版](2026-07-30-skills-web-design-and-penguin-sdk.zh.md)

Two of the built-in skills were reworked across three iterations (web-design v3 → v6, penguin-sdk v14 → v17), with the goal of getting better results from shorter user prompts.

## web-design

- A second complete visual language, the opt-in **paper editorial** theme: warm paper/ink/hairline tokens with one warm accent plus a status green, system-serif display headings over a sans body (CJK serif fallbacks, still no CDN fonts), uppercase mono micro-labels as the hierarchy tool, tighter radii with soft warm shadows, and signature shapes (asymmetric-corner brand mark, echoed user-bubble radius, orbit-medallion flourish). Light-only; the GitHub-style default remains, and the two never mix.
- Theme-agnostic chat/RAG upgrades: an optional knowledge side panel with index-status rows, a fuller empty-state composition (eyebrow → one-accent-word title → subtitle → pill chips or numbered example cards), a retrieval status line while answers stream, a sources accordion as an alternative citation surface, and composer refinements (kbd hints, disclaimer, gradient fade).
- A **ship-complete contract**: the one-line request is the whole spec — the skill never asks how a page should look, routes the recipe by request shape, and every delivery includes `lang`/viewport/title, persisted dark mode, designed loading/empty/error states, a working keyboard path, alt text and zero external requests.
- Chat recipes for the two message kinds modern models add: a collapsible reasoning block (auto-collapsed at the first answer delta, never restyled as answer prose) and composer image attachments (paperclip/paste/drag-drop, thumbnail queue, in-message previews).

## penguin-sdk

- A **Thinking and image messages** section, verified against core's OmniMessage protocol: stream `partial_thinking` into its own collapsed channel and ignore `fidelity` (core's replay bookkeeping); build image input with `imageUrlMessage` beside `userText`, with the config `vision` flag degrading gracefully (`[attached image: <path>]` folding read back through the project's `vision_model`); and a cheat sheet for the remaining app-relevant payloads (`request_end` error signals, `token_usage`, compaction events, tool activity).
- The streaming-loop guidance covers `opts.thinkingLevel` (`none…xhigh`, a per-turn override of `model.thinking_level`) and names Session lifetime as the app's memory model — one long-lived Session for stateful chat, one per request for stateless QA.
- An **output format and language** block in the RAG recipe: fix the format in the persona and per-request prompt (plain text, bare `[n]` citations — or a sanitized HTML whitelist when structure matters) instead of shipping a Markdown renderer, and bridge cross-language lexical retrieval with a small ingest-time bilingual keyword map expanded in `search()`.
- The overlapping "before you build" / "check the model first" sections merged into one keys-and-data-root section, each rule stated once.

## Web draft-page examples

With the knowledge moved into the skills, the draft page's example prompts shrink in both languages: the RAG example drops its BM25 cross-language lecture and empty-state instruction (keeping the bilingual self-test step), and the game-center / music-player examples drop the theme-persistence and responsive details the web-design skill now guarantees.
