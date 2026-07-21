# Model catalog, Models page, and credential handling

Preset provider groups, catalog entries and ordering, and the Models page features built around them.

## Add the Qwen Token Plan provider group to the model catalog

The built-in catalog gains a Qwen Token Plan subscription gateway group (OpenAI-compatible,
preset base URL) with five models — qwen3.8-max-preview, qwen3.7-max, qwen3.7-plus, glm-5.2,
and deepseek-v4-pro — plus a custom provider logo.

## Details

- New provider `qwen-token-plan` ("Qwen Token Plan"), placed with the gateway cluster after
  SiliconFlow: OpenAI-compatible endpoint preset to
  `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`, API-key page
  `https://platform.qianwenai.com/pricing/token-plan`, model-id docs page
  `https://platform.qianwenai.com/docs/token-plan/personal/token-plan-personal-overview`;
  env fallback is `OPENAI_API_KEY`/`OPENAI_BASE_URL` like the other gateways.
- Five catalog entries with `client_type: openai` and the inlined base URL. Vision flags per
  the plan's supported-model table (qwen3.8-max-preview and qwen3.7-plus see images; the
  rest do not). Pricing and context windows come from each model's page at
  `www.qianwenai.com/models/<id>` (official CNY list prices; limited-time promotions are not
  stored): qwen3.7-max ¥2.4/¥12/¥36, qwen3.7-plus ¥0.4/¥2/¥8, glm-5.2 ¥2/¥8/¥28,
  deepseek-v4-pro ¥1/¥12/¥24 (cache-hit/input/output per M tokens), windows 1M (glm-5.2:
  1.04M). qwen3.8-max-preview is preview-only with a quota-multiplier promotion and no
  per-token list price, so it alone carries no pricing (costs read as 0, same as unpriced
  user models); the pricing invariant in the catalog tests is scoped to that one entry.
- Catalog invariant updated: bare model ids may now repeat across providers (the gateway
  resells vendor models under their upstream ids, e.g. `glm-5.2` / `deepseek-v4-pro`);
  uniqueness is the `(provider, model_id)` pair, matching the catalog's sole lookup key.
- New provider logo: the official Qwen wordmark (icon + lettering) from the brand SVG,
  gradient fills flattened to currentColor monochrome, coordinates rounded to 2dp.
- Docs (models.en/zh) provider table and gateway notes updated.

## Add the Qwen Pay-As-You-Go provider group

A pay-per-token gateway group below Qwen Token Plan (DashScope's OpenAI-compatible
endpoint) with four preset models — qwen3.7-max, qwen3.7-plus, and the resold
vendor-prefixed kimi/kimi-k3 and ZHIPU/GLM-5.2 — priced from each model's official page.

## Details

- New provider `qwen-pay-as-you-go` ("Qwen Pay-As-You-Go") right after Qwen Token Plan in
  the gateway cluster: preset base URL `https://dashscope.aliyuncs.com/compatible-mode/v1`,
  API-key link `https://platform.qianwenai.com/docs/api-reference/preparation/api-key`,
  models page `https://www.qianwenai.com/models`; `OPENAI_*` env fallback like the other
  gateways.
- Four entries (`client_type: openai` + inlined endpoint), official CNY list prices and
  specs from each model's page: kimi/kimi-k3 ¥2/¥20/¥100 (1.04M, vision), qwen3.7-max
  ¥2.4/¥12/¥36 (1M), ZHIPU/GLM-5.2 ¥2/¥8/¥28 (1.04M), qwen3.7-plus ¥0.4/¥2/¥8 (1M,
  vision). Resold third-party models keep their vendor-prefixed upstream ids.
- The group shares the Qwen emblem (glyph extracted into a shared constant), and
  `modelHomepageUrl` URL-encodes the slash-prefixed ids
  (`.../models/ZHIPU%2FGLM-5.2`). Docs (models.en/zh) provider tables and gateway notes
  updated.

## Add the Fireworks AI provider group

An OpenAI-protocol gateway group below OpenRouter with five preset models (GLM-5.2,
Kimi K2.7 Code, DeepSeek V4 Pro, MiniMax M3, DeepSeek V4 Flash), priced from each model's
Fireworks page.

