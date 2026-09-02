---
title: Models & Providers
description: Model access through the single AgentHub gateway, (provider, model_id) identity, the per-Project model table, credentials and thinking levels.
---

## One gateway

All model access goes through one gateway library: `@prismshadow/agenthub` (AutoLLMClient). Core defines only a thin `LLMInterface` (see [Interfaces](/interfaces)); per-provider protocol adaptation happens inside AgentHub, so 1000+ online and local models are reachable, including any OpenAI-compatible endpoint. The protocol translation lives in `packages/core/src/llm/generative-model.ts`.

## Model identity

A model's identity is always the `(provider, model_id)` pair: `provider` is a config group name, `model_id` the upstream request id sent to AgentHub unchanged. The two are independent fields — concatenating them into one string is forbidden anywhere in the pipeline.

Every interface that names a model takes the complete pair: the CLI, the HTTP API, and the SDK all reject half a reference instead of completing it. The provider is never inferred from the model id and has no default, because gateways resell vendor models under their upstream ids — a guessed group would send the entry's credential to a vendor nobody named. Where a model reference is optional at all (`penguin run` / `chat`, Session creation, Schedules), the choice is between the whole pair and nothing: omit both halves to take the Project's default model.

## The per-Project model table

Each Project's available models are recorded in the hidden `.project_config.toml`, maintained via the CLI (`penguin config model add / default / list`, see [CLI Reference](/cli)) or the Web UI — never hand-edited. `ModelEntry` fields:

