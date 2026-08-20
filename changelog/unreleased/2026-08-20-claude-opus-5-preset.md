# Claude Opus 5 in the direct Anthropic preset group

- **Date:** 2026-08-20
- **Type:** fix
- **Scope:** `model-catalog`, `core`, `docs`, `skills`
- **PR:** [#363](https://github.com/Prism-Shadow/penguin-harness/pull/363)
- **Issue:** [#352](https://github.com/Prism-Shadow/penguin-harness/issues/352)

[中文版](2026-08-20-claude-opus-5-preset.zh.md)

`claude-opus-5` was absent from the direct Anthropic group of the built-in model catalog, while its OpenRouter counterpart `anthropic/claude-opus-5` was already listed. The direct preset was added, and the rest of the Anthropic group was re-read against Anthropic's published pricing in the same pass.

## Details

- The new row is `provider = "anthropic"`, `model_id = "claude-opus-5"`, display name Claude Opus 5, a 1,000,000-token context window, vision, and $0.50 / $6.25 / $25 per MTok (cache read / cache write / output) — Anthropic's $5 base input price under the group's 1.25x cache-write convention, read on 2026-08-20 from https://platform.claude.com/docs/en/about-claude/pricing. It agrees with the OpenRouter row to the cent.
- The row sits between `claude-fable-5` and `claude-opus-4-8`: the catalog's dictionary order by model id with newer versions of a series first, hand-precomputed, matching the order the OpenRouter Claude rows already carry.
- Like every other direct Anthropic preset it pins neither `client_type` nor `base_url`. AgentHub auto-routes `claude-opus-5` by its id to the native Claude client, a blank credential falls back to `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL`, and the fast-mode toggle is offered on the Anthropic protocol (`speed: "fast"` plus the beta header). Tests pin all three, plus the row's exact position, price, context window and vision flag.
- Uniqueness in the catalog is the `(provider, model_id)` pair, so the direct row and the OpenRouter row coexist; a test pins that the two share one display name, as the Fable 5 and Sonnet 5 pairs already did.
- The five sibling Anthropic rows were re-read against the same page and left unchanged: Claude Fable 5 $1 / $12.50 / $50, Opus 4.8 and Opus 4.7 $0.50 / $6.25 / $25, Sonnet 5 $0.20 / $2.50 / $10, Sonnet 4.6 $0.30 / $3.75 / $15. Sonnet 5's $2 / $10 input and output is its standard rate rather than an introductory one, which is what puts it below Sonnet 4.6; a regression test and a catalog comment were added so the inversion is not mistaken for a transcription slip. The same comment records that Anthropic bills the full 1M window at a single rate, and that the fast-mode premium on Opus 5 / Opus 4.8 ($10 / $50) is a separate tier the catalog does not store.

## Docs and skill

- The bilingual `models` docs page names `claude-opus-5` in its sample of the preset catalog.
- The `agenthub-models` skill (v13) lists `claude-opus-5` among the official Claude 5 ids, next to the `anthropic/claude-opus-5` gateway variant its table already carried.

## Compatibility

Existing Projects do not pick the preset up on their own: presets are copied into `.project_config.toml` when the Project is created, and nothing rewrites them afterwards. Use **sync presets** on the models page to bring the row into a Project that already exists — it appends catalog entries the Project is missing and updates catalog-owned fields on the ones it has, deleting nothing and touching neither the stored default model nor any credential.
