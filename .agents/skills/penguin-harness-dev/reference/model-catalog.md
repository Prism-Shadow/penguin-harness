# Changing the built-in model catalog

Loaded on demand from `SKILL.md`. `packages/server/src/model-catalog/catalog.ts` is the single
source of truth for presets: the server seeds a new Project's config from it (`seed.ts`), and the
Web App, the CLI and the gallery display it through the browser-safe subpath
`@prismshadow/penguin-server/model-catalog` (`index.ts`). What the UI shows about MMSP's clients
is `client-protocols.ts`, and the variable names the UI previews are `env-keys.ts`, both asked of
MMSP's credentials module. Core never reads any of it (see the core rule in `SKILL.md`). It is a
*catalog*, not a routing table — MMSP owns routing and the environment-key rule.

## Pricing

- Three buckets in USD per million tokens: `cache_read` (the vendor's cache-hit price),
  `cache_write` (the vendor's cache-write price, or the standard input price where the vendor
  charges no write premium), `output`. `cny(...)` converts official CNY list prices at the 7:1
  display convention.
- A vendor with **tiered** pricing gets its base tier recorded, and the tier boundary noted in the
  section comment — OpenAI above 272K input, Gemini 3.1 Pro above 200K, MiniMax M3 above 512K.
  Long-context use is then knowingly under-costed; that is the convention, not an oversight.
- A **promotion** is a `discount` fraction beside the list `pricing`, never a discounted number
  written into `pricing`: `effectivePricing()` derives the billed rate, and a lapsed promotion is
  one field to delete with the rate to return to still on the row. `presetModelEntries()` writes
  the effective rate, so what a Project stores is what the gateway charges.
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

**Moving the default reaches further than adding a model.** `PRESET_DEFAULT_MODEL` in the catalog
holds it (core's `defaultProjectConfig()` carries no model at all), and six documented first-run commands pin it
by hand — `README.md`, `README.zh.md`, and `quickstart-cli` / `quickstart-sdk` in both languages —
each ending `--set-default`, which writes `default_model`. Leave them on the old id and the
documented first run silently undoes the change on every fresh install. The `models` and
`configuration` samples carry it in two places that must move together, the `default_model` line
and the `[[models]]` row it names (a default naming no entry is rejected on load), and
`plugins/agent-development/skills/penguin-sdk/SKILL.md` states it in prose. Mark the new
default's catalog row `wasDefault: true` and leave the marker on the old one: "Restore defaults"
deletes every row that is not a preset, and the marker is what keeps usage on a former default
priced afterwards (`retainedCatalogPricing`). The old row therefore stays in the catalog, retired
once it stops being a preset.

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
creation and nothing rewrites them. Users pick changes up through the models page's explicit "sync
presets", which appends and updates catalog-owned fields but never deletes and never touches the
stored default. `display_name` is the one catalog-owned field a sync fills rather than overwrites —
a stored name may be the user's own rename — so a name the user cleared is filled back in, while a
rename survives. Say so in the entry.
