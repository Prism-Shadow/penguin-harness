# Atlas Cloud gateway group

- **Date:** 2026-10-03
- **Type:** feature
- **Scope:** `model-catalog`, `ui`, `web`, `docs`, `plugins`
- **PR:** [#959](https://github.com/Prism-Shadow/penguin-harness/pull/959)

[中文版](2026-10-03-atlas-cloud-gateway.zh.md)

[Atlas Cloud](https://atlascloud.ai/) joined the built-in groups as an OpenAI-compatible gateway, between SiliconFlow and Z.AI in the default order. Its rows went to MMSP's generic Chat Completions client at the preset base URL `https://api.atlascloud.ai/v1`, the same path the Fireworks AI, SiliconFlow, TokenDance and Qwen gateway groups take, so the group needed no new client. As on SiliconFlow, the group pins `openai-chat` and takes models added by hand (**Add model** on its header, `penguin config model add --provider atlascloud`), which follow the group's endpoint and protocol: the gateway serves far more models than the catalog presets. The `penguin-config` skill (`2026.10.11.1`) names `atlascloud` among the groups that take models added by hand. Like every gateway group, it records the `OPENAI_API_KEY` / `OPENAI_BASE_URL` pair as the variables its client reads, and a keyless row there is refused that fallback: the key goes on the group or the row. Prices below are USD per million tokens, as cache hit / input / output.

## Rows

Ids, context windows, input modalities, quantization and prices were read from the gateway's public catalog API (`GET https://api.atlascloud.ai/v1/models`, no credential required) on 2026-10-11. Its prices are USD per token; the pricing page (`https://www.atlascloud.ai/pricing/models`) states the same rates per million tokens. The rows are DeepSeek and Qwen models the other gateway groups preset. For DeepSeek they are the releases TokenDance presets rather than the bare V4 ids, taken only where Atlas Cloud serves them at fp8: V4.1 Flash and V4 Pro 0813. Its V4 Flash 0731 is served at fp4, like the bare `deepseek-ai/deepseek-v4-flash` and `deepseek-ai/deepseek-v4-pro`, and none of the three became a preset. Atlas Cloud publishes no cache-write price for these rows, so `cache_write` carries the input price, as the TokenDance and Qwen rows do. Both DeepSeek rows bill one fixed rate around the clock, with no off-peak schedule. Model ids keep their vendor prefix, as on SiliconFlow and ModelScope.

- `deepseek-ai/deepseek-v4.1-flash` (**DeepSeek V4.1 Flash**, fp8) at USD 0.03 / 0.3 / 1.2, 1,048,576-token context window, image input.
- `deepseek-ai/deepseek-v4-pro-0813` (**DeepSeek V4 Pro 0813**, fp8) at USD 0.132 / 1.32 / 3.96, 1,048,576-token context window, text only.
- `qwen/qwen3.6-35b-a3b` (**Qwen 3.6 35B A3B**, fp8) at a list price of USD 0.248 / 0.248 / 1.485 with a 25% promotion, billed 0.186 / 0.186 / 1.11375; 262,144-token context window, image input. Atlas Cloud publishes no cache-hit price for this row, so the cache-hit and input buckets match.

## Existing Projects

Presets are copied into a Project when it is created, so a new Project carries the group right away. An existing Project picks the rows up through **Add new models** on the models page, which also writes the group's endpoint and protocol and the Qwen row's promotion.
