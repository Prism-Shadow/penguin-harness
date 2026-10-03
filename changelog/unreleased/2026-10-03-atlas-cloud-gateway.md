# Atlas Cloud gateway group

- **Date:** 2026-10-03
- **Type:** feature
- **Scope:** `model-catalog`, `ui`, `web`, `docs`
- **PR:** [#PRNUM](https://github.com/Prism-Shadow/penguin-harness/pull/PRNUM)

[中文版](2026-10-03-atlas-cloud-gateway.zh.md)

[Atlas Cloud](https://atlascloud.ai/) joins the built-in groups as an OpenAI-compatible gateway, between SiliconFlow and Z.AI in the default order. Its rows reach MMSP's generic Chat Completions client at the preset base URL `https://api.atlascloud.ai/v1`, the same path the Fireworks AI, SiliconFlow, TokenDance and Qwen gateway groups take, so the group needed no new client. Like every gateway group, it records the `OPENAI_API_KEY` / `OPENAI_BASE_URL` pair as the variables its client reads, and a keyless row there is refused that fallback: the key goes on the rows. Prices below are per million tokens, as cache hit / input / output.

## Rows

Context windows and USD prices were read from the gateway's public catalog API (`GET https://api.atlascloud.ai/v1/models`, no credential required) on 2026-10-03. Atlas Cloud publishes one input price and a cheaper cache-hit price with no separate cache-write fee, so `cache_write` carries the input price, as the TokenDance and Qwen rows do. Model ids keep their vendor prefix, as on SiliconFlow and ModelScope. All three rows are text only.

- `deepseek-ai/DeepSeek-V3.1-Terminus` (**DeepSeek V3.1 Terminus**) at USD 0.13 / 0.3 / 0.95, 131,072-token context window.
- `deepseek-ai/DeepSeek-V3.1` (**DeepSeek V3.1**) at USD 0.13 / 0.3 / 0.95, 131,072-token context window.
- `Qwen/Qwen3-235B-A22B-Instruct-2507` (**Qwen3-235B-A22B-Instruct-2507**) at USD 0.2 / 0.2 / 0.88, 131,072-token context window. Atlas Cloud prices its cache hits the same as its input for this row, so the two buckets match.

## Existing Projects

Presets are copied into a Project when it is created, so a new Project carries the group right away. An existing Project picks the rows up through **Sync presets** on the models page.