## Details

- New provider `fireworks` ("Fireworks AI") right after OpenRouter in the gateway cluster:
  preset base URL `https://api.fireworks.ai/inference/v1`, API-key page
  `https://app.fireworks.ai/settings/users/api-keys`, models page
  `https://app.fireworks.ai/models`; `OPENAI_*` env fallback like the other gateways.
- Five entries (`client_type: openai` + inlined endpoint) with standard-serverless USD
  pricing (cached input / uncached input / output per M tokens) and specs from each page:
  glm-5p2 $0.14/$1.40/$4.40 (1M), kimi-k2p7-code $0.19/$0.95/$4.00 (262K, vision),
  deepseek-v4-pro $0.15/$1.74/$3.48 (1M), minimax-m3 $0.06/$0.30/$1.20 (512K, vision),
  deepseek-v4-flash $0.03/$0.14/$0.28 (1M). API model ids use Fireworks' full
  `accounts/fireworks/models/<slug>` form (sent verbatim).
- `modelHomepageUrl` maps the `accounts/<owner>/models/<slug>` id to the model page
  (`app.fireworks.ai/models/<owner>/<slug>`), falling back to the models listing for
  nonconforming user-added ids. A simplified starburst glyph approximates the brand mark
  (same approach as Z.AI). Docs (models.en/zh) provider tables and gateway notes updated.

## Expand the OpenRouter catalog with twelve models

The OpenRouter gateway group grows from 4 to 16 entries, adding the current flagship and
free tiers with pricing, context windows, and vision flags taken from each model's
OpenRouter page.

## Details

- Added (ordered by output price): anthropic/claude-fable-5 ($10/$50), openai/gpt-5.6-sol
  ($5/$30), openai/gpt-5.5 ($5/$30), anthropic/claude-opus-4.8 ($5/$25),
  anthropic/claude-opus-4.7 ($5/$25), moonshotai/kimi-k3 ($3/$15), openai/gpt-5.6-terra
  ($2.50/$15), anthropic/claude-sonnet-5 ($2/$10), z-ai/glm-5.2 ($0.93/$3),
  deepseek/deepseek-v4-pro ($0.435/$0.87), deepseek/deepseek-v4-flash ($0.09/$0.18), and
  nvidia/nemotron-3-ultra-550b-a55b:free (input/output per M tokens; all 1M context).
- Vision per the pages: the Claude models, GPT-5.5, and Kimi K3 accept image input; the
  rest do not.
- None of these pages list cache pricing, so cache_read carries the standard input price
  (no discount). The :free tier stores a genuine $0 price — not "unknown" — so costs
  correctly compute to 0; the catalog pricing invariant gains a free-tier case.

## Add Grok 4.5 to the OpenRouter catalog

`x-ai/grok-4.5` joins the OpenRouter group: $2 input / $6 output per M tokens (no cache
price listed, so cache_read carries the input price), 500K context, vision-capable —
inserted at its dictionary position.

## Add Gemini 3.5 Flash to the OpenRouter catalog

`google/gemini-3.5-flash` joins the OpenRouter group: $1.50 input / $9 output per M tokens
(no cache price listed, so cache_read carries the input price), 1M context, vision-capable
— at its dictionary position; the README model table's Gemini row now lists OpenRouter too.

## Order catalog models by dictionary, newer versions first

Within each provider group, catalog entries are now in dictionary order by model id, except
that newer versions of the same series come first (gpt-5.6-* before gpt-5.5,
claude-opus-4.8 before 4.7, glm-5.2 before glm-5) — precomputed by hand in the catalog
literal, with no runtime sorting anywhere.

## Details

- Every provider section of MODEL_CATALOG is hand-reordered: dictionary order
  (case-insensitive) across families and tiers; within a version series, the newest version
  block leads, tiers inside a version staying alphabetical. Section comments and the
  exact-order test assertions are updated to match.
- The order flows everywhere in-group order is preserved: new Projects' preset config, the
  models page cards, and the chat model dropdown (orderModelsLikeLibrary). Existing Project
  configs keep their stored order — the sync-presets merge deliberately preserves local
  positions.

