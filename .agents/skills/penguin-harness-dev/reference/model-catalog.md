# Changing the built-in model catalog

Loaded on demand from `SKILL.md`. `library/model/src/model-catalog/` is the single source of truth
for presets: `catalog.ts` holds the rows, provider groups and pricing, `seed.ts` turns them into
preset rows and provider tables, and `client-protocols.ts` / `env-keys.ts` carry the UI's protocol
and variable previews. The server's `packages/server/src/model-catalog/` re-exports it,
`packages/server/src/services/project-config-seed.ts` composes a new Project's config from the
rows, and `@prismshadow/penguin-server/model-catalog` stays the browser-safe subpath the Web App
imports. Core never reads any of it (see the core rule in `SKILL.md`). It is a *catalog*, not a
routing table — MMSP owns routing and the environment-key rule.

## Pricing

- Three buckets in USD per million tokens: `cache_read` (the vendor's cache-hit price),
  `cache_write` (the vendor's cache-write price, or the standard input price where the vendor
  charges no write premium), `output`. `cny(...)` converts official CNY list prices at the 7:1
  display convention.
- A vendor with **tiered** pricing gets its base tier recorded, and the tier boundary noted in the
  section comment — OpenAI above 272K input, Gemini 3.1 Pro above 200K, MiniMax M3 above 512K.
  Long-context use is then knowingly under-costed; that is the convention, not an oversight.
- A **promotion** is a `discount` fraction beside the list `pricing`, never a discounted number
  written into `pricing`: `effectivePricing()` derives the billed rate. A Project stores the list
  price too: `presetModelEntries()` writes the list (a scheduled row's peak) price, and
  `presetPromotions()` stores the fraction beside it, which the cost center applies when it prices
  usage. A lapsed promotion is one field to delete, with the rate to return to still on the row.
- A **time-based** tier is an `offPeakDiscount` schedule instead, and it is never baked into a
  Project. The row stores its peak price, and the cost center decides the tier from each usage
  record's own `ts` — the aggregation splits by tier before pricing. Deciding it at read time
  instead would move a finished week's cost every time the boundary passed.
- **Zero is a rate, absence is not.** Three zero buckets are a genuine $0 tier: the row shows the
  free badge and contributes 0 to the cost center. Omitting `pricing` instead means "unknown", and
  the cost center marks it uncosted. Self-hosted and free-tier rows take the zero; a row whose
  price nobody has looked up takes the absence.

## Identity and routing

- Uniqueness is the `(provider, model_id)` pair, never the bare id — gateways resell vendor models
  under their upstream ids.
- Set `client_type` only when the id cannot be auto-routed or a protocol must be pinned, and inline
  `baseUrl` with it. Everything else is routed by MMSP from the vendor family its id begins with.
- A provider group is split only when the vendor genuinely has separate endpoints or billing paths
  (Qwen Token Plan vs Pay-As-You-Go). One endpoint serving several key types is one group.
- MMSP owns routing and the environment-key rule, and exports both from its pure, browser-safe
  `@prismshadow/mmsp/credentials`: which client an entry reaches (`routedClientType`, which
  `client-protocols.ts` re-exports) and what that client does with no key
  (`environmentCredential`). Keep no copy of either and no environment or refusal logic in the
  harness: core hands MMSP the file's key, base URL and client type verbatim, and the previews in
  `env-keys.ts` (`modelEnvironment`, `modelEnvPreviewKey`, `providerEnvFallbackKey`,
  `clientEnvKey`) ask MMSP's credentials module. Only what MMSP exports nothing for lives here:
  each client's request path and fast-mode protocol (`CLIENT_PROTOCOLS` in `client-protocols.ts`,
  which a test holds to MMSP's client list, so a new MMSP client needs a row).

## What a change touches

Adding a model touches the catalog test's exact-order assertions,
`packages/web/src/features/models/protocol-path.ts` when the client's request path is not
`/chat/completions`, the provider glyph map, and the bilingual `models` / `configuration` docs.

Provider glyphs are one monochrome family: 24×24, `currentColor`, pure paths, no external assets.
A vendor's own mark goes in with its colours flattened, the way Qwen's gradient wordmark already
is — a single coloured glyph in that row reads as a mistake.

**There is no catalog-wide default model to move.** Since #1674 (2026-11-20) a new Project starts
with no default; the first-run guide (`ModelSetupGuide`) and the Default model settings dialog
(`DefaultModelsDialog`, `PUT /models/default`) set a per-Project one. A provider group may name a
`connectDefault` — the row offered when that group's first key is saved, which
`connect-default-offer.ts` resolves — and the docs' `--set-default` writes the user's own
`default_model`, not a catalog decision. `wasDefault` marks a row that was a catalog default before
#1674: `retainedCatalogPricing` uses it to keep pricing the usage a Project recorded on that row
after "Restore defaults" removes it, and a retired row is kept in the catalog for as long as that
usage may exist. With no catalog default, a new row has no reason to carry the marker.

## Who may use the environment

Who may use an environment key is MMSP's rule (PRN-021), and the harness holds no copy of it: a
row with no key in the file is handed no key, and MMSP's routed client reads its `*_API_KEY` only
for no base URL or its own default endpoint, refusing any other base URL. So a first-party vendor
group gets no table in the seed (`catalogGroupConnection` gives it none), and a new vendor group
whose ids route by family needs nothing else to read its vendor's variable. The catalog only
names the variable for the previews (`env-keys.ts`, which calls MMSP's `environmentCredential`);
it decides nothing about who may use it. Gateways and the third-party adapters (Penguin Go,
ModelScope) carry a base URL on their group, so their keys come from the config.

Existing Projects never migrate automatically: presets are copied into `.project_config.toml` at
creation and nothing rewrites them. The models page offers two actions:

- **Add new models** (`mode: add`) appends the presets the table lacks — retired rows never — and
  their promotions, in catalog order. Nothing else moves: no existing row, group table, promotion,
  key or reference.
- **Restore defaults** (`mode: restore`) resets the model configuration to a new Project's, keeping
  the API keys but deleting every row that is not a preset (the user's own, older catalog rows and
  retired rows included), every user-defined group and every override, and clearing the default
  and vision models. The first-run guide asks for a default again.

Say which action an entry means. A stored `display_name` is the user's: a rename survives.
