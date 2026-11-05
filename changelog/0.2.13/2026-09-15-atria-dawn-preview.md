# The custom group ships Atria Dawn Preview

- **Date:** 2026-09-15
- **Type:** feature
- **Scope:** `core`
- **PR:** [#729](https://github.com/Prism-Shadow/penguin-harness/pull/729)

[中文版](2026-09-15-atria-dawn-preview.zh.md)

## What changed

- The built-in catalog's custom group gains its first preset, `Atria-Dawn-Preview`: the Anthropic Messages API at `https://api.atria-asi.ai` (the client appends `/v1/messages`; with no key on the entry it reads `ANTHROPIC_API_KEY`), a 256K context window, text only, and a $0 price until the vendor publishes one. The endpoint also serves Responses, but that side rejects the replayed assistant turn of a multi-turn conversation, so the preset speaks Messages. A preset in the custom group carries its own base URL and a pinned generic protocol, since the group implies neither; existing Projects pick it up through the models page's "sync presets".
