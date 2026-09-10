# Changing the built-in model catalog

Loaded on demand from `SKILL.md`. `packages/core/src/state/model-catalog.ts` is the single source
of truth for presets, shared by core's defaults, the server's initial config, and web/CLI display.
It is a *catalog*, not a routing table — AgentHub owns routing.

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
  `baseUrl` with it. Everything else is auto-routed by AgentHub.
- A provider group is split only when the vendor genuinely has separate endpoints or billing paths
  (Qwen Token Plan vs Pay-As-You-Go). One endpoint serving several key types is one group.
- `resolveModelEnv` mirrors AgentHub's exact routing; a lookalike id must stay unroutable.

## What a change touches

Adding a model touches the catalog test's exact-order assertions,
`packages/web/src/features/models/protocol-path.ts` when the client's request path is not
`/chat/completions`, the provider glyph map, and the bilingual `models` / `configuration` docs.

Provider glyphs are one monochrome family: 24×24, `currentColor`, pure paths, no external assets.
A vendor's own mark goes in with its colours flattened, the way Qwen's gradient wordmark already
is — a single coloured glyph in that row reads as a mistake.

**Moving the default reaches further than adding a model.** `defaultProjectConfig()` in
`packages/core/src/state/project-config.ts` holds it, and six documented first-run commands pin it
by hand — `README.md`, `README.zh.md`, and `quickstart-cli` / `quickstart-sdk` in both languages —
each ending `--set-default`, which writes `default_model`. Leave them on the old id and the
documented first run silently undoes the change on every fresh install. The `models` and
`configuration` samples carry it in two places that must move together, the `default_model` line
and the `[[models]]` row it names (a default naming no entry is rejected on load), and
`plugins/agent-development/skills/penguin-sdk/SKILL.md` states it in prose.

Existing Projects never migrate automatically: presets are copied into `.project_config.toml` at
creation and nothing rewrites them. Users pick changes up through the models page's explicit "sync
presets", which appends and updates catalog-owned fields but never deletes and never touches the
stored default. Say so in the entry.
