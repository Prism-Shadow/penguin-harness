# GPT-6 Luna, current OpenCode Go presets and cache-weighted prices

- **Date:** 2026-10-14
- **Type:** feature
- **Scope:** `model-catalog`, `web`, `docs`
- **PR:** [#1137](https://github.com/Prism-Shadow/penguin-harness/pull/1137)

[中文版](2026-10-14-latest-models-cache-weighted-sort.zh.md)

Added GPT-6 Luna to OpenAI, OpenRouter and OpenCode Go without changing the MMSP dependency.

## Models and documentation

- Added Go presets for Claude Haiku 5.5, Gemini 4 Argon Contributor, Grok 4.7, MiMo-V2.6 Flash/Pro, LongCat 2.5 Preview Free, Step 5 Preview Free, Cat Jam Free and Space Bunny. Each model tier keeps its latest generation, including DeepSeek V4 Pro alongside V4.1 Flash and Qwen Max, Flash and Plus.
- Go’s **Get API key** link now opens [OpenCode’s authentication guide](https://opencode.ai/v2/docs/console/api/inference/#authentication). Gemini uses Go’s generateContent endpoint with the existing MMSP dependency.
- Grouped the README's priority model families into closed-source and open-source tables in both languages. Fable 5.1, Opus 5.5 and Sonnet 5.5 remain available through Anthropic and OpenRouter.
- Recorded GPT-6 Luna's base prices per million tokens: $0.01 cache read, $0.125 cache write and $0.50 output. MMSP 0.5.3 can call the model; its `none` thinking setting currently sends `low`.

## Price order

The models page now compares 85% cache reads, 10% cache misses (cache writes) and 5% output, using the active promotional and off-peak prices. Free models come first in ascending order; unknown prices remain last in either direction.

## Existing Projects

**Add new models** adds new presets without deleting saved older models or changing the default. **Restore defaults** uses the current presets. Retired Go rows follow the [catalog retention rules](2026-10-14-backward-compatibility.md).
