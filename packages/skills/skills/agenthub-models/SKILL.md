---
name: agenthub-models
description: Call model APIs through @prismshadow/agenthub — streaming text generation, image generation, speech synthesis and embeddings with one client.
short_description: Call model APIs with one AgentHub client.
short_description_zh: 用一个 AgentHub 客户端调用模型 API。
version: 5
updated: 2026-07-20T15:00:00Z
---

# AgentHub Model APIs

`@prismshadow/agenthub` is a unified TypeScript client for model APIs: streaming text, image generation, speech synthesis and embeddings behind one entry point.

```bash
npm install @prismshadow/agenthub
```

The only entry point is `AutoLLMClient`:

```ts
import { AutoLLMClient } from "@prismshadow/agenthub";

const client = new AutoLLMClient({ model: "<model_id>", apiKey: "<key>", baseUrl: "<url>", clientType: "<type>" });
```

`apiKey`, `baseUrl` and `clientType` are optional (see routing below).

## Before you start

If the user's message only invokes this skill (e.g. "use agenthub-models skill") without a concrete task, ask the user what they want to build. Do not write code until the requirement is clear.

**Important prerequisite — set the key up first, then develop.** When the script is an AI app you are building for the user, have them add the model API key in **this agent's key vault** (gear icon on its card, Agents page → settings → key vault tab) *before* you start, so the credential is in your shell environment. If the app stores its own model config, keep its Penguin data root **inside the CWD workspace** (`--root ./penguin_data`), never `~/.penguin`. Model ids can come from the penguin CLI catalog and the id table below.

Check for a usable API key before writing code — the client needs one for whichever provider you target:

```bash
env | grep -oE "(DEEPSEEK|OPENAI|ANTHROPIC|GEMINI)_API_KEY" || echo none
```

Vault keys also appear in your Vault Keys section. If none is usable, **stop immediately and ask the user for help — do not keep calling tools to retry**: ask them to add one in the agent's **key vault** (gear icon on the agent's card, Agents page → settings → key vault tab); vault values reach your shell environment on the next task. Re-checking the environment or the vault in a loop just wastes turns — one clear check, then hand back to the user.

Keep model API keys **project-local**: for an app that stores its own model config, write the key into the project under the working directory with the penguin CLI, **always passing `--root <data_dir>` for a directory inside the current working directory** (`penguin config model add --root ./penguin_data --model-id <id> --api-key <key>`) — without `--root` it writes to the global `~/.penguin/data` instead. Otherwise rely on vault-injected environment variables. Never read, copy or fall back to model keys stored in the user's global `~/.penguin` directory — that config belongs to the person running Penguin, not to your script.

## Model IDs

Use exact model ids. If an id is not in the table below and the user has not given one, ask the user to confirm the exact id before writing code.

| Family           | Official IDs                                                          | Gateway variants                                                                                                                                |
| ---------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Gemini 3         | `gemini-3.1-pro-preview`, `gemini-3.5-flash`, `gemini-3.1-flash-lite` | —                                                                                                                                               |
| Gemini 3 image   | `gemini-3.1-flash-image-preview`, `gemini-3-pro-image-preview`        | —                                                                                                                                               |
| Gemini 3 TTS     | `gemini-3.1-flash-tts-preview`                                        | —                                                                                                                                               |
| Gemini embedding | `gemini-embedding-2`                                                  | —                                                                                                                                               |
| Claude           | `claude-sonnet-4-6`, `claude-opus-4-7`, `claude-opus-4-8`             | —                                                                                                                                               |
| GPT              | `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-5.5`                  | —                                                                                                                                               |
| OpenAI embedding | `text-embedding-3-small`, `text-embedding-3-large`                    | —                                                                                                                                               |
| Kimi K2.6        | `kimi-k2.6`                                                           | OpenRouter `moonshotai/kimi-k2.6`; SiliconFlow `Pro/moonshotai/Kimi-K2.6`                                                                       |
| DeepSeek V4      | `deepseek-v4-pro`, `deepseek-v4-flash`                                | OpenRouter `deepseek/deepseek-v4-pro`, `deepseek/deepseek-v4-flash`; SiliconFlow `deepseek-ai/DeepSeek-V4-Pro`, `deepseek-ai/DeepSeek-V4-Flash` |
| GLM 5.1          | `glm-5.1`                                                             | OpenRouter `z-ai/glm-5.1`; SiliconFlow `Pro/zai-org/GLM-5.1`                                                                                    |

Gateway model lists can be queried online:

```bash
curl https://openrouter.ai/api/v1/models
curl --request GET --url https://api.siliconflow.cn/v1/models --header 'Authorization: Bearer <token>'
```

## Routing and credentials

- Without `clientType`, the client auto-routes by model id substring: `gemini-3*`, `gemini-embedding`, `claude` 4-6/4-7/4-8, `gpt-5.4`/`gpt-5.5`, `glm-5`, `kimi-k2.5`/`kimi-k2.6`, `deepseek-v4`, `openai`+`embedding` (embeddings), `openai`. Ids matching none of these throw. The gateway variants in the table above hit the same substrings, so they route to the right family — just set `baseUrl` to the gateway endpoint.
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
- `config` accepts `max_tokens`, `temperature`, `system_prompt`, `thinking_level` (the `ThinkingLevel` enum, `NONE` to `XHIGH`) and `tools`.
- `streamingResponseStateful` keeps conversation history inside the client; manage it with `getHistory()` / `setHistory(history)` / `clearHistory()`. The stateless variant is `streamingResponse({ messages, config })`.

## Image generation

Use a Gemini image model (see Model IDs) and set `config.image_config` (optional `aspect_ratio`, and `image_size` of `"1K"` | `"2K"`):

```ts
import fs from "node:fs";

const client = new AutoLLMClient({ model: "gemini-3.1-flash-image-preview" });
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