## Catalog data: official Fireworks logo, two SiliconFlow models, per-model vendor pages

The Fireworks group now wears the official burst mark, SiliconFlow gains
moonshotai/Kimi-K2.7-Code and deepseek-ai/DeepSeek-V4-Flash, and Z.AI / Moonshot models
link to their per-model docs pages.

## Details

- Fireworks logo: the official three-stroke burst mark (viewBox 0 0 638 315, currentColor)
  replaces the interim starburst approximation.
- SiliconFlow entries (official CNY pricing, dictionary position):
  deepseek-ai/DeepSeek-V4-Flash ¥0.02/¥1/¥2 (1M) and moonshotai/Kimi-K2.7-Code
  ¥1.3/¥6.5/¥27 (262K, vision).
- modelHomepageUrl: zhipu -> `docs.z.ai/guides/llm/<model_id>`; moonshot ->
  `platform.kimi.com/docs/pricing/chat-k<version-without-dot>` (kimi-k2.6 -> chat-k26),
  nonconforming ids falling back to the group's models page.

## Add a sync-presets button to the Models page

A small owner-only button next to the Models page search box merges the built-in catalog
into the Project's model table: catalog entries missing locally are added, entries present
on both sides are reset to the catalog's fields, locally added models and API keys stay
untouched.

## Details

- Union semantics (`catalog-sync.ts`, pure and unit-tested): keyed by the
  `(provider, model_id)` pair. Catalog-only entries are appended (gateway base URLs preset);
  intersecting entries take the catalog's context window, pricing (including removal when
  the catalog carries none, e.g. the unpriced preview model), protocol, base URL, and vision
  flag — the catalog wins wherever the two differ; local-only models (including
  user-defined groups) are kept verbatim and in place.
- Credentials are structurally untouched: merged rows submit no `apiKey` (the PUT
  full-table replace keeps stored keys when the field is absent), and existing rows keep
  their credential state; a user base-URL override on a preset model is reset to the
  catalog's (the API-key carve-out is the only one).
- Feedback via toasts: "Presets synced: N added, M updated", or "already up to date"
  without a PUT when nothing differs. Strings added to both locales.
- The Qwen Token Plan provider logo is trimmed to the official emblem only (the wordmark
  lettering dropped), on a square viewBox.

## Model test no longer fails on thinking-only responses

