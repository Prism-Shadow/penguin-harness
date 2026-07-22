---
name: agenthub-models
description: Call model APIs through @prismshadow/agenthub — streaming text generation, image generation, speech synthesis, embeddings and the supported-model registry with one client.
short_description: Call model APIs with one AgentHub client.
short_description_zh: 用一个 AgentHub 客户端调用模型 API。
version: 8
updated: 2026-07-22T00:00:00Z
---

# AgentHub Model APIs

`@prismshadow/agenthub` is a unified TypeScript client for model APIs: streaming text, image generation, speech synthesis and embeddings behind one entry point.

```bash
npm install @prismshadow/agenthub
```

The main entry point is `AutoLLMClient`:

```ts
import { AutoLLMClient } from "@prismshadow/agenthub";

const client = new AutoLLMClient({ model: "<model_id>", apiKey: "<key>", baseUrl: "<url>", clientType: "<type>" });
```

`apiKey`, `baseUrl` and `clientType` are optional (see routing below). The package also exports `listSupportedModels` (the model registry) and the error classes `AgentHubError`, `UnsupportedParameterError`, `EmptyResponseError` and `ToolCallArgumentParseError`.

## Before you start

If the user's message only invokes this skill (e.g. "use agenthub-models skill") without a concrete task, ask the user what they want to build. Do not write code until the requirement is clear.

**Important prerequisite — set the key up first, then develop.** When the script is an AI app you are building for the user, have them add the model API key in **this agent's key vault** (gear icon on its card, Agents page → settings → key vault tab) *before* you start, so the credential is in your shell environment. If the app stores its own model config, keep its Penguin data root **inside the CWD workspace** (`--root ./penguin_data`), never `~/.penguin`. Model ids can come from the penguin CLI catalog and the id table below.

Check for a usable API key before writing code — the client needs one for whichever provider you target:

```bash
env | grep -oE "(DEEPSEEK|OPENAI|ANTHROPIC|GEMINI)_API_KEY" || echo none
```

Vault keys also appear in your Vault Keys section. **Only two sources count as a usable key**: a vault-injected environment variable (the check above), or — when the app stores its own model config — a key already configured in the app's own data root (`penguin config model list --root <data_dir>`). Keys living in the global `~/.penguin` or any other `.penguin` directory do **not** count — a bare `penguin config model list` (no `--root`) reads the global store, because the CLI defaults to the global root unless `--root` is given, so a key showing up there proves nothing for your script and must never be used or copied.

If neither counted source yields a usable key, **stop immediately and ask the user to configure one — do not write code, and do not keep calling tools to retry**: ask them to add one in the agent's **key vault** (gear icon on the agent's card, Agents page → settings → key vault tab); vault values reach your shell environment on the next task. Re-checking the environment or the vault in a loop just wastes turns — one clear check, then hand back to the user.

Keep model API keys **project-local**: for an app that stores its own model config, write the key into the project under the working directory with the penguin CLI, **always passing `--root <data_dir>` for a directory inside the current working directory** (`penguin config model add --root ./penguin_data --provider <group> --model-id <id> --api-key <key>`) — without `--root` it writes to the global `~/.penguin/data` instead. `--provider` is required alongside `--model-id`: a model entry is the `(provider, model_id)` pair and the group is never inferred (use `custom` for an endpoint outside the built-in groups). Otherwise rely on vault-injected environment variables. Never read, copy or fall back to model keys stored in the user's global `~/.penguin` directory — that config belongs to the person running Penguin, not to your script.

## Model IDs

Use exact model ids. If an id is not in the table below and the user has not given one, ask the user to confirm the exact id before writing code.

