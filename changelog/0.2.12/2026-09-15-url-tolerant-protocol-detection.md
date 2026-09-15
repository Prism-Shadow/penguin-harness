# Protocol detection copes with a base URL that is one `/v1` off

- **Date:** 2026-09-15
- **Type:** fix
- **Scope:** `server`, `web`
- **PR:** [#729](https://github.com/Prism-Shadow/penguin-harness/pull/729)

[中文版](2026-09-15-url-tolerant-protocol-detection.zh.md)

## What changed

- Custom-model protocol detection no longer takes the typed base URL literally. The URL is normalized first — trailing slashes, query and fragment dropped, a pasted endpoint path (`/chat/completions`, `/completions`, `/responses`, `/messages`, `/v1/messages`) stripped, a run of repeated `/v1` collapsed to one — and then probed, followed by the same URL with a trailing `/v1` removed or added. Each candidate runs the three protocols in the existing order (`openai-responses` → `ant-messages` → `openai-chat`) and the first one served wins, so an extra `/v1`, a missing `/v1`, or a whole endpoint URL copied out of a provider's documentation all detect the same protocol they would have with the URL typed exactly right. `POST /api/projects/:p/models/detect` reports the base URL that answered as `baseUrl` alongside `detected`.
- Both detect actions in the Web App's Models page — the model dialog's and the add-group dialog's — write that base URL back into the field when it differs from what was typed, and say so in the success toast ("Detected OpenAI Chat Completions; base URL normalized to https://host/v1"). Saving a model whose protocol is still unset detects first, as before, and now persists the corrected URL with it, so the entry is saved against the URL the protocol is really served at.
