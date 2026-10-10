---
name: unified-llm-api
description: Call model APIs through @prismshadow/mmsp (MMSP) — streaming text generation, image generation, speech synthesis, embeddings and the supported-model registry with one client.
version: 2026.10.10.1
---

# Unified LLM API (MMSP)

`@prismshadow/mmsp` — MMSP, the Model Message Stream Protocol, formerly `@prismshadow/agenthub` — is a unified TypeScript client for model APIs: one message format and one streaming grammar for text, image generation, speech synthesis and embeddings, behind one entry point.

```bash
npm install @prismshadow/mmsp
```

The main entry point is `AutoLLMClient`:

```ts
import { AutoLLMClient } from "@prismshadow/mmsp";

const client = new AutoLLMClient({ model: "<model_id>", apiKey: "<key>", baseUrl: "<url>", clientType: "<type>" });
```

`apiKey`, `baseUrl` and `clientType` are optional (see [Routing and credentials](#routing-and-credentials)); `defaultHeaders` adds request headers. The package also exports `listSupportedModels` (the model registry), `normalizeLegacyMessages`, the `ThinkingLevel` / `PromptCaching` enums, the message and event types, and the error classes (see [Errors](#errors)).

## Before you start

If the user's message only invokes this skill (e.g. "use unified-llm-api skill") without a concrete task, ask the user what they want to build. Do not write code until the requirement is clear.

**Important prerequisite — set the key up first, then develop.** When the script is an AI app you are building for the user, have them add the model API key in **this agent's key vault** (gear icon on its card, Agents page → settings → key vault tab) *before* you start, so the credential is in your shell environment. If the app stores its own model config, keep its Penguin data root **inside the CWD workspace** (`--root ./penguin_data`), never `~/.penguin`. Model ids can come from the penguin CLI catalog and the id table below.

Check for a usable API key before writing code — the client needs one for whichever provider you target:

```bash
env | grep -oE "(DEEPSEEK|OPENAI|ANTHROPIC|GEMINI|ZAI|MOONSHOT|MINIMAX)_API_KEY" || echo none
```

Vault keys also appear in your Vault Keys section. **Only two sources count as a usable key**: a vault-injected environment variable (the check above), or — when the app stores its own model config — a key already configured in the app's own data root (`penguin config model list --root <data_dir>`). Keys living in the global `~/.penguin` or any other `.penguin` directory do **not** count — a bare `penguin config model list` (no `--root`) reads the global store, because the CLI defaults to the global root unless `--root` is given, so a key showing up there proves nothing for your script and must never be used or copied.

If neither counted source yields a usable key, **stop immediately and ask the user to configure one — do not write code, and do not keep calling tools to retry**: ask them to add one in the agent's **key vault** (gear icon on the agent's card, Agents page → settings → key vault tab); vault values reach your shell environment on the next task. Re-checking the environment or the vault in a loop just wastes turns — one clear check, then hand back to the user.

Keep model API keys **project-local**: for an app that stores its own model config, write the key into the project under the working directory with the penguin CLI, **always passing `--root <data_dir>` for a directory inside the current working directory** (`penguin config model add --root ./penguin_data --provider <group> --model-id <id> --api-key <key>`) — without `--root` it writes to the global `~/.penguin/data` instead. `--provider` is required alongside `--model-id`: a model entry is the `(provider, model_id)` pair and the group is never inferred (use `custom` for an endpoint outside the built-in groups). Otherwise rely on vault-injected environment variables. Never read, copy or fall back to model keys stored in the user's global `~/.penguin` directory — that config belongs to the person running Penguin, not to your script.

## Model IDs

Use exact model ids. If an id is not in the table below and the user has not given one, ask the user to confirm the exact id before writing code. Official ids route on their own; every gateway id needs an explicit `clientType` (see [Routing and credentials](#routing-and-credentials)).

| Family                 | Official IDs                                                                          | Gateway variants                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Gemini 3.8 / 3.7 / 3.6 | `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash-lite`   | OpenRouter `google/gemini-3.8-flash`, `google/gemini-3.7-flash`                                                                                 |
| Gemini 3               | `gemini-3.1-pro-preview`, `gemini-3.5-flash`, `gemini-3.1-flash-lite`                 | —                                                                                                                                               |
| Gemini image           | `gemini-3.1-flash-image`, `gemini-3.1-flash-lite-image`, `gemini-3-pro-image`         | —                                                                                                                                               |
| Gemini TTS             | `gemini-3.8-flash-tts`, `gemini-3.8-flash-lite-tts`, `gemini-3.1-flash-tts-preview`   | —                                                                                                                                               |
| Gemini embedding       | `gemini-embedding-2`                                                                  | —                                                                                                                                               |
| Claude 5.5 / Fable 5.1 | `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5-1`        | OpenRouter `anthropic/claude-opus-5.5`, `anthropic/claude-sonnet-5.5`, `anthropic/claude-haiku-5.5`, `anthropic/claude-fable-5.1`               |
| Claude 5               | `claude-fable-5`, `claude-opus-5`, `claude-sonnet-5`                                  | OpenRouter `anthropic/claude-fable-5`, `anthropic/claude-opus-5`, `anthropic/claude-sonnet-5`                                                   |
| Claude 4               | `claude-sonnet-4-6`, `claude-opus-4-7`, `claude-opus-4-8`                             | OpenRouter `anthropic/claude-opus-4.8`, `anthropic/claude-opus-4.7`                                                                             |
| GPT-6                  | `gpt-6.1-sol`, `gpt-6-astra`                                                          | OpenRouter `openai/gpt-6.1-sol`, `openai/gpt-6-astra`                                                                                           |
| GPT-5.6                | `gpt-5.6` (routes to sol), `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`             | OpenRouter `openai/gpt-5.6-sol`, `openai/gpt-5.6-terra`, `openai/gpt-5.6-luna`                                                                  |
| GPT-5.5 / 5.4          | `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`                                  | OpenRouter `openai/gpt-5.5`, `openai/gpt-5.5-pro`, `openai/gpt-5.4`, `openai/gpt-5.4-mini`, `openai/gpt-5.4-nano`, `openai/gpt-5.4-pro`         |
| OpenAI embedding       | `text-embedding-3-small`, `text-embedding-3-large`                                    | —                                                                                                                                               |
| MiniMax M3             | `MiniMax-M3`                                                                          | OpenRouter `minimax/minimax-m3`                                                                                                                 |
| Kimi K3 / K2.6         | `kimi-k3`, `kimi-k2.6`                                                                | OpenRouter `moonshotai/kimi-k3`, `moonshotai/kimi-k2.6`; SiliconFlow `Pro/moonshotai/Kimi-K2.6`                                                 |
| Kimi K2.7 Code         | —                                                                                     | SiliconFlow `moonshotai/Kimi-K2.7-Code`; Fireworks AI `accounts/fireworks/models/kimi-k2p7-code`                                                |
| DeepSeek V4            | `deepseek-flash`, `deepseek-v4-pro`                                                   | OpenRouter `deepseek/deepseek-v4.1-flash`, `deepseek/deepseek-v4-pro-0813`, `deepseek/deepseek-v4-pro`, `deepseek/deepseek-v4-flash`, `deepseek/deepseek-v4-flash-0731`, `deepseek/deepseek-v4-flash-vision-exp`; Fireworks AI `accounts/fireworks/models/deepseek-v4p1-flash`, `accounts/fireworks/models/deepseek-v4-pro-0813`, `accounts/fireworks/models/deepseek-v4-flash-0731`; SiliconFlow `deepseek-ai/DeepSeek-V4-Pro`, `deepseek-ai/DeepSeek-V4-Flash` |
| GLM 5.3 / 5.2 / 5.1    | `glm-5.3`, `glm-5.3-flash`, `glm-5.2`, `glm-5.1`                                      | OpenRouter `z-ai/glm-5.3`, `z-ai/glm-5.3-flash`, `z-ai/glm-5.2`; SiliconFlow `zai-org/GLM-5.2`                                                  |
| Qwen 3.8 Max           | —                                                                                     | OpenRouter `qwen/qwen3.8-max`                                                                                                                   |
| Qwen 3.8 Flash         | —                                                                                     | Qwen DashScope `qwen3.8-flash`                                                                                                                  |
| Qwen 3.6               | —                                                                                     | OpenRouter `qwen/qwen3.6-35b-a3b`; SiliconFlow `Qwen/Qwen3.6-35B-A3B`                                                                           |
| Inkling                | —                                                                                     | OpenRouter `thinkingmachines/inkling`; Fireworks AI `accounts/fireworks/models/inkling`                                                         |

The image endpoint dropped its preview suffix: `gemini-3.1-flash-image-preview` is deprecated, use `gemini-3.1-flash-image`.

`glm-5.3-flash` is the one GLM model that reads images: `zai-official` sends an `image_url.done` item as an `image_url` part, in a prompt and in a tool result alike (an HTTP(S) URL and a base64 data URL both pass through), and matches the version case-insensitively, so the gateway spellings `z-ai/glm-5.3-flash` and `zai-org/GLM-5.3-Flash` count too. Every other GLM id refuses an image rather than dropping it (`GLM <id> does not support image inputs.`), `glm-5v-turbo` included.

Gateway model lists can be queried online:

```bash
curl https://openrouter.ai/api/v1/models
curl --request GET --url https://api.siliconflow.cn/v1/models --header 'Authorization: Bearer <token>'
```

## Supported-model registry

`listSupportedModels(currency?)` returns the models MMSP curates, so ids, endpoints, modalities, context windows and prices can be read from the package instead of being hardcoded:

```ts
import { listSupportedModels } from "@prismshadow/mmsp";

for (const m of listSupportedModels()) {
  console.log(m.model, m.base_url, m.client, m.context_window, m.pricing?.prompt_tokens);
}
```

- Each `SupportedModel` is `{ model, base_url, client, input_modalities, output_modalities, context_window?, pricing? }`. The `(model, base_url, client)` triple maps straight onto the constructor: `new AutoLLMClient({ model, baseUrl: base_url, clientType: client })` — `client` is the client type MMSP pairs with that id, gateway ids included.
- Modalities are `"Text" | "Image" | "Video" | "Audio" | "Embed"`. Coverage includes the official vendor endpoints plus the OpenRouter and SiliconFlow gateways; `context_window` and `pricing` are omitted where the platform publishes no authoritative value.
- `pricing` is the list price per million tokens (a running promotion is not recorded), keyed by the usage buckets of `usage_metadata`: `prompt_tokens` (non-cached input), `thoughts_tokens` / `response_tokens` (both the output price) and optional `cached_tokens` (cache-hit price). Values are stored in USD; `listSupportedModels("CNY")` converts at 7 CNY/USD.

The registry is the curated current line-up, not the routing table: any id of a known family routes whether or not the registry lists it. For an id it omits, take the context window and price from the vendor's own page.

## Routing and credentials

**Client types.** `clientType` names one client:

- **Official** clients speak their vendor's own API: `openai-official` (Responses API; `text-embedding-*` ids go to the Embeddings API), `anthropic-official` (Messages; a `bedrock://<region>` base URL reaches Bedrock), `google-official` (Interactions API only; a Vertex AI service-account JSON key is refused with an error naming `google-genai`; `gemini-official`, its name before 0.5.2, is kept as an alias), `zai-official` and `moonshot-official` (Chat Completions), `deepseek-official` and `minimax-official` (Responses API).
- **Compatible** clients speak one wire protocol for any endpoint that serves it: `openai-responses`, `openai-chat` (the bare `openai` is an alias), `openai-chat-vllm-adapter` (Chat Completions plus the served model's thinking switch), `openai-embedding`, `ant-messages` (Anthropic Messages), `google-genai` (Google's generateContent as the Google GenAI SDK speaks it — Vertex AI with a service-account JSON key as `apiKey`, the Gemini API, or a relay; `gemini-generate-content` is its 0.5.0 name, kept as an alias), `mmsp` (an MMSP server, which serves the models of its table and keeps the upstream keys; base URL `http://127.0.0.1:25752/v1` by default).

**Routing by prefix.** Without `clientType` (or the `CLIENT_TYPE` environment variable), the family the lowercased model id begins with names its official client: `gpt-` and `text-embedding-` → `openai-official`, `claude-` → `anthropic-official`, `gemini-` → `google-official`, `glm-` → `zai-official`, `kimi-` → `moonshot-official`, `deepseek-` → `deepseek-official`, `minimax-` → `minimax-official`. Any other id throws at construction: `No client for model "<id>": its family is not known. Pass clientType, one of the official clients: …; compatible clients: …`. An unknown client type throws `Unknown client type "<type>". Pass one of the …`. Routing never looks at `baseUrl`.

**Renamed in 0.5.0.** The 0.4.x vendor client types no longer exist, and a model id passed as `clientType` no longer works; the compatible client types are unchanged. The table gives the 0.5.2 names; 0.5.0 and 0.5.1 called the Gemini client `gemini-official`.

| 0.4.x `clientType`                                                                                | 0.5.0                |
| ------------------------------------------------------------------------------------------------- | -------------------- |
| `gpt-6`, `gpt-5.6`, `gpt-5.5`, `gpt-5.4`                                                          | `openai-official`    |
| `claude-5`, `claude-4-8`, `claude-4-7`, `claude-4-6`                                              | `anthropic-official` |
| `gemini-3.8`, `gemini-3.7`, `gemini-3.6`, `gemini-3`, `gemini-embedding`, `gemini-interactions`   | `google-official`    |
| `glm-5.3`, `glm-5.2`, `glm-5.1`                                                                   | `zai-official`       |
| `kimi-k3`, `kimi-k2.6`, `kimi-k2.5`                                                               | `moonshot-official`  |
| `deepseek-v4`                                                                                     | `deepseek-official`  |
| `minimax-m3`                                                                                      | `minimax-official`   |

**Gateway ids: always pass `clientType`.** Owner-prefixed ids (`openai/gpt-5.6-sol`, `anthropic/claude-opus-4.8`, `moonshotai/kimi-k3`) begin with no family and throw; an id that does begin with one (`deepseek-ai/DeepSeek-V4-Pro`) would reach the vendor's official client aimed at the gateway.

- `openai-responses` on OpenRouter: `https://openrouter.ai/api/v1` serves the Responses API for every model it resells and round-trips reasoning items (`openai-chat` works there too).
- `openai-chat` on Chat Completions endpoints: SiliconFlow, Fireworks AI, DashScope `https://dashscope.aliyuncs.com/compatible-mode/v1`, a self-hosted server (`openai-chat-vllm-adapter` for vLLM, to switch the served model's thinking). A self-hosted `deepseek-*` id needs it too, because `deepseek-official` posts to `{baseUrl}/responses`.
- `ant-messages` on Anthropic Messages endpoints (Anthropic, OpenRouter `https://openrouter.ai/api`, DeepSeek `https://api.deepseek.com/anthropic`, Z.AI, MiniMax); `google-genai` on Vertex AI or a relay that proxies Gemini's generateContent.

**Credentials.** The constructor's `apiKey` comes first, then the environment: an official client reads its vendor's pair (`DEEPSEEK_`, `OPENAI_`, `ANTHROPIC_`, `GEMINI_`, `ZAI_`, `MOONSHOT_`, `MINIMAX_` + `API_KEY` / `BASE_URL`), a compatible client the pair of its protocol (`OPENAI_*`; `ANTHROPIC_*` for `ant-messages`, `GEMINI_*` for `google-genai`, `MMSP_*` for `mmsp`). The OpenAI-, Anthropic- and generateContent-protocol clients send an environment key only to the environment's endpoint: a `baseUrl` without an `apiKey` throws `apiKey is required for <Client> with a baseUrl: OPENAI_API_KEY is not sent to another endpoint.` `mmsp` sends `MMSP_API_KEY` only to `MMSP_BASE_URL`, and a `baseUrl` without an `apiKey` is sent no key, which is what an open MMSP server takes. The other clients read their own variable whatever endpoint they are given, so pass a gateway's key as `apiKey` every time.

## Streaming

```ts
for await (const event of client.streamingResponseStateful({
  message: { role: "user", content_items: [{ type: "text.done", text: "Hello" }] },
  config: {},
})) {
  if (event.event_type === "stop") {
    console.log("\n", event.finish_reason, event.usage_metadata); // always last, exactly once
    continue;
  }
  const item = event.content_items[0]; // a delta event carries exactly one item
  if (item.type === "text.delta") process.stdout.write(item.text);
}
```

- `event_type` is `delta` or `stop` — there is no start event. The `stop` event comes last, exactly once, carries no items and always carries `usage_metadata` and `finish_reason` (`stop` | `length` | `tool_call` | `unknown`); `delta` events carry `null` for both. Read usage from `stop`; never add it up across events.
- Items stream in groups: one or more `K.delta` fragments, then one `K.done` holding the complete item (K = `text`, `thinking`, `tool_call`, `inline_data`, `inline_thinking`, `embedding`). Groups never interleave. Render the `.delta` items; keep the `.done` items — in stream order they are the assistant message.
- Tool calls: the first `tool_call.delta` of a call carries `name` and `tool_call_id` (later fragments carry `""`), and `arguments` is a raw JSON string fragment. `tool_call.done` carries `arguments` parsed into an object. Execute tools from `tool_call.done` only, and answer each with a `tool_result.done` item (`text`, optional `images`) carrying the exact `tool_call_id`:

  ```ts
  // in the loop: if (item.type === "tool_call.done") calls.push(item);
  const reply: UniMessage = {
    role: "user",
    content_items: calls.map((call) => ({
      type: "tool_result.done",
      text: runTool(call.name, call.arguments), // your dispatcher
      tool_call_id: call.tool_call_id,
    })),
  };
  ```

- `config` accepts `max_tokens`, `temperature`, `system_prompt`, `thinking_level` (the `ThinkingLevel` enum, `NONE` to `MAX`), `thinking_summary`, `tool_choice`, `prompt_caching`, `fast_mode`, `tools`, `image_config`, `tts_config`, `embedding_config` and `trace_id`.

## Messages and history

- A message holds only `.done` items: `text.done`, `image_url.done`, `inline_data.done`, `thinking.done`, `inline_thinking.done`, `tool_call.done`, `tool_result.done`, `embedding.done`. The item types without the suffix (messages saved before 0.5.0) are still accepted, with a deprecation warning, until 0.6.0; convert stored data with `normalizeLegacyMessages(messages)`.
- `streamingResponseStateful` keeps the conversation inside the client and records the turn before it yields `stop`; manage it with `getHistory()` / `setHistory(history)` / `clearHistory()`. The stateless variant is `streamingResponse({ messages, config })`.
- Keep `thinking.done` and `inline_thinking.done` items in history, and never strip or modify any item's `fidelity` — it is what replays the original wire message.

## Errors

MMSP's error classes extend `MMSPError`; a construction problem and a stream cut short throw a plain `Error`. A stream ends with its `stop` event or with an exception, never both.

- Construction throws a plain `Error`: an id of no known family, an unknown client type, or a `baseUrl` without an `apiKey` (see above).
- `UnsupportedParameterError` (`client`, `parameter`): a config value the client cannot honour, thrown while the request is built, before anything reaches the network.
- `UnsupportedOperationError` (`client`, `operation`): a capability the client lacks, such as `listModels()` on a client with no models endpoint.
- `ToolCallArgumentParseError` (`toolName`, `toolCallId`, `rawArgumentsLength`, `rawArgumentsPreview`): thrown in place of a `tool_call.done` whose arguments are malformed or not a JSON object. Never run the tool from partial arguments; retry or re-prompt.
- `EmptyResponseError` (`finishReason`, `usageMetadata`): thrown in place of the `stop` event when the response held thinking only; the stateful history is left unchanged, and `usageMetadata` still reports the tokens.
- `StreamProtocolError`: a client broke the streaming grammar — a bug in MMSP, not in the model output.
- `UpstreamError` (`client`, `status`, `errorType`, `message`, `error`): the one error `mmsp` raises for anything its server reports — a refusal (wrong key, a model not in its table) or an error the server's client raised; `errorType` names the server-side class and `error` holds its fields.
- A stream that ends without usage or a finish reason throws `Error("Streaming response ended without usage_metadata")` (or `finish_reason`).

`MMSP_DEBUG=1` makes clients fail loudly on provider output they do not recognize; `MMSP_CACHE_DIR` moves the tracer's cache directory (default `cache/`).

## Config parameters the model may reject

Leave a parameter unset and the protocol default applies, which is the portable choice when a script must run against several families. A value the client cannot honour throws `UnsupportedParameterError` before any network request:

```ts
import { UnsupportedParameterError } from "@prismshadow/mmsp";

try {
  // ...
} catch (err) {
  if (err instanceof UnsupportedParameterError) console.error(err.parameter, err.message);
}
```

- `thinking_level` never throws: every client maps each level onto the closest one the model supports. `MAX` falls back silently where the vendor has no such tier, and a model that always reasons (Kimi K3, GLM-5.3, Claude Opus 5.5 / Fable 5.1) turns `NONE` into its lowest effort, and so does Claude Haiku 5.5.
- `temperature`: both Gemini clients reject any value; `openai-official`, `anthropic-official`, `moonshot-official` and `deepseek-official` accept only `1.0`; `minimax-official` accepts 0 to 1; `zai-official` and the compatible clients pass it through.
- `tool_choice`: `"auto"` works everywhere. `zai-official` accepts nothing else; `deepseek-official` and `minimax-official` add `"none"`; `moonshot-official` adds `"required"` for Kimi K3 but never a named tool; `anthropic-official` takes `"required"` or one tool name, except on Claude Opus 5.5, Sonnet 5.5, Haiku 5.5 and Fable 5.1, which cannot be forced.
- `prompt_caching`: `ENABLE` (the default) works everywhere; only `anthropic-official` also takes `DISABLE` and `ENHANCE` (a one-hour cache).
- `fast_mode`: fast processing at premium pricing, decided by the client the model routes to:
  - sent as `service_tier: "priority"` by `openai-official`, `openai-responses`, `openai-chat`, `openai-chat-vllm-adapter`, `google-official` and `minimax-official`;
  - sent as `speed: "fast"` with the fast-mode beta header by `ant-messages` and `anthropic-official` — except on Bedrock and on Claude 4.6, Sonnet 5.5, Haiku 5.5 and Fable 5.1, which reject it. Anthropic's fast mode is a research preview: organizations without access get a 429;
  - rejected by `zai-official`, `moonshot-official`, `deepseek-official`, `google-genai` and `openai-embedding` (which also serves `openai-official`'s `text-embedding-*` ids);
  - forwarded by `mmsp` to its server, whose client for the model decides.

  A third-party OpenAI-compatible endpoint may accept `service_tier` and still serve the standard tier.

## Image generation

Use a Gemini image model (see Model IDs) and set `config.image_config` (optional `aspect_ratio`, and `image_size` of `"1K"` | `"2K"`):

```ts
import fs from "node:fs";

const client = new AutoLLMClient({ model: "gemini-3.1-flash-image" });
for await (const event of client.streamingResponseStateful({
  message: { role: "user", content_items: [{ type: "text.done", text: "A penguin on a glacier" }] },
  config: { image_config: { aspect_ratio: "16:9", image_size: "2K" } },
})) {
  for (const item of event.content_items) {
    if (item.type === "inline_data.done") fs.writeFileSync("image.png", item.data);
  }
}
```

An image streams as `inline_data.delta` chunks closed by one `inline_data.done` holding the whole image (`data` is a Buffer, with `mime_type`). Interim images a model thinks with arrive as `inline_thinking` items; they are not the output.

## Speech synthesis

Use a Gemini TTS model (`gemini-3.8-flash-tts`, `gemini-3.1-flash-tts-preview`, …) and set `config.tts_config`:

```ts
config: { tts_config: [{ voice: "Kore" }] }
```

- One entry → single voice; two entries → multi-speaker, and each entry must also set `speaker`. Write a two-speaker text as a script, one `Name: line` per turn.
- The audio is raw PCM, in `inline_data.done` whose `mime_type` names the sample rate and channel count — wrap it in a WAV header yourself before saving as `.wav`.

## Embeddings

- `gemini-embedding-2` and `text-embedding-3-small` / `text-embedding-3-large` route on their own (`google-official`, and `openai-official` through the Embeddings API).
- Any other OpenAI-compatible embeddings endpoint: pass `clientType: "openai-embedding"` with its `baseUrl` and `apiKey`.

Call `streamingResponse({ messages, config })`: each message yields one vector, as an `embedding.done` item (`embedding` is a number array), and the items within one message are embedded together. Set the size with `config.embedding_config`:

```ts
config: { embedding_config: { dimensions: 768 } }
```