| Family           | Official IDs                                                          | Gateway variants                                                                                                                                |
| ---------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Gemini 3.6       | `gemini-3.6-flash`, `gemini-3.5-flash-lite`                           | —                                                                                                                                               |
| Gemini 3         | `gemini-3.1-pro-preview`, `gemini-3.5-flash`, `gemini-3.1-flash-lite` | —                                                                                                                                               |
| Gemini 3 image   | `gemini-3.1-flash-image`, `gemini-3-pro-image-preview`                | —                                                                                                                                               |
| Gemini 3 TTS     | `gemini-3.1-flash-tts-preview`                                        | —                                                                                                                                               |
| Gemini embedding | `gemini-embedding-2`                                                  | —                                                                                                                                               |
| Claude           | `claude-sonnet-4-6`, `claude-opus-4-7`, `claude-opus-4-8`             | —                                                                                                                                               |
| GPT              | `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-5.5`                  | —                                                                                                                                               |
| OpenAI embedding | `text-embedding-3-small`, `text-embedding-3-large`                    | —                                                                                                                                               |
| Kimi K3          | `kimi-k3`                                                             | OpenRouter `moonshotai/kimi-k3`                                                                                                                 |
| Kimi K2.6        | `kimi-k2.6`                                                           | OpenRouter `moonshotai/kimi-k2.6`; SiliconFlow `Pro/moonshotai/Kimi-K2.6`                                                                       |
| DeepSeek V4      | `deepseek-v4-pro`, `deepseek-v4-flash`                                | OpenRouter `deepseek/deepseek-v4-pro`, `deepseek/deepseek-v4-flash`; SiliconFlow `deepseek-ai/DeepSeek-V4-Pro`, `deepseek-ai/DeepSeek-V4-Flash` |
| GLM 5.2          | `glm-5.2`                                                             | OpenRouter `z-ai/glm-5.2`; SiliconFlow `zai-org/GLM-5.2`                                                                                        |
| GLM 5.1          | `glm-5.1`                                                             | OpenRouter `z-ai/glm-5.1`; SiliconFlow `Pro/zai-org/GLM-5.1`                                                                                    |

The image endpoint dropped its preview suffix: `gemini-3.1-flash-image-preview` is deprecated, use `gemini-3.1-flash-image`.

Gateway model lists can be queried online:

```bash
curl https://openrouter.ai/api/v1/models
curl --request GET --url https://api.siliconflow.cn/v1/models --header 'Authorization: Bearer <token>'
```

## Supported-model registry

`listSupportedModels(currency?)` returns the models AgentHub itself knows how to route, so ids, endpoints, modalities, context windows and prices can be read from the package instead of being hardcoded:

```ts
import { listSupportedModels } from "@prismshadow/agenthub";

for (const m of listSupportedModels()) {
  console.log(m.model, m.base_url, m.client, m.context_window, m.pricing?.prompt_tokens);
}
```

- Each `SupportedModel` is `{ model, base_url, client, input_modalities, output_modalities, context_window?, pricing? }`. The `(model, base_url, client)` triple maps straight onto the constructor: `new AutoLLMClient({ model, baseUrl: base_url, clientType: client })`.
- Modalities are `"Text" | "Image" | "Video" | "Audio" | "Embed"`. Coverage includes the official vendor endpoints plus the OpenRouter and SiliconFlow gateways; `context_window` and `pricing` are omitted where the platform publishes no authoritative value (image and TTS models, for instance).
- `pricing` is per million tokens, keyed by the same usage buckets as `usage_metadata`: `prompt_tokens` (non-cached input), `thoughts_tokens` / `response_tokens` (both the output price) and optional `cached_tokens` (cache-hit price). Values are stored in USD; pass `listSupportedModels("CNY")` to convert at 7 CNY/USD.

The registry is the curated current line-up, so prefer it when picking a model or estimating cost. It is narrower than the routing rules: older ids in the table above (`gpt-5.4`, `claude-opus-4-7`, `gemini-3.1-pro-preview`, `gemini-3.1-flash-lite`) still route fine but no longer appear in it.

## Routing and credentials