Testing a reasoning-heavy model (e.g. qwen3.8-max-preview) failed with "OpenaiClient
returned no content other than thinking (finish_reason=\"length\")": the connectivity
probe's tiny output cap was burned entirely on thinking. The probe now counts a streamed
thinking-only ending as reachable — the endpoint, credential, and model id all
demonstrably work.

## Details

- The probe deliberately sends one "ping" with `maxTokens: 16` and thinking disabled
  (single-digit token cost by design). Reasoning models behind OpenAI-compatible endpoints
  can ignore the disabled thinking level, hit `finish_reason=length` with no text, and
  AgentHub 0.4 raises `EmptyResponseError` — collapsed to a `malformed` outcome, which the
  probe previously reported as a test failure.
- `testModel` now tracks whether genuine model content (thinking or text, partial or
  complete) was streamed, and a `malformed` ending after streamed content passes the test;
  timeouts, auth/parameter failures, and malformed endings with nothing received still
  fail. The logic lives in two pure functions (`isProbeContent` / `probeVerdict`) with unit
  tests, including the exact qwen3.8-max-preview case.

## Group speed test on the Models page

Each model group header gains an owner-only speed-test action: after a quota warning it
probes the group's models one at a time, measuring time-to-first-token and output rate, and
writes tone-colored badges (green / yellow / red) onto each card; the model-homepage link
moves from the card corner into the config dialog.

## Details

- Server: the model-test endpoint gains a `speed` flag — the probe's output cap rises from
  16 to 64 tokens so a real streaming window exists, and the response now carries `ttftMs`
  (request start -> first streamed content) and `tps` (output tokens over the streaming
  window, from the completed stream's usage report; thinking-only endings carry TTFT but no
  rate). The plain connectivity test is unchanged.
- Web: a gauge button on each group header (owner-only) opens a confirmation dialog warning
  that one real request per model will consume API quota; on confirm the group is tested
  **strictly sequentially** (concurrent probes trip provider rate limits), each result
  landing on its card as it finishes. Badges: clock icon + ms for TTFT (green < 1s, yellow
  <= 3s, red beyond), zap icon + tok/s for TPS (green >= 40, yellow >= 15, red below);
  failures show a red "test failed" with the reason on hover. Thresholds live in a pure,
  unit-tested helper; results are session-scoped.
- The model-homepage link moves off the card corner into the config dialog next to the
  "get model ids" link (the card stays a single clickable surface; the freed corner hosts
  the speed badges).
- Refinements: the group-header actions (add model / bulk API key / speed test) are all
  icon + text buttons; the speed badges live on the card's meta line in their own
  non-shrinking slot (the numbers never crowd or wrap the title row); the probe prompt
  discourages reasoning and ends with an empty `<think></think>` block so reasoning models
  skip their thinking phase instead of burning the probe budget on it.

## Model page refinements: draft follows the new default, ordered dropdown, GPT vision, homepage links

Four refinements: changing the Project's default model now resets the stored draft's model
selection to follow the new default; the chat model dropdown lists models in the same order
as the model library page; all GPT models are marked vision-capable; and model cards link to
each model's homepage.

## Details

- Draft follows the default: when saving a default-model change on the Models page, the
  current user's stored draft for that Project drops its `modelRef` — the draft chat then
  resolves the (new) default live instead of pinning the old model forever.
- Dropdown order: a new `orderModelsLikeLibrary` helper (unit-tested) flattens the library
  grouping — built-in provider groups in MODEL_PROVIDERS order, user-defined groups after,
  custom last, in-group order preserved — and the chat model dropdown now uses it.
- GPT vision: `openai/gpt-5.6-sol` and `openai/gpt-5.6-terra` are flipped to
  vision-capable — GPT models are uniformly multimodal (OpenAI product-line policy) even
  where the gateway page omits the modality.
- Homepage links: a new `modelHomepageUrl` helper (unit-tested) — OpenRouter and Qwen Token
  Plan have stable per-model URL patterns (working for user-added ids in those groups too;
  the unpaged Token Plan preview model falls back to the plan overview), direct vendors link
  to their model docs page, custom/user-defined groups have none. Model cards show the link
  as a corner external-link icon (a sibling of the clickable card, since interactive
  elements must not nest).

## penguin-sdk and agenthub-models keep model keys project-local

Both skills now spell out where model API keys belong: in the project under the working directory, never in the user's global `~/.penguin`.

- penguin-sdk (v6) and agenthub-models (v3) instruct configuring keys with the penguin CLI into the app's own data root under CWD (`penguin config model add --root <data_dir> …`), or relying on vault-injected environment variables; reading, copying or falling back to model keys stored in the global `~/.penguin` directory is explicitly forbidden — that config belongs to the person running Penguin, not to the app being built.
- The no-key path stays as before: stop and ask the user to open the agent's settings via the gear icon on its card and update the key vault.

## Vault edits take effect on the next task; global keys don't count as usable

A vault save now invalidates the Agent's cached Session runtimes so the next task runs with the new values, and the AI-app skills stop counting keys from the global `~/.penguin` as usable.

- Server: `PUT /agents/:agentId/vault` bumps the Agent's config generation in the session manager; every runtime built before the update is discarded on its next idle access and re-resumed via the loader (resume re-reads `agent_state/.vault.toml`; history is preserved through the Trace). A task already in flight keeps the values it started with and rebuilds on the first access after it finishes. Unit and integration tests cover idle/busy entries and the HTTP wiring; the configuration docs (en/zh) and the web Vault tab hint document the new semantics.
- penguin-sdk (v9) and agenthub-models (v6): only two sources count as a usable credential — a vault-injected environment variable, or a key configured in the app's own data root (`penguin config model list --root <data_dir>`). Keys in the global `~/.penguin` (what a bare `penguin config model list` without `--root` reads — the CLI defaults to the global root) or any other `.penguin` directory never count and must never be used or copied; when no counted key is usable, stop immediately and ask the user to configure one instead of building or retrying.