| Field | Meaning |
| --- | --- |
| `provider` | Config group name; paired with `model_id` it forms the unique key |
| `model_id` | Upstream request id |
| `context_window` | Context window (tokens). Load-bearing, not just display: each request's effective output cap and the compaction threshold are derived from it, so requests never ask for more output than the window still fits. Unset (or implausibly small, under 4096): the output clamp turns off and compaction derives from an assumed 128000 — set the real value for models with smaller windows |
| `max_tokens` | Optional per-model output cap (max output tokens per request). When set it overrides the Agent's `model.max_tokens`; unset inherits it. The cap is a ceiling, not the literal wire value: each request sends `min(max_tokens, context_window − estimated input − safety margin)`, so small-window models work without hand-tuning it. Omitting the field on a Web full-table save clears it |
| `client_type` | Protocol hint (`openai-chat` for Chat Completions, `openai-responses` for the Responses API, `ant-messages` for Anthropic Messages, …); inferred by AgentHub from the model id when omitted. Custom endpoints use one of those three generic protocol clients, and the Web dialog can detect which one a base URL serves. The pre-0.4.2 spelling `openai` is a deprecated alias and is normalized to `openai-chat` when the config is read |
| `display_name` | Display name |
| `vision` | Whether image input is supported, default true |
| `fast_mode` | Optional fast mode (off by default): opts the model's session requests into the provider's faster serving tier at premium pricing. Only `true` is ever persisted — omitting the field on a Web full-table save clears it. Models without a fast tier reject requests carrying it (see [Fast mode](#fast-mode)) |
| `pricing` | Three price buckets (unit `usd_per_mtok`, USD per million tokens): `cache_read` / `cache_write` / `output` |
| `api_key` / `base_url` | Inlined credentials, both optional; when blank, AgentHub falls back to environment variables |

A fresh Project defaults to deepseek-v4-flash-vision-exp, which reads images itself. A `vision_model` entry can additionally designate the proxy model that `describe_image` uses for text-only session models (see [Tools & Approval](/tools)); it is unset by default.

File shape (illustrative):

```toml
default_model = { provider = "deepseek", model_id = "deepseek-v4-flash-vision-exp" }
vision_model = { provider = "google", model_id = "gemini-3.1-pro-preview" }

[[models]]
provider = "deepseek"
model_id = "deepseek-v4-flash-vision-exp"
context_window = 1000000

[[models]]
provider = "custom"
model_id = "my-model"
client_type = "openai-chat"
base_url = "https://llm.example.com/v1"
api_key = "sk-..."
```

For a model tagged `vision = false` (e.g. `deepseek-v4-flash`, the text-only sibling of the default), images from conversation input are saved to the Session scratchpad and handed over as a file path spliced into the text, and the image-reading tool switches to `describe_image`.

## Built-in provider groups

Built-in groups and their env-var fallbacks (catalog source: `packages/core/src/state/model-catalog.ts`); each group also has a `_BASE_URL` variant (e.g. `ANTHROPIC_BASE_URL`). The models page lists the groups in this order by default and opens the first one; drag a group header to arrange them yourself, and that arrangement is stored per Project and is what you see from then on.

| Provider | API key env var | Notes |
| --- | --- | --- |
| tokendance | `OPENAI_API_KEY` | The recommended group, listed first by default. OpenAI-compatible gateway, preset base URL `https://tokendance.space/gateway/v1`; model ids are bare, with no vendor prefix (e.g. `glm-5.3`, `kimi-k3`); pricing is the gateway's own CNY rates, several of them currently discounted |
| deepseek | `DEEPSEEK_API_KEY` | Group of the default model |
| openrouter | `OPENAI_API_KEY` | OpenAI-compatible gateway, preset base URL `https://openrouter.ai/api/v1` |
| fireworks | `OPENAI_API_KEY` | Fireworks AI (OpenAI-compatible), preset base URL `https://api.fireworks.ai/inference/v1`; API model ids look like `accounts/fireworks/models/<slug>` |
| google | `GEMINI_API_KEY` | |
| openai | `OPENAI_API_KEY` | |
| anthropic | `ANTHROPIC_API_KEY` | |
| siliconflow | `OPENAI_API_KEY` | OpenAI-compatible gateway, preset base URL `https://api.siliconflow.cn/v1` |
| zhipu | `ZAI_API_KEY` | |
| moonshot | `MOONSHOT_API_KEY` | |
| minimax | `MINIMAX_API_KEY` | Direct MiniMax M3 Responses client (`client_type = "minimax-m3"`): `MiniMax-M3` with a 1,000,000-token context window and vision; preset base URL `https://api.minimax.io/v1`; accepts a Token Plan Subscription Key or pay-as-you-go API key |
| qwen-pay-as-you-go | `OPENAI_API_KEY` | Qwen pay-as-you-go (DashScope's OpenAI-compatible endpoint), preset base URL `https://dashscope.aliyuncs.com/compatible-mode/v1`; resold third-party models keep vendor-prefixed ids (e.g. `kimi/kimi-k3`) |
| qwen-token-plan | `OPENAI_API_KEY` | Qwen Token Plan subscription gateway, preset base URL `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`; pricing from each model page's official list price (the preview model has only a quota-multiplier promo, no list price) |
| custom | `OPENAI_API_KEY` | Any OpenAI-protocol endpoint |

The gateway groups (openrouter / fireworks / siliconflow / tokendance / qwen-pay-as-you-go / qwen-token-plan) go through AgentHub's generic OpenAI-protocol clients, so with blank credentials they read `OPENAI_API_KEY` — not a gateway-specific variable. Most gateway presets pin the Chat Completions client (`client_type = "openai-chat"`); the OpenRouter `openai/*` presets pin the Responses client (`client_type = "openai-responses"`) instead, because OpenRouter serves the Responses API at the same base URL and those rows' upstream is OpenAI itself. Both clients read the same `OPENAI_*` variables, so the credential rules are identical either way. The direct MiniMax M3 client reads `MINIMAX_API_KEY`. The built-in MiniMax preset pins `https://api.minimax.io/v1`; `MINIMAX_BASE_URL` is consulted only for entries without an inline `base_url`. M3 pricing records MiniMax's standard pay-as-you-go tier at 512K input tokens or below; every rate doubles above that and the priority tier is 1.5x, so long-context and priority usage is underestimated — the same base-tier convention already used for OpenAI (>272K) and Gemini 3.1 Pro (>200K).

The preset catalog also carries OpenRouter's free tier: the `:free` model variant `nvidia/nemotron-3-ultra-550b-a55b:free` and the `openrouter/free` unified Free Models Router. They cost nothing, but are subject to OpenRouter's free-tier rate limits and data policy.

Some models in the preset catalog: deepseek-v4-pro / deepseek-v4-flash / deepseek-v4-flash-vision-exp (the DeepSeek group's only vision-capable model), MiniMax-M3, gemini-3.7-flash, claude-opus-5 / claude-opus-4-8 / claude-sonnet-5, gpt-5.6 / gpt-5.5, glm-5.3 / glm-5.3-flash, kimi-k3, qwen3.8-max / qwen3.8-flash (not exhaustive). The whole OpenAI line-up is listed twice — directly (your own OpenAI key, list prices) and on OpenRouter as `openai/<id>` (the gateway's rates, which follow its running promotions). DeepSeek's direct-group rows record the official peak tier and declare its off-peak schedule: outside Beijing weekday 9:00–12:00 and 14:00–18:00 every bucket is halved, which the models page marks with a `-50%` tag and the cost center bills at. The stored price is always the peak one, so what is on disk does not depend on the hour a Project was created or re-synced in. `glm-5.3-flash` appears three times, and all three rows accept images: AgentHub's GLM client forwards image parts for this one GLM id (every other GLM id refuses them), while the OpenRouter row `z-ai/glm-5.3-flash` and the TokenDance row go through the generic OpenAI-compatible client, which carries them for any id. What the three rows do not share is the price: each records what its own seller charges, so they disagree while a promotion is running.

TokenDance rows record the gateway's list price and, where a promotion is running, the rate off it. Six models are discounted today — `deepseek-v4-flash-0731`, `deepseek-v4-pro-0813` and `glm-5.3-flash` at 50% off, `kimi-k3` at 20%, `glm-5.3` and `qwen3.8-max` at 10%. Their model cards show the price being billed right now, with the rate as a badge, and a Project is preset with the **discounted** price, so the cost center charges what the gateway charges. Prices you edit yourself keep the discount decoration off the card: the figure is then yours, not the gateway's.

## App attribution

Some gateways read a request header that files a call under the app that made it, feeding their own app rankings and usage reports. The catalog decides those headers by **endpoint host**, not by the entry's provider group: an entry filed under custom whose base URL points at such a gateway carries the same headers. Only the entry's own `base_url` is consulted — an endpoint supplied through `OPENAI_BASE_URL` is resolved inside AgentHub, is not visible on this side, and is therefore not attributed.

| Endpoint | Header | Value |
| --- | --- | --- |
| `openrouter.ai` | `HTTP-Referer` | `https://penguin.ooo/` |
| `openrouter.ai` | `X-OpenRouter-Title` | `PenguinHarness` |
| `openrouter.ai` | `X-OpenRouter-Categories` | `cli-agent,personal-agent` |
| `tokendance.space` | `X-App-URL` | `https://penguin.ooo/` |

Every other endpoint — every direct vendor, and every gateway that reads no such header — receives no extra headers at all. The headers state the app's identity only; they carry nothing about the user, the Agent or the Session.

## Authorizing a new API key

A provider that publishes an authorization flow puts an extra action on its group header in the models page: **Authorize key**. TokenDance is the one built-in group that does. It creates a **new** key on your account — it does not read a key you already have — and writes it to every model in that group, replacing whatever key those entries carry.

Pressing it opens the provider's authorization page in a new tab. Authorize there and the provider sends the browser back to PenguinHarness, which redeems the one-time code and saves the key; the tab you started from reports the result on its own. The same app URL the attribution table above lists is stamped onto the key, so calls made with it stay attributed even from another tool.

The exchange runs entirely on the server: the PKCE verifier is generated there and never reaches the browser, and the minted key goes straight into the model table without passing through it. An authorization is good for one key and expires in ten minutes.

Where the redirect cannot come back — a server the browser cannot reach on the address it was given — pick **Page can't redirect back? Enter the code by hand**. The authorization page then displays a one-time code instead of redirecting, and pasting it into the dialog finishes the same flow.

Only the Project owner can start an authorization, and only their own signed-in session finishes one — in practice, the tab the dialog is open in. The redirect itself is received without a session, and has to be, because the browser the provider sends back is not always the one you started in. But all that redirect does is hand the code over: nothing is redeemed and no key is saved until the dialog asks for the result. The full key is shown once and never again, so if saving it fails you have to authorize again and delete the unused key in the provider's console.

## Local / self-hosted OpenAI-compatible endpoints (e.g. vLLM)

A local inference server is just a `custom` entry: `client_type = "openai-chat"`, `base_url` pointing at the server (e.g. `http://127.0.0.1:8000/v1`), and the served model name as `model_id` (`openai-chat` is also what the protocol detection below settles on for such servers, and what the base URL field's suffix menu selects by hand). Two settings make it run smoothly:

- **Enable tool calling server-side.** For vLLM, start the server with `--enable-auto-tool-choice` and the `--tool-call-parser` matching your model (e.g. `hermes` for Qwen, `llama3_json` for Llama 3.x); without them tool calls arrive as plain text and the agent loop cannot execute anything.
- **Set the entry's `context_window` to the server's real window** — for vLLM, the `--max-model-len` value (e.g. `32768`). The per-request output cap and the compaction threshold both derive from this window automatically: requests clamp `max_tokens` to what the window still fits, and compaction fires before the window overflows, so no hand-tuned `max_tokens` is needed. Left unset, the per-request output clamp is off and compaction assumes a 128000 window, so a smaller real window will reject requests.

## Protocol detection for custom models

Custom and user-defined groups speak AgentHub's generic protocol clients, and the Web dialog detects which one a base URL serves. A new custom model starts with **no protocol selected**: the suffix at the right edge of the base URL field reads "Select protocol" rather than a path, and no row in its menu is checked. **Detect** sits at the top-right of that field, next to its label, and is always available — no API key is needed to press it. Pressing it has the server probe the URL with three cheap requests in fixed order — `openai-responses` (`POST {base}/responses`, OpenAI Responses API) first, then `ant-messages` (`POST {base}/v1/messages`, Anthropic Messages API), then `openai-chat` (`POST {base}/chat/completions`) — and the first protocol the endpoint actually serves is applied to the entry's `client_type`, confirmed by a toast naming what was found. Nothing about a result is written into the form itself — where the protocol ended up is visible in the suffix, which is what actually holds it.

Saving is the backstop: confirm the dialog while the protocol is still unset and detection runs first, then the save continues with what it found (the button reads "Detecting…" for the round-trip). A hit there is not announced — the save you asked for simply proceeds. If the probe finds nothing the model is **not** saved: the failure pops up and the dialog stays open, so you can pick a protocol by hand or correct the URL. This matters because AgentHub resolves an unmatched client type by raising, not by defaulting: an entry persisted with no protocol would be a model that cannot start.

Probes are minimal invalid requests (`{}` bodies): they cost no tokens and need no valid model id — an error in the protocol's own shape already proves the route exists, while a `404`/`405` means the path isn't served and HTML or gateway junk counts for nothing. The probed URLs and auth headers are exactly what the AgentHub client would use after saving (`Authorization: Bearer` for the OpenAI protocols; `x-api-key` plus `Authorization: Bearer` and `anthropic-version` for `ant-messages`), so a detected protocol is one that will really work.

The probe credential is resolved server-side in three layers: the API key typed in the dialog, else the key already stored for this entry, else the environment variable belonging to the protocol **that probe** speaks — `ANTHROPIC_API_KEY` for `ant-messages`, `OPENAI_API_KEY` for the two OpenAI protocols, the same variables the saved model would read. Resolution happens per probe precisely because the protocol is the thing being determined. None of these values are ever sent to the browser or echoed in the response. Detection still works with no credential anywhere — a protocol-shaped `401` identifies the route perfectly well — but an authenticated probe is far likelier to draw that protocol-shaped answer than the generic `401` or gateway HTML an anonymous request often gets.

The manual override is the protocol path shown inside the right edge of the base URL field (`/responses`, `/v1/messages`, `/chat/completions`) — the path the client appends to your URL, which is one-to-one with the protocol. Clicking it opens a menu of the three protocols with the path each one appends, and picking one wins over detection — so an endpoint you already know the protocol of never has to be probed at all. Whenever detection fails — unreachable, timed out, non-API answers, or none of the three paths served — the suffix turns amber and one toast says the same thing: the protocol could not be detected, check the API key and the base URL. The per-protocol probe outcomes are still reported by the endpoint for debugging. Entries from before this feature keep `client_type = "openai"` — still an alias of `openai-chat` — and are only rewritten when you pick a protocol or a detection run applies. Detection is exposed as `POST /api/projects/:id/models/detect` (owner only, see [Server API](/server-api)).

Nothing is inferred from the model id in these groups. Typing `claude-sonnet-5` into a custom group does not imply the Anthropic client or its `ANTHROPIC_*` key — custom and user-defined groups always fall back to the compatible client (`openai-chat`), and that is what the API-key hint reflects. Detection is an accuracy improvement on top, never a gate: if it comes back empty the model still saves, on `openai-chat`, with a toast saying so. Vendor and gateway groups are unaffected — their ids are catalog-known, so they keep routing by id or by their preset pin.

The add-group dialog offers two modes under the name field. **Create only** is the light path: a valid name hands off to that group's add-model dialog. **Import models** fills the brand-new group from its endpoint, in the add-model dialog's field rhythm — API key first, then the base URL with **Detect** at its top-right and the in-field protocol picker as manual override. Once a protocol is determined (detected or picked), **Import all models** appears: it asks the endpoint for every model id it serves (`POST /api/projects/:id/models/list`, owner only — AgentHub's `listModels()` on that protocol client, bounded at 20s) and saves them all as entries of the new group in one table write — base URL, protocol, and the typed key inline on each — in the endpoint's own order. An id the config cannot hold (empty, over 200 characters, or carrying control characters) or one already taken is skipped and counted in the toast, so a single bad entry never sinks the import. Only the id is taken from the endpoint: pricing, context window and display name stay empty, and an imported model claims no vision support until you probe it or switch it on — the same start a model added to the group by hand gets. An empty key follows the same per-protocol environment fallback as everywhere else. A failed detection turns the suffix amber and blocks nothing — pick the protocol by hand or switch back to create-only; listing failures (a protocol with no models endpoint, an empty listing) stay inside the dialog and persist nothing.

The header's **Add models with AI** (owner only) covers what the import cannot read: a listing page that is not an OpenAI-compatible `/models` endpoint, a service described in words, or a vendor model to add to an existing group. The prompt goes to the Project's default agent with a fixed tail that has it use the `penguin-config` skill — one `penguin config model add --provider <group> --model-id <upstream id> --project-id <project>` per model (`--client-type openai --base-url <endpoint>` for OpenAI-compatible endpoints), a web page fetched first with the models you named picked (else the most popular, about ten at most), a missing API key asked for once or left empty for you to fill in on the Models page, `.project_config.toml` never touched, and `penguin config model list` at the end. The page reloads its table on every visit, so the new group is there when you come back from the conversation.

### Vision detection

"Supports vision" can be left off and asked of the model instead: **Detect** next to the switch sends one 1x1 PNG with a one-word prompt and turns the switch on if the model answers. A model that answers specifically that it will not take an image turns the switch off — that is a real answer, not an error — while a probe that fails on auth or the network leaves the switch exactly as you had it and shows the usual "check the API key and the base URL".

Unlike protocol detection, **this probe is a real, billed completion**: an image request cannot be shaped to cost nothing the way the protocol probes are. It therefore runs only when you press the control, never on its own and never on save. The credential chain is the connectivity test's — the key typed in the dialog, else the stored one, else the protocol's environment variable, all resolved server-side. New custom models start with vision off; models added from a vendor or gateway group keep their catalog-known capability.


## Thinking levels

For MiniMax M3, `none` maps directly to `reasoning.effort = "none"`.

DeepSeek V4 accepts `low`/`high`/`max` and folds `medium` and `xhigh` onto `high` server-side. AgentHub 0.4.4 aligned the client with that vocabulary, so on DeepSeek models `low` now sends `low` (it previously sent `high`) and `xhigh` now sends `high` (it previously sent `max`): a Session left on `low` reasons less — and costs less — than before, and one on `xhigh` reasons less deeply. Pick `max` to get DeepSeek's deepest effort.

Six levels: `none | low | medium | high | xhigh | max`, configured per Agent as `model.thinking_level` in `system_config.yaml`, default medium. The Web pickers offer `low` and above only (many models cannot disable thinking; `none` stays a valid stored value and still displays). Every level is labelled with the wire value it sends, so the label names exactly what goes on the request. `max` is the deepest tier: each client maps it onto the deepest effort its vendor accepts and degrades silently where there is no such tier, so picking it never fails — on Gemini and MiniMax M3 it lands on the same effort as `xhigh`. The chat draft view offers a quick picker next to the model selector: a picked level is written back to the selected Agent's setting immediately (the switched-to level becomes that Agent's new default and applies from the next session). Inside an active session the thinking level is a **per-turn parameter**: the composer's picker lists only the levels and starts out showing the Agent config's level — while the user hasn't picked one it auto-follows the config (sends omit the level, so config edits keep taking effect); once picked, the level sticks for that session and rides on every subsequent send (it applies to that session's subsequent Tasks only and never writes back to the Agent config). See [Configuration](/configuration).

## Fast mode

Each model entry can opt into the provider's faster serving tier ("Fast mode" toggle in the Web model dialog, `--fast-mode` / `--no-fast-mode` on `penguin config model add`, `fast_mode = true` in the entry). Off by default; existing configs are unaffected. Switching it on asks for confirmation first, because it changes what the model costs.

When enabled, session requests carry AgentHub's `fast_mode` flag: OpenAI-protocol clients send `service_tier: "priority"`, Anthropic-protocol clients send `speed: "fast"` with the fast-mode beta header. Fast tiers are billed at the provider's premium price list (MiniMax charges 1.5x its standard rate; OpenAI and Anthropic publish separate premium rates), and the recorded per-token pricing does not adjust for it — costs shown for fast-mode usage are underestimated unless you raise the entry's price buckets.

### Which models offer it

Whether a fast tier exists is decided by the AgentHub client a model routes to, not by the model entry, so the toggle appears only where that client actually sends the parameter:

| Routed client | Fast mode |
| --- | --- |
| OpenAI protocol (`openai_chat`, `openai_responses`, `gpt5_6`, `minimax_m3`) | sent as `service_tier: "priority"` |
| Anthropic protocol (`ant_messages`, `claude5`) | sent as `speed: "fast"` plus the beta header |
| Gemini, GLM, Kimi, DeepSeek, OpenAI embeddings | rejected — no toggle |
| Claude on Bedrock, or a Claude 4.6 id | rejected — no toggle |

Routing follows the entry's `client_type`, or its `model_id` when none is set, so the same upstream id can land in different places: a Kimi model added under a gateway group (`client_type = "openai"`) can serve fast mode, while the same id routed to Kimi's own client cannot. A custom model behind your own base URL keeps the toggle — it speaks the OpenAI protocol and may well be OpenAI — but a third-party server is free to accept the parameter and serve the standard tier anyway.

Two things the toggle cannot check for you:

- Anthropic's fast mode is a limited research preview: until your organization is granted access, requests return a 429 rate-limit error. The confirmation says so for Anthropic-protocol models.
- `CLIENT_TYPE` and `ANTHROPIC_BASE_URL` in the server's environment override the entry, and can route a model somewhere the toggle did not anticipate.

If a request does reach a client that rejects `fast_mode`, AgentHub refuses it **before any network request**: the session ends that turn immediately with the provider's message plus a pointer to the setting, and a deterministic rejection is never retried. An entry that stores `fast_mode = true` on a model that cannot serve it keeps its toggle in the dialog, marked unsupported, so it can always be switched off.

The connectivity test sends the dialog's current toggle state, so "Test connection" surfaces a fast-mode rejection before saving. Background requests (session title generation, `describe_image` proxy reads) never carry fast mode — only the session's own requests do.

## Models decoupled from Agents

An Agent never binds a model: the model is chosen when a Session is created and stays locked for that Session; the same Agent can run different Sessions on different models. The in-session `/model` command changes models handoff-style: it opens a new session for the same Agent on the new model, keeping the current Workspace, whose first message carries a `[model_switch_from]` source block (the source session id and its Trace file path) — the history is not injected into the new context (some models require thinking payloads and `fidelity` on history replay, which cannot cross models); the model reads the Trace file itself when it needs it, and the source session stays untouched. The three `pricing` buckets feed the usage/cost center's per-Token accounting.

Credential handling:

- an inline `api_key` is stored in the hidden Project config file with mode 0600;
- the Web UI masks it on display;
- blank credentials fall back to the provider's environment variables.

## Connectivity test

The Web Models page offers a per-model connectivity test (owner only).