- Without `clientType`, the client auto-routes by model id substring, in this order: `gemini-3.6` / `gemini-3.5-flash-lite`, then `gemini-3*` / `gemini-embedding`, `claude` 4-6/4-7/4-8/-5, `gpt-5.4`/`gpt-5.5`, `glm-5.2`, `glm-5`, `kimi-k3`, `kimi-k2.5`/`kimi-k2.6`, `deepseek-v4`, `openai`+`embedding` (embeddings), `openai`. Ids matching none of these throw. The gateway variants in the table above hit the same substrings, so they route to the right family — just set `baseUrl` to the gateway endpoint.
- Exception: a Gemini id served by an OpenAI-compatible gateway (e.g. OpenRouter's `google/gemini-3.6-flash`) still matches the Gemini substring and would auto-route to the Google protocol client. Pass `clientType: "openai"` explicitly for those.
- For any other OpenAI chat-completion compatible model (e.g. Qwen series via OpenRouter or SiliconFlow), pass `clientType: "openai"` plus `baseUrl` (embeddings endpoints use a different client type — see Embeddings below).
- API key: constructor parameter first, then the provider environment variable — `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ZAI_API_KEY`, `MOONSHOT_API_KEY`. Base URLs read the same names with `_BASE_URL`.

## Streaming text

```ts
for await (const event of client.streamingResponseStateful({
  message: { role: "user", content_items: [{ type: "text", text: "Hello" }] },
  config: {},
})) {
  for (const item of event.content_items) {
    if (item.type === "text") process.stdout.write(item.text);
  }
}
```

- Each `event` is a `UniEvent`: `event_type` is `start` | `delta` | `stop`, and `content_items` carry the increments.
- `config` accepts `max_tokens`, `temperature`, `system_prompt`, `thinking_level` (the `ThinkingLevel` enum, `NONE` to `XHIGH`), `tool_choice`, `prompt_caching` and `tools`.
- `streamingResponseStateful` keeps conversation history inside the client; manage it with `getHistory()` / `setHistory(history)` / `clearHistory()`. The stateless variant is `streamingResponse({ messages, config })`.

## Config parameters the model may reject

A config value the target client cannot honour throws `UnsupportedParameterError` (an `AgentHubError` carrying `client` and `parameter`) while building the request, before anything reaches the network:

```ts
import { UnsupportedParameterError } from "@prismshadow/agenthub";

try {
  // ...
} catch (err) {
  if (err instanceof UnsupportedParameterError) console.error(err.parameter, err.message);
}
```

- `thinking_level` never throws: every client maps each level onto the closest one the model supports. Kimi K3 reasons unconditionally, so `NONE` degrades to its lowest effort rather than disabling thinking; GLM-5.2 sends `reasoning_effort` alongside its `thinking` block and only `NONE` disables it.
- `temperature` is rejected outright by Gemini 3.6 — that generation deprecated the sampling parameters, so the client refuses them instead of sending a value the API ignores. GPT-5.5, Claude 4.8/5, DeepSeek V4, Kimi K2.6 and Kimi K3 accept only the protocol default `1.0` and reject any other value. Gemini 3, Claude 4.6, GLM and the generic OpenAI client pass it through.
- `tool_choice`: `"auto"` is safe everywhere. Claude accepts a single forced tool name; DeepSeek V4 and Kimi K2.6 allow `"auto"` / `"none"`; Kimi K3 adds `"required"` but refuses a specific tool; GLM only accepts `"auto"`.
- `prompt_caching`: every client accepts `PromptCaching.ENABLE` and rejects the other values — caching is on by default and Kimi K3 caches context automatically.

Leave a parameter unset and the protocol default applies, which is the portable choice when a script must run against several families.

## Image generation

Use a Gemini image model (see Model IDs) and set `config.image_config` (optional `aspect_ratio`, and `image_size` of `"1K"` | `"2K"`):

```ts
import fs from "node:fs";

const client = new AutoLLMClient({ model: "gemini-3.1-flash-image" });
for await (const event of client.streamingResponseStateful({
  message: { role: "user", content_items: [{ type: "text", text: "A penguin on a glacier" }] },
  config: { image_config: { aspect_ratio: "16:9", image_size: "2K" } },
})) {
  for (const item of event.content_items) {
    if (item.type === "inline_data") fs.writeFileSync("image.png", item.data);
  }
}
```

Images arrive as `inline_data` content items (`data` is a Buffer, with `mime_type`).

## Speech synthesis

Use a Gemini TTS model (`gemini-3.1-flash-tts-preview`) and set `config.tts_config`:

```ts
config: { tts_config: [{ voice: "Kore" }] }
```

- One entry → single voice; two entries → multi-speaker, and each entry must also set `speaker`.
- The `inline_data` output is raw PCM (24kHz 16-bit mono) — wrap it in a WAV header yourself before saving as `.wav`.

## Embeddings

Two routes:

- Gemini: a model whose id contains `gemini-embedding` auto-routes (`gemini-embedding-2`).
- Any OpenAI-compatible embeddings endpoint: pass `clientType: "openai-embedding"` (plus `baseUrl` and `apiKey` as needed) — ids like `text-embedding-3-small` / `text-embedding-3-large` match no auto-route substring and would throw without it.

Optional `config.embedding_config`:

```ts
config: { embedding_config: { dimensions: 768 } }
```

The output arrives as `embedding` content items (`embedding` is a number array).
