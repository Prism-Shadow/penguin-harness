# Model catalog update: Claude 5.5, GPT-6.1 Sol, TokenDance re-read, Gemini 3.7 Flash removed

- **Date:** 2026-10-10
- **Type:** feature
- **Scope:** `model-catalog`, `core`, `docs`
- **PR:** [#1016](https://github.com/Prism-Shadow/penguin-harness/pull/1016)

[中文版](2026-10-10-model-catalog-update.zh.md)

The built-in model catalog was updated on 2026-10-10. The new Claude and GPT models from MMSP 0.5.2 joined the Anthropic, OpenAI and OpenRouter groups. The whole TokenDance group was re-read from its public portal API. OpenRouter and SiliconFlow gained rows, and Gemini 3.7 Flash left every group. Prices below are per million tokens, as cache hit / input / output.

## Anthropic and OpenAI

- Added `claude-fable-5-1` (**Claude Fable 5.1**) at USD 0.25 / 10 / 50, `claude-opus-5-5` (**Claude Opus 5.5**) at 0.20 / 4 / 20, `claude-sonnet-5-5` (**Claude Sonnet 5.5**) at 0.10 / 2 / 10 and `claude-haiku-5-5` (**Claude Haiku 5.5**) at 0.01 / 0.10 / 0.50. Each has a 1,000,000-token context window and image input, and its cache-write bucket stores Anthropic's 5-minute write price (12.5, 5, 2.5 and 0.125). Haiku 5.5 is priced by prompt length, and every rate is 5x for a prompt over 100,000 tokens. The row records the base tier.
- Added `gpt-6.1-sol` (**GPT-6.1 Sol**) at USD 0.10 / 2 / 10, with the 2.50 cache-write price in the cache-write bucket, a 1,050,000-token context window and image input. Prompts above 272K tokens cost more, and the row records the base tier.
- Haiku 5.5 joined the Claude ids that get no fast-mode switch, beside Claude 4.6, Sonnet 5.5 and Fable 5.1. MMSP 0.5.2 is the first release whose Anthropic client knows `claude-haiku-5-5`.

## OpenRouter

- Added the four Claude rows above as `anthropic/claude-fable-5.1`, `anthropic/claude-opus-5.5`, `anthropic/claude-sonnet-5.5` and `anthropic/claude-haiku-5.5`, and `openai/gpt-6.1-sol`, each at the same price as its direct row.
- Added `stepfun/step-5-preview` (**Step 5 Preview**) at USD 0.05 / 1 / 2.70 with a 1,000,000-token context window, `x-ai/grok-4.7` (**Grok 4.7**) at 0.50 / 2 / 6 with a 500,000-token window, `xiaomi/mimo-v2.6-flash` (**MiMo-V2.6-Flash**) at 0.0028 / 0.14 / 0.28 and `xiaomi/mimo-v2.6-pro` (**MiMo-V2.6-Pro**) at 0.0036 / 0.435 / 0.87, both with a 1,048,576-token window. All four take images. Grok 4.7's rates double above 200K prompt tokens, and the row records the base tier.

## TokenDance

- The group was re-read from `tokendance.space/portal/api/models/all` and `tokendance.space/gateway/v1/models`.
- Added eight rows:
  - `glm-5.2` (**GLM-5.2**): CNY 2 / 8 / 28 at 20% off.
  - `glm-5.3-flashx` (**GLM-5.3 FlashX**, image input): CNY 0.57 / 2 / 7.
  - `ling-3.0-flash` (**Ling-3.0-flash**): CNY 0.08 / 0.4 / 1.2 at 65% off, with a 256,000-token window.
  - `ling-3.1-flash` (**Ling-3.1-flash**): CNY 0.08 / 0.4 / 1.2, recorded at its list price. Its two-week free trial ends around 2026-10-14.
  - `mimo-v2.6-flash` (**MiMo-V2.6-Flash**): CNY 0.02 / 1 / 2.
  - `mimo-v2.6-pro` (**MiMo-V2.6-Pro**): CNY 0.025 / 3 / 6.
  - `mimo-v2.6-ultraspeed` (**MiMo-V2.6-Pro-UltraSpeed**): CNY 0.25 / 30 / 60.
  - `step-5-preview` (**Step 5 Preview**): CNY 0.35 / 7 / 20.
- The MiMo and Step rows take images. Unless stated otherwise above, each new row has a 1,000,000-token context window.
- The gateway's DeepSeek V4 preview releases, sold under the bare ids `deepseek-v4-flash` and `deepseek-v4-pro`, are not presets; the dated 0731 and 0813 rows that superseded them are.
- `deepseek-v4-flash-0731` and `deepseek-v4-pro-0813` moved from a flat 10% promotion to DeepSeek's peak/off-peak schedule. The peak list prices are CNY 0.1 / 3 / 9 and 0.3 / 9 / 27, and both halve outside Beijing weekday 09:00–12:00 and 14:00–18:00.
- TokenDance also takes 20% off these two rows at peak, and off `deepseek-v4.1-flash` at every hour. A row cannot record a promotion beside a schedule, so those hours are priced at the list rate.
- `kimi-k3` lost its 40% promotion and now lists at CNY 2 / 20 / 100.
- Every other row was unchanged: `dots-3-note-preview`, `glm-5.3`, `glm-5.3-flash`, `hy4-preview`, `qwen3.8-flash`, `qwen3.8-max` and the three Seed rows. The gateway still serves each of them.

## SiliconFlow

- Added `zai-org/GLM-5.3-Flash` (**GLM-5.3 Flash**, image input) at CNY 0.23 / 0.8 / 2.8, with a 1,048,576-token context window.
- `tencent/Hy4-preview` kept its CNY 0.3 / 6 / 18. Its context window moved from 1,024,000 to the 1,048,576 tokens SiliconFlow publishes.

## Gemini 3.7 Flash

- Removed `gemini-3.7-flash` from the Google and Penguin Go groups, and `google/gemini-3.7-flash` from OpenRouter. Google is retiring the id and reroutes requests for it to Gemini 3.8 Flash, which every one of those groups already lists.

## Docs

- The **Models & Providers** page lists the new presets and the new TokenDance promotions, and drops Gemini 3.7 Flash. It counts SiliconFlow among the GLM-5.3 Flash sellers and the two TokenDance DeepSeek rows among the scheduled ones.
- The READMEs' supported-model table names GPT 6.1, Gemini 3.8 Flash and Claude 5.5.

## Existing Projects

A Project gets presets when it is created, and **Add new models** adds the presets it lacks without changing any row it already has. Existing Projects therefore keep their stored rows:

- The removed Gemini 3.7 Flash rows stay, with their stored price and promotion, and keep working because Google reroutes the id. With no catalog entry left to name them, they show their model id instead of **Gemini 3.7 Flash**, unless the Project stores a display name of its own.
- The TokenDance `kimi-k3`, `deepseek-v4-flash-0731` and `deepseek-v4-pro-0813` rows keep their old prices and promotions.

**Restore defaults** brings a Project's built-in rows to the prices and promotions above. A Gemini 3.7 Flash row is no longer a built-in row, so it stays as it is.
